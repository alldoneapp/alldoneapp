'use strict'

/**
 * Candidate extraction, filtering and ranking for the PER-USER half of the dictation vocabulary
 * (PT-4648). Pure functions only — no Firestore, no admin SDK — so the interesting decisions
 * (what counts as "distinctive", how terms are ranked, where the cap falls) are unit-testable
 * without a database, and so `userVoiceVocabulary.js` can stay a thin I/O shell around them.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The static glossary in `transcriptionVocabulary.js` teaches Deepgram Alldone's own product
 * nouns. It cannot know that this particular user dictates "Somova", "Heyflow" or "Signal Iduna"
 * ten times a week. Those come from the workspace the user already maintains: contacts, the
 * projects they work in, and the assistants they talk to.
 *
 * THE CONSTRAINT THAT SHAPES EVERYTHING HERE
 * ------------------------------------------
 * Deepgram's own guidance is that generic common words DILUTE keyterm prompting and cause false
 * boosts — a keyterm list is not free, and a bad term costs accuracy on every other word. So this
 * module is written to be aggressive about REJECTING candidates, not about collecting them. A
 * project called "Personal" or a contact named "Team Lead" must never reach Deepgram, and the cap
 * exists so that even a perfect-scoring long tail cannot grow the request without bound.
 *
 * The bar for inclusion: a distinctive proper noun a speech model has no reason to already know.
 */

/**
 * The hard cap on DYNAMIC terms. Deepgram errors past 500 tokens across all keyterms and its docs
 * recommend 20-50 terms total; the static glossary already spends ~9. Thirty leaves the combined
 * list inside the recommended band with a wide margin against the hard limit.
 *
 * This is a quality limit at least as much as a budget one: ranking is a heuristic, so the further
 * down the list a term sits the more likely it is to be noise, and noise is not neutral.
 */
const MAX_DYNAMIC_TERMS = 30

/** Terms shorter than this are rejected outright — too short to be acoustically distinctive. */
const MIN_TERM_LENGTH = 3

/** A keyterm may be a phrase, but a long one is a sentence fragment, not a name. */
const MAX_TERM_WORDS = 4
const MAX_TERM_LENGTH = 40

/**
 * Source weights. A contact's full name is the single most valuable thing here: proper names are
 * both the most commonly mis-transcribed and the most likely to be dictated. A bare name PART
 * ("Somova" out of "Anna Somova") is worth less — it is more likely to collide with a real word.
 */
const SOURCE_WEIGHTS = {
    contact: 10,
    assistant: 9,
    company: 7,
    project: 6,
    namePart: 4,
}

/**
 * Recency multiplier applied to a candidate's `lastEditedAt`. A contact edited this month is more
 * likely to be someone the user currently talks about than one untouched for three years.
 * Deliberately gentle (1.0 → 1.6): recency is a tiebreaker, not the signal. A contact with no
 * usable timestamp scores as if it were old rather than being dropped — missing metadata is not
 * evidence of irrelevance.
 */
const RECENCY_MAX_BONUS = 0.6
const RECENCY_WINDOW_MS = 180 * 24 * 60 * 60 * 1000 // ~6 months

/**
 * Words that must never become a keyterm on their own, and which make a multi-word candidate
 * worthless if they are ALL it contains.
 *
 * Three groups, all learned from what a real workspace actually contains:
 *   1. Alldone's own domain nouns — the exact tempting-but-wrong additions Deepgram warns about,
 *      and already transcribed correctly today.
 *   2. Organisational filler that shows up in project and contact names ("New", "Personal",
 *      "Team", "Demo", "Test", "Misc", "Admin", "Client").
 *   3. High-frequency function words in the languages `language: 'multi'` covers, so a German or
 *      Spanish project name does not smuggle "der"/"und"/"para" into the list.
 *
 * Matching is case-insensitive. This list is a floor, not a substitute for the structural checks
 * below — it cannot enumerate every generic word, which is why `isDistinctiveTerm` also requires
 * a capitalized, non-numeric shape.
 */
