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
 * SCOPE: this is a deliberately small, static, workspace-independent glossary of Alldone's own
 * product and platform vocabulary. It is NOT per-user or per-project. Adding a dynamic vocabulary
 * (contact names, project names, goal titles) would mean a workspace scan on the transcription
 * critical path, which currently runs in ~1s — do not put one there. If dynamic terms are ever
 * wanted, precompute them into a per-user document and merge them here behind one cached read.
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
 * The `keyterm` values for a Deepgram request. Returns a copy so a caller cannot mutate the module
 * state, and so it can be safely spread into request options.
 */
function getTranscriptionKeyterms() {
    return [...PRODUCT_KEYTERMS]
}

/**
 * The glossary block injected into the rambler cleanup prompt.
 *
 * The instruction is deliberately two-sided. Telling the model to prefer "Alldone" without also
 * telling it to protect the ordinary phrase "all done" trades one error for its mirror image —
 * which is exactly the failure mode keyterm prompting introduces on the acoustic side.
 */
function buildVocabularyPromptSection() {
    return [
        'Known product vocabulary for this workspace. When a word or phrase in the transcript is acoustically close to one of these, prefer the known spelling — but only when the sentence actually supports it. Never insert one of these names into a sentence that does not call for it.',
        PRODUCT_KEYTERMS.map(term => `- ${term}`).join('\n'),
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
function summarizeVocabularyUsage(rawTranscript, cleanedText) {
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

    return { terms, confusable }
}

module.exports = {
    PRODUCT_KEYTERMS,
    BRAND_CONFUSABLE_FORMS,
    getTranscriptionKeyterms,
    buildVocabularyPromptSection,
    summarizeVocabularyUsage,
}
