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
// option. False positives only cost one extra verification call, so the gate errs toward
// triggering.
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
            const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
            if (pattern.test(text)) {
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