const GENERIC_WORDS = new Set([
    // 1. Alldone's own vocabulary — correct already, and a false boost here is expensive.
    'task',
    'tasks',
    'goal',
    'goals',
    'note',
    'notes',
    'chat',
    'chats',
    'project',
    'projects',
    'contact',
    'contacts',
    'assistant',
    'assistants',
    'comment',
    'comments',
    'meeting',
    'meetings',
    'workspace',
    'inbox',
    'backlog',
    'someday',
    'today',
    'follow',
    'up',
    // 2. Organisational filler.
    'new',
    'old',
    'personal',
    'private',
    'shared',
    'general',
    'team',
    'group',
    'company',
    'client',
    'customer',
    'partner',
    'internal',
    'external',
    'demo',
    'test',
    'testing',
    'sample',
    'example',
    'misc',
    'other',
    'various',
    'admin',
    'main',
    'default',
    'temp',
    'draft',
    'copy',
    'untitled',
    'unknown',
    'none',
    'na',
    'tbd',
    'work',
    'home',
    'family',
    'friends',
    'product',
    'products',
    'service',
    'services',
    'business',
    'sales',
    'marketing',
    'finance',
    'legal',
    'support',
    'design',
    'research',
    'management',
    'operations',
    'development',
    'engineering',
    'consulting',
    'agency',
    'studio',
    'holding',
    // Role titles: they appear as contact display names in imported address books
    // ("Team Lead", "Head of Sales") and are pure noise as keyterms.
    'lead',
    'manager',
    'director',
    'head',
    'chief',
    'officer',
    'president',
    'founder',
    'owner',
    'staff',
    'intern',
    'contractor',
    'freelancer',
    // Legal-form suffixes: never distinctive, and they pad a company phrase with noise.
    'gmbh',
    'ltd',
    'llc',
    'inc',
    'corp',
    'co',
    'ag',
    'bv',
    'sa',
    'srl',
    'plc',
    // 3. Function words across the languages `multi` covers.
    'the',
    'and',
    'for',
    'with',
    'from',
    'this',
    'that',
    'you',
    'your',
    'our',
    'all',
    'not',
    'but',
    'are',
    'was',
    'has',
    'have',
    'der',
    'die',
    'das',
    'und',
    'mit',
    'von',
    'für',
    'ein',
    'eine',
    'den',
    'dem',
    'des',
    'ist',
    'el',
    'la',
    'los',
    'las',
    'del',
    'para',
    'por',
    'con',
    'una',
    'les',
    'des',
    'une',
    'pour',
    'avec',
    'dans',
    'il',
    'di',
    'da',
    'em',
    'no',
    'na',
    'de',
    'do',
    'van',
    'het',
    'een',
])

/**
 * Personal-name particles that are legitimate inside a full name but worthless alone. Kept apart
 * from GENERIC_WORDS because a phrase containing them ("van der Berg") is fine — only the
 * standalone part is rejected.
 */
const NAME_PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'di', 'da', 'la', 'le', 'bin', 'al', "o'"])

/**
 * Collapses whitespace and strips characters that would either break the wire format or add no
 * acoustic value.
 *
 * `:` `,` `;` are removed rather than merely rejected because Deepgram does NOT error on them — a
 * keyterm containing `:` is silently accepted as a literal string and boosts nothing (this is the
 * same silent-failure trap as the legacy `keyterm=term:2` weight syntax). Anything that survives
 * here is safe to put on the wire.
 *
 * Emoji and other symbol runs are dropped: project names in this workspace routinely carry them
 * and they are not speech.
 */
