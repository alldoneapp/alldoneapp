'use strict'

/**
 * The curated product vocabulary that dictation is biased towards, shared by BOTH halves of the
 * rambler/meeting transcription pipeline:
 *
 *   1. Acoustic layer — `Notes/deepgramTranscribe.js` passes `getTranscriptionKeyterms()` to
 *      Deepgram as `keyterm` (Nova-3 keyterm prompting). This nudges the speech model towards the
 *      right spelling while it is still looking at the audio.
 *   2. Semantic layer — `Assistant/ramblerCleanup.js` embeds `buildVocabularyPromptSection()` in the
 *      LLM cleanup prompt, so the rewrite can fix what the acoustic layer could not.
 *
 * BOTH layers are needed, and the reason is "Alldone" itself: it is a homophone of the ordinary
 * English phrase "all done". Keyterm prompting alone biases the model towards the brand, which
 * means "are we all done here?" starts coming back as "are we Alldone here?" — the same error in
 * the mirror. Only the cleanup LLM has the surrounding sentence and can tell the two apart, which
 * is also why Deepgram's `replace` (find & replace) is deliberately NOT used for this: a blind
 * "all done" -> "Alldone" rewrite would clobber every legitimate use of the phrase.
 *
 * SCOPE: the glossary below is Alldone's own product and platform vocabulary — static, identical
 * for every user, and the floor that every dictation gets. On top of it, a PER-USER list of
 * distinctive workspace terms (contact names, companies, project and assistant names) is merged in
 * by `mergeVocabulary`. Those are precomputed into `users/{uid}/private/voiceVocabulary` and reach
 * this module behind ONE cached document read — see `userVoiceVocabulary.js`. The workspace is
 * never scanned on the transcription critical path, which runs in ~1s and must stay there.
 *
 * ONE LIST, BOTH LAYERS. `mergeVocabulary` is the only place the final vocabulary is decided, and
 * both `getTranscriptionKeyterms` and `buildVocabularyPromptSection` are thin wrappers over it. If
 * the acoustic layer and the cleanup layer were allowed to disagree about the term list, the
 * cleanup could "correct" a spelling Deepgram was told to produce, and the two halves would fight.
 *
 * WHAT BELONGS HERE: distinctive proper nouns — product, company and platform names that a speech
 * model plausibly gets wrong. Deepgram explicitly warns against generic common words: they dilute
 * the prompt and cause false boosts. So no "task", "goal", "note", "assistant" — those are
 * transcribed correctly already and would only cost accuracy elsewhere.
 */

/**
 * Terms sent to Deepgram as `keyterm`, and the canonical spellings the cleanup LLM is told to
 * prefer. Keep this list short and distinctive; see WHAT BELONGS HERE above before adding.
 *
 * Casing is significant: Deepgram preserves the casing of a keyterm in the transcript, so write
 * each term exactly as it should appear in the output.
 */
const PRODUCT_KEYTERMS = [
    // The brand. The whole reason this module exists — see the homophone note above.
    'Alldone',
    // Alldone product surfaces with distinctive, non-dictionary names.
    'OpenClaw',
    // Platform/vendor names that come up in product and engineering dictation and that a speech
    // model has no reason to know. Cheap (a handful of tokens against a 500-token budget) and each
    // one is a proper noun, so the false-boost risk Deepgram warns about does not apply.
    'Deepgram',
    'Firestore',
    'Typesense',
    'Codex',
    // Acronyms are routinely split or spelled out phonetically ("em see pee", "buy ok").
    'MCP',
    'BYOK',
    'E2B',
]

/**
 * Known mis-transcriptions of the brand, used ONLY for observability — never for a blind rewrite.
 * Counting these in the raw transcript is what makes it possible to tell whether the acoustic layer
 * or the cleanup layer did the work (or whether the mirror-image error was introduced).
 *
 * "all done" is intentionally in this list even though it is a perfectly valid English phrase: the
 * metric is "how often did the ambiguous form appear", not "how often was it wrong".
 */
const BRAND_CONFUSABLE_FORMS = ['all done', 'alldon', 'aldon', 'all-done', 'olldone']

/**
 * The ceiling on the COMBINED list. Deepgram errors past 500 tokens across all keyterms and its
 * docs recommend 20-50 terms; this sits inside that band with the static glossary's ~9 included, so
 * the request can never grow into the silent-rejection zone as a workspace grows.
 */
const MAX_TOTAL_KEYTERMS = 40

/**
 * THE final vocabulary for one dictation: the static glossary plus this user's terms.
 *
 * The static glossary is placed first and can never be displaced. It is the vocabulary the product
 * itself depends on — "Alldone" is the entire reason this feature exists — whereas a dynamic term
 * is a per-user nicety. If a workspace ever produces enough high-ranking terms to fill the budget,
 * it is the dynamic tail that must lose, never the brand.
 *
 * Deduplication is case-insensitive, and the STATIC spelling wins a collision: a user whose project
 * is called "alldone" must not lowercase the brand for their own transcripts.
 */
