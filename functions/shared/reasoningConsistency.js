'use strict'

// Shared self-consistency helper used by the LLM routers that pick exactly one configured
// option from a set (the Gmail label classifier and the Google Calendar project classifier).
//
// Both routers can mis-route: choose option A while their own reasoning actually describes
// option B (e.g. choose the "Bechtle" label/project while the reasoning talks about "JTL").
// `reasoningReferencesDifferentOption` is the cheap, in-process gate that detects this so the
// caller can spend an extra verification/repair LLM call only when there's a real signal.

// Generic words that show up in many option names / reasonings and must NOT, on their own,
// be treated as a reference to a *different* configured option.
const CONSISTENCY_STOPWORDS = new Set([
    'alldone',
    'project',
    'projects',
    'label',
    'labels',
    'gmail',
    'email',
    'emails',
    'work',
    'software',
    'client',
    'clients',
    'task',
    'tasks',
    'team',
    'update',
    'updates',
    'meeting',
    'inbox',
    'newsletter',
    'urgent',
    'follow',
    'new',
    'the',
    'and',
    'for',
    'with',
])

// Distinctive, lower-cased word tokens that identify an option (its name or key), excluding
// generic stopwords and pure numbers. "JTL Software – Project Juno" -> ["jtl", "juno"].
function extractDistinctiveTokens(text = '') {
    const raw = String(text || '')
        .toLowerCase()
        .replace(/alldone\//g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
    return raw
        .split(' ')
        .filter(token => token.length >= 3 && !/^\d+$/.test(token) && !CONSISTENCY_STOPWORDS.has(token))
}

// A different option name is only an inconsistency signal when the reasoning positively connects
// the email to that option. Bare mentions are common when a model compares alternatives, quotes
// email content, or explains why a label does not apply, and caused too many expensive audit calls.
const POSITIVE_REFERENCE_BEFORE_PATTERNS = [
    /\b(?:belongs?|belonging)\s+(?:to|under|in)\s+(?:the\s+)?(?:configured\s+)?(?:alldone\s+)?(?:[a-z0-9'_-]+\s+){0,2}$/,
    /\b(?:best\s+)?(?:fits?|matches?)\s+(?:the\s+)?(?:configured\s+)?(?:alldone\s+)?(?:[a-z0-9'_-]+\s+){0,2}$/,
    /\b(?:aligns?|corresponds?|relates?|maps?)\s+(?:best\s+)?(?:with|to)\s+(?:the\s+)?(?:configured\s+)?(?:alldone\s+)?(?:[a-z0-9'_-]+\s+){0,2}$/,
    /\b(?:should|would|could|must|ought to)\s+be\s+labell?ed(?:\s+as)?\s+(?:the\s+)?(?:configured\s+)?(?:alldone\s+)?(?:[a-z0-9'_-]+\s+){0,2}$/,
    /\b(?:labell?ed|classified|categorized|assigned|routed)\s+(?:as|to|under|in)\s+(?:the\s+)?(?:configured\s+)?(?:alldone\s+)?(?:[a-z0-9'_-]+\s+){0,2}$/,
    /\b(?:assign|route|classify|categorize|label)\s+(?:(?:it|this|the\s+(?:email|message))\s+)?(?:as|to|under|in)\s+(?:the\s+)?(?:configured\s+)?(?:alldone\s+)?(?:[a-z0-9'_-]+\s+){0,2}$/,
    /\b(?:correct|right|best|appropriate|configured|final)\s+(?:label|project|category|option|choice)\s+(?:is|would be|should be)\s+(?:the\s+)?(?:alldone\s+)?(?:[a-z0-9'_-]+\s+){0,2}$/,
    /\b(?:this|it|the\s+(?:email|message))\s+(?:clearly\s+)?(?:is\s+(?:about|for|related to)|concerns?|regards?)\s+(?:the\s+)?(?:alldone\s+)?(?:[a-z0-9'_-]+\s+){0,2}$/,
    /\b(?:clearly|specifically|directly|explicitly)\s+(?:about|for|related to)\s+(?:the\s+)?(?:alldone\s+)?(?:[a-z0-9'_-]+\s+){0,2}$/,
    /\b(?:clearly|definitely|unambiguously)\s+(?:the\s+)?(?:alldone\s+)?$/,
    /\b(?:sender|email|message)\s+is\s+from\s+(?:the\s+)?(?:[a-z0-9'_-]+\s+){0,2}$/,
    /\b(?:subject|email|message)\s+(?:is\s+)?explicitly\s+titled\s+["']?(?:[a-z0-9'_-]+\s+){0,2}$/,
]

const POSITIVE_REFERENCE_AFTER_PATTERNS = [
    /^\s*(?:(?:label|project|category|option|choice|workstream)\s+)?(?:is\s+)?(?:clearly\s+)?(?:the\s+)?(?:best|correct|right|appropriate|strongest)\s+(?:fit|match|label|project|category|option|choice)\b/,
    /^\s+(?:label|project|category|option|choice|workstream)\s+(?:fits?|matches?|aligns?)\s+best\b/,
]

function hasPositiveOptionReference(before = '', after = '') {
    const beforeWindow = before.slice(-200)
    const afterWindow = after.slice(0, 120)
    return (
        POSITIVE_REFERENCE_BEFORE_PATTERNS.some(pattern => pattern.test(beforeWindow)) ||
        POSITIVE_REFERENCE_AFTER_PATTERNS.some(pattern => pattern.test(afterWindow))
    )
}

// Detect whether `reasoning` references a DIFFERENT configured option than the chosen one.
// Matches on distinctive tokens (so a partial mention like "JTL" is caught even when the
// option's full name isn't repeated), ignores tokens that belong to the chosen option, and ignores
// rejected alternatives such as "Privat rather than Ads". High-volume callers can additionally
// require a nearby positive assignment or relationship phrase so bare-name matches do not cause
// unnecessary audit calls.
//
// options: Array<{ key: string, names: string[] }>
// Returns { otherKey, token } when a different option is referenced, otherwise null.
function reasoningReferencesDifferentOption(
    reasoning = '',
    chosenKey = '',
    options = [],
    { requirePositiveRelationship = false } = {}
) {
    const text = ` ${String(reasoning || '').toLowerCase()} `
    if (!text.trim()) return null

    const normalizedOptions = (Array.isArray(options) ? options : [])
        .filter(option => option && option.key)
        .map(option => ({
            key: option.key,
            tokens: (Array.isArray(option.names) ? option.names : []).flatMap(extractDistinctiveTokens),
        }))

    const chosenTokens = new Set(
        normalizedOptions.filter(option => option.key === chosenKey).flatMap(option => option.tokens)
    )

    for (const option of normalizedOptions) {
        if (option.key === chosenKey) continue
        for (const token of option.tokens) {
            if (chosenTokens.has(token)) continue
            const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const pattern = new RegExp(`\\b${escapedToken}\\b`, 'g')
            const matches = Array.from(text.matchAll(pattern))
            const hasPositiveReference = matches.some(match => {
                const index = match.index || 0
                const clauseStart = Math.max(
                    text.lastIndexOf('.', index),
                    text.lastIndexOf('!', index),
                    text.lastIndexOf('?', index),
                    text.lastIndexOf(';', index)
                )
                const clauseEndCandidates = [
                    text.indexOf('.', index + token.length),
                    text.indexOf('!', index + token.length),
                    text.indexOf('?', index + token.length),
                    text.indexOf(';', index + token.length),
                ].filter(value => value >= 0)
                const clauseEnd = clauseEndCandidates.length > 0 ? Math.min(...clauseEndCandidates) : text.length
                const clauseBefore = text.slice(clauseStart + 1, index)
                const contrastBoundary = Math.max(
                    clauseBefore.lastIndexOf(' but '),
                    clauseBefore.lastIndexOf(' however '),
                    clauseBefore.lastIndexOf(' yet ')
                )
                const before = contrastBoundary >= 0 ? clauseBefore.slice(contrastBoundary + 1) : clauseBefore
                const after = text.slice(index + token.length, clauseEnd)

                const rejectedBefore = new RegExp(
                    `(?:\\b(?:not|never)\\s+|\\b(?:rather than|instead of|unrelated to|exclude|excluding|rule out|ruled out)\\s+|` +
                        `\\b(?:does not|do not|did not|doesn't|don't|didn't|is not|isn't|was not|wasn't|` +
                        `should not|shouldn't|would not|wouldn't|could not|couldn't|cannot|can't)\\s+` +
                        `[^.!?;]{0,160})$`
                )
                const rejectedAfter = new RegExp(
                    `^\\s*(?:label\\s+)?(?:does not|do not|did not|doesn't|don't|didn't|is not|isn't|` +
                        `was not|wasn't|should not|shouldn't|would not|wouldn't|could not|couldn't|` +
                        `doesn't apply|does not apply|is unrelated|is excluded)\\b`
                )

                return (
                    !rejectedBefore.test(before) &&
                    !rejectedAfter.test(after) &&
                    (!requirePositiveRelationship || hasPositiveOptionReference(before, after))
                )
            })
            if (hasPositiveReference) {
                return { otherKey: option.key, token }
            }
        }
    }

    return null
}

module.exports = {
    CONSISTENCY_STOPWORDS,
    extractDistinctiveTokens,
    reasoningReferencesDifferentOption,
}