function normalizeCandidateTerm(value) {
    if (typeof value !== 'string') return ''
    return (
        value
            .normalize('NFC')
            // Strip anything that is not a letter, mark, digit, space, hyphen or apostrophe.
            .replace(/[^\p{L}\p{M}\p{N}\s'’\-&.]/gu, ' ')
            // Trailing/leading punctuation on the whole phrase adds nothing.
            .replace(/\s+/g, ' ')
            .replace(/^[\s'’\-&.]+|[\s'’\-&.]+$/g, '')
            .trim()
    )
}

function isNumericLike(word) {
    return !/\p{L}/u.test(word)
}

/**
 * Does this word belong to a script that distinguishes upper and lower case?
 *
 * A word is cased if ANY of its letters changes under case mapping. Latin, Greek and Cyrillic do;
 * CJK, Kana, Hangul, Arabic, Hebrew, Thai and Devanagari do not.
 */
function hasLetterCase(word) {
    for (const character of word) {
        if (character.toUpperCase() !== character.toLowerCase()) return true
    }
    return false
}

/**
 * Is this candidate worth spending a keyterm slot on?
 *
 * The checks are structural rather than dictionary-based on purpose — there is no offline
 * dictionary here, and a curated stoplist can only ever be a floor. What actually does the work is
 * requiring the shape of a proper noun: capitalized (or an acronym), alphabetic, not a bare
 * generic word, and short enough to be a name rather than a sentence.
 */
function isDistinctiveTerm(term) {
    if (typeof term !== 'string') return false
    const trimmed = term.trim()
    if (trimmed.length < MIN_TERM_LENGTH || trimmed.length > MAX_TERM_LENGTH) return false

    const words = trimmed.split(/\s+/)
    if (words.length > MAX_TERM_WORDS) return false

    // A candidate made entirely of generic words is noise however many of them there are
    // ("New Client Project"). One distinctive word is enough to carry the phrase ("Project Juno").
    const meaningfulWords = words.filter(word => {
        const lower = word.toLowerCase().replace(/[.'’-]+$/g, '')
        if (!lower) return false
        if (isNumericLike(word)) return false
        if (NAME_PARTICLES.has(lower)) return false
        return !GENERIC_WORDS.has(lower)
    })
    if (meaningfulWords.length === 0) return false

    // The structural bar, and the part that generalizes beyond the stoplist: at least one
    // meaningful word must actually LOOK like a proper noun — capitalized or an acronym, and long
    // enough to be acoustically distinctive. This is what rejects "my project" and "some stuff"
    // without needing to enumerate every possible generic word, and it is the shape Deepgram's own
    // guidance describes ("distinctive proper nouns").
    //
    // The accepted cost: a name a user typed entirely in lowercase ("heyflow media") is skipped.
    // That is the right side to err on — a missed boost costs one word's spelling, while a generic
    // phrase on the keyterm list costs accuracy across the whole transcript.
    return meaningfulWords.some(word => {
        if (word.replace(/[^\p{L}\p{N}]/gu, '').length < MIN_TERM_LENGTH) return false
        const firstLetter = word.match(/\p{L}/u)?.[0]
        if (!firstLetter) return false

        // CAVEAT, and it is a real one: this test only means anything for scripts that HAVE case.
        // Japanese, Chinese, Korean, Arabic, Hebrew, Thai and Devanagari are caseless, so
        // `toUpperCase()` is the identity there — the original form of this check classified every
        // CJK word as an "acronym" and admitted all of them, which silently disabled the structural
        // filter for half the languages `language: 'multi'` covers.
        //
        // There is no shape signal to use in a caseless script, and rejecting them all would remove
        // the feature for those users entirely, so they are admitted on length alone. What bounds
        // the damage is the token budget in `mergeVocabulary`, not this function. KNOWN GAP:
        // `GENERIC_WORDS` is Latin/Cyrillic-only, so a generic caseless word (「テスト」 = "test")
        // is not filtered. Extending the stoplist per script is the fix if it ever matters.
        if (!hasLetterCase(word)) return true

        const isCapitalized = firstLetter === firstLetter.toUpperCase() && firstLetter !== firstLetter.toLowerCase()
        const isAcronym = word === word.toUpperCase() && /\p{L}{2,}/u.test(word)
        return isCapitalized || isAcronym
    })
}

/**
 * The individual name parts worth adding alongside a full name.
 *
 * "Anna Somova" is dictated both in full and as "Somova", and a keyterm for the phrase does not
 * boost the surname on its own. Parts are emitted at a much lower weight so the full name always
 * outranks them, and the FIRST part of a personal name is skipped: given names are the most likely
 * to collide with ordinary words and with each other across a contact list.
 */
function extractNameParts(term, { skipFirstWord = false } = {}) {
    const words = term.split(/\s+/)
    if (words.length < 2) return []
    const candidates = skipFirstWord ? words.slice(1) : words
    return candidates.map(word => normalizeCandidateTerm(word)).filter(part => isDistinctiveTerm(part))
}

/**
 * Legal-form suffixes carried by company names. Stripped rather than merely down-weighted: the
 * distinctive part of "Heyflow GmbH" is "Heyflow", and keeping the suffix spends acoustic budget
 * on a word every German company shares — which is the definition of a term that dilutes.
 *
 * Only a TRAILING run is removed, and only when something distinctive survives, so a company
 * legitimately named after its legal form is left intact rather than reduced to nothing.
 */
const LEGAL_FORM_SUFFIXES = new Set([
    'gmbh',
    'mbh',
    'ag',
    'kg',
    'ohg',
    'ug',
    'ltd',
    'limited',
    'llc',
    'lp',
    'llp',
    'inc',
    'incorporated',
    'corp',
    'corporation',
    'co',
    'company',
    'plc',
    'bv',
    'nv',
    'sa',
    'sas',
    'sarl',
    'srl',
    'spa',
    'ab',
    'as',
    'oy',
    'aps',
])

function stripCompanyLegalForm(value) {
    const normalized = normalizeCandidateTerm(value)
    if (!normalized) return ''
    const words = normalized.split(/\s+/)
    let end = words.length
    while (end > 1 && LEGAL_FORM_SUFFIXES.has(words[end - 1].toLowerCase().replace(/[.]+$/, ''))) {
        end -= 1
    }
    // Re-normalize: removing "Co. KG" from "Contoso & Co. KG" leaves a dangling "&".
    const stripped = normalizeCandidateTerm(words.slice(0, end).join(' '))
    return stripped || normalized
}

function pushCandidate(candidates, { value, source, lastEditedAt, projectId }) {
    const normalized = normalizeCandidateTerm(value)
    if (!normalized || !isDistinctiveTerm(normalized)) return
    candidates.push({
        term: normalized,
        source,
        lastEditedAt: Number(lastEditedAt) > 0 ? Number(lastEditedAt) : 0,
        projectId: projectId || null,
    })
}

/**
 * Every candidate a project's data can contribute, before ranking or capping.
 *
 * Duplicates are expected and wanted at this stage: the same person appearing in three projects is
 * evidence that the term matters, and `rankCandidates` turns that repetition into score.
 */
function extractCandidatesFromProject({ projectId, projectName, contacts = [], assistants = [] } = {}) {
    const candidates = []

    pushCandidate(candidates, { value: projectName, source: 'project', projectId })
    for (const part of extractNameParts(normalizeCandidateTerm(projectName))) {
        candidates.push({ term: part, source: 'namePart', lastEditedAt: 0, projectId: projectId || null })
    }

    for (const contact of contacts) {
        const displayName = normalizeCandidateTerm(contact?.displayName)
        const lastEditedAt = contact?.lastEditionDate
        pushCandidate(candidates, { value: displayName, source: 'contact', lastEditedAt, projectId })
        // Skip the given name: "Anna" boosts poorly and collides across a contact list, while
        // "Somova" is exactly the word a speech model cannot guess.
        for (const part of extractNameParts(displayName, { skipFirstWord: true })) {
            candidates.push({ term: part, source: 'namePart', lastEditedAt: Number(lastEditedAt) || 0, projectId })
        }
        pushCandidate(candidates, {
            value: stripCompanyLegalForm(contact?.company),
            source: 'company',
            lastEditedAt,
            projectId,
        })
    }

    for (const assistant of assistants) {
        pushCandidate(candidates, {
            value: assistant?.displayName,
            source: 'assistant',
            lastEditedAt: assistant?.lastEditionDate,
            projectId,
        })
    }

    return candidates
}

function recencyMultiplier(lastEditedAt, now) {
    if (!(lastEditedAt > 0)) return 1
    const age = now - lastEditedAt
    if (!(age >= 0)) return 1 + RECENCY_MAX_BONUS // a future timestamp is a clock skew, not a signal
    if (age >= RECENCY_WINDOW_MS) return 1
    return 1 + RECENCY_MAX_BONUS * (1 - age / RECENCY_WINDOW_MS)
}

/**
 * Collapses duplicate candidates into one scored term.
 *
 * Score = best source weight × recency × repetition. Repetition uses a square root so that a name
 * appearing in five projects outranks one appearing in two WITHOUT letting a widely-duplicated
 * mediocre term bury a strong single-source one.
 *
 * Case folding is by lowercase, but the SURVIVING spelling is the highest-weighted occurrence's:
 * Deepgram preserves keyterm casing in the transcript, so "Somova" must not be flattened to
 * "somova" just because a lowercase duplicate was seen first.
 */
function rankCandidates(candidates, { now = Date.now(), excludeTerms = [] } = {}) {
    const excluded = new Set(excludeTerms.map(term => String(term).toLowerCase()))
    const byKey = new Map()

    for (const candidate of candidates || []) {
        if (!candidate?.term) continue
        const key = candidate.term.toLowerCase()
        if (excluded.has(key)) continue

        const weight = SOURCE_WEIGHTS[candidate.source] || 1
        const existing = byKey.get(key)
        if (!existing) {
            byKey.set(key, {
                term: candidate.term,
                bestWeight: weight,
                bestSource: candidate.source,
                occurrences: 1,
                projectIds: new Set(candidate.projectId ? [candidate.projectId] : []),
                lastEditedAt: candidate.lastEditedAt || 0,
            })
            continue
        }
        existing.occurrences += 1
        if (candidate.projectId) existing.projectIds.add(candidate.projectId)
        if (candidate.lastEditedAt > existing.lastEditedAt) existing.lastEditedAt = candidate.lastEditedAt
        if (weight > existing.bestWeight) {
            existing.bestWeight = weight
            existing.bestSource = candidate.source
            existing.term = candidate.term // keep the spelling of the strongest source
        }
    }

    return Array.from(byKey.values())
        .map(entry => ({
            term: entry.term,
            source: entry.bestSource,
            score:
                entry.bestWeight *
                recencyMultiplier(entry.lastEditedAt, now) *
                Math.sqrt(Math.max(1, entry.projectIds.size || entry.occurrences)),
        }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            // Stable, deterministic tail: the same workspace must always produce the same list, or
            // the prompt cache key churns and the cached document looks like it changed when it
            // did not.
            return a.term.localeCompare(b.term)
        })
}

/**
 * The final dynamic list: extract, rank, cap.
 *
 * `excludeTerms` is the static glossary — a term already sent for every user must not also consume
 * one of this user's slots.
 *
 * Returns the terms plus the counts needed to log what was DROPPED. A cap that silently truncates
 * reads as "we included everything" when it did not, which is exactly the kind of thing that is
 * never noticed until someone asks why their colleague's name is still mis-transcribed.
 */
function buildDynamicTerms(candidates, { now = Date.now(), excludeTerms = [], maxTerms = MAX_DYNAMIC_TERMS } = {}) {
    const ranked = rankCandidates(candidates, { now, excludeTerms })
    const limit = Number.isFinite(maxTerms) && maxTerms >= 0 ? maxTerms : MAX_DYNAMIC_TERMS
    const selected = ranked.slice(0, limit)
    return {
        terms: selected.map(entry => entry.term),
        rankedCount: ranked.length,
        droppedCount: Math.max(0, ranked.length - selected.length),
        bySource: selected.reduce((acc, entry) => {
            acc[entry.source] = (acc[entry.source] || 0) + 1
            return acc
        }, {}),
    }
}

module.exports = {
    MAX_DYNAMIC_TERMS,
    MIN_TERM_LENGTH,
    MAX_TERM_WORDS,
    SOURCE_WEIGHTS,
    GENERIC_WORDS,
    normalizeCandidateTerm,
    hasLetterCase,
    stripCompanyLegalForm,
    isDistinctiveTerm,
    extractNameParts,
    extractCandidatesFromProject,
    rankCandidates,
    buildDynamicTerms,
}