function mergeVocabulary(dynamicTerms = []) {
    const merged = []
    const seen = new Set()

    const add = term => {
        if (typeof term !== 'string') return
        const trimmed = term.trim()
        if (!trimmed) return
        const key = trimmed.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        merged.push(trimmed)
    }

    for (const term of PRODUCT_KEYTERMS) add(term)
    if (Array.isArray(dynamicTerms)) for (const term of dynamicTerms) add(term)

    return merged.slice(0, MAX_TOTAL_KEYTERMS)
}

/**
 * The `keyterm` values for a Deepgram request. Returns a fresh array so a caller cannot mutate the
 * module state, and so it can be safely spread into request options.
 *
 * With no argument this is the static glossary alone, which is what every caller that has no user
 * context (and every existing test) gets.
 */
function getTranscriptionKeyterms(dynamicTerms = []) {
    return mergeVocabulary(dynamicTerms)
}

/**
 * The glossary block injected into the rambler cleanup prompt.
 *
 * The instruction is deliberately two-sided. Telling the model to prefer "Alldone" without also
 * telling it to protect the ordinary phrase "all done" trades one error for its mirror image —
 * which is exactly the failure mode keyterm prompting introduces on the acoustic side.
 */
function buildVocabularyPromptSection(dynamicTerms = []) {
    return [
        'Known product vocabulary for this workspace. When a word or phrase in the transcript is acoustically close to one of these, prefer the known spelling — but only when the sentence actually supports it. Never insert one of these names into a sentence that does not call for it.',
        mergeVocabulary(dynamicTerms)
            .map(term => `- ${term}`)
            .join('\n'),
        '"Alldone" is the product name and is pronounced exactly like the ordinary English phrase "all done". Write "Alldone" when the speaker means the product, the app or the workspace (e.g. "add this to Alldone"). Keep the ordinary phrase "all done" when the speaker means finished (e.g. "we are all done here"). Decide from the sentence, not from the spelling the transcript happens to use.',
    ].join('\n')
}

function countOccurrences(haystack, needle) {
    if (!haystack || !needle) return 0
    let count = 0
    let index = haystack.indexOf(needle)
    while (index !== -1) {
        count += 1
        index = haystack.indexOf(needle, index + needle.length)
    }
    return count
}

/**
 * Observability for the raw-vs-cleaned comparison, WITHOUT logging the dictated content.
 *
 * Returns only counts of known vocabulary terms and known confusable forms, so a log line can
 * answer "did Deepgram get the brand right, did the cleanup fix it, or did the cleanup introduce
 * the mirror-image error" while never carrying a word the user actually dictated. Terms with a zero
 * count in both texts are omitted to keep the log line small.
 *
 * Matching is case-insensitive on purpose: a transcript containing "alldone" is an acoustic hit
 * that the cleanup still has to capitalize, and both facts are worth seeing separately.
 */
function summarizeVocabularyUsage(rawTranscript, cleanedText, dynamicTerms = []) {
    const raw = typeof rawTranscript === 'string' ? rawTranscript.toLowerCase() : ''
    const cleaned = typeof cleanedText === 'string' ? cleanedText.toLowerCase() : ''

    const terms = {}
    for (const term of PRODUCT_KEYTERMS) {
        const key = term.toLowerCase()
        const rawCount = countOccurrences(raw, key)
        const cleanedCount = countOccurrences(cleaned, key)
        if (rawCount || cleanedCount) terms[term] = { raw: rawCount, cleaned: cleanedCount }
    }

    const confusable = {}
    for (const form of BRAND_CONFUSABLE_FORMS) {
        const rawCount = countOccurrences(raw, form)
        const cleanedCount = countOccurrences(cleaned, form)
        if (rawCount || cleanedCount) confusable[form] = { raw: rawCount, cleaned: cleanedCount }
    }

    // The per-user terms are counted in AGGREGATE and never named.
    //
    // The static glossary is Alldone's own product vocabulary, so logging "Alldone: 2" is safe. The
    // dynamic list is the opposite: it is made of contact names, employers and project names, and a
    // log line reading `Somova: 1` would put a colleague's surname — and the fact that this user
    // dictated it — into Cloud Logging. Totals answer the only question the log needs to answer
    // ("is the personalized half doing anything?") without carrying any of that.
    const dynamic = { termCount: 0, raw: 0, cleaned: 0, matchedTerms: 0 }
    if (Array.isArray(dynamicTerms)) {
        const staticKeys = new Set(PRODUCT_KEYTERMS.map(term => term.toLowerCase()))
        for (const term of dynamicTerms) {
            if (typeof term !== 'string' || !term.trim()) continue
            const key = term.trim().toLowerCase()
            if (staticKeys.has(key)) continue // already reported by name above
            dynamic.termCount += 1
            const rawCount = countOccurrences(raw, key)
            const cleanedCount = countOccurrences(cleaned, key)
            dynamic.raw += rawCount
            dynamic.cleaned += cleanedCount
            if (rawCount || cleanedCount) dynamic.matchedTerms += 1
        }
    }

    return { terms, confusable, dynamic }
}

module.exports = {
    PRODUCT_KEYTERMS,
    BRAND_CONFUSABLE_FORMS,
    MAX_TOTAL_KEYTERMS,
    mergeVocabulary,
    getTranscriptionKeyterms,
    buildVocabularyPromptSection,
    summarizeVocabularyUsage,
}
