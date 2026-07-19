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

// Detect whether `reasoning` references a DIFFERENT configured option than the chosen one.
// Matches on distinctive tokens (so a partial mention like "JTL" is caught even when the
// option's full name isn't repeated), and ignores tokens that also belong to the chosen
// option. Rejected alternatives such as "Privat rather than Ads" are ignored: at Gmail
// volume, those false positives cause a material number of unnecessary audit calls.
//
// options: Array<{ key: string, names: string[] }>
// Returns { otherKey, token } when a different option is referenced, otherwise null.
function reasoningReferencesDifferentOption(reasoning = '', chosenKey = '', options = []) {
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

                return !rejectedBefore.test(before) && !rejectedAfter.test(after)
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
