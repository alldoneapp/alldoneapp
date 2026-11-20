// Shrinks a tool result to a size budget while keeping its shape: every key and short field (ids,
// statuses, voice ids) stays, long strings are cut first and list items are dropped last.
//
// Both the per-result ceiling (attachmentToolHandoff.js) and the research guard's compaction
// (assistantResearchGuard.js) used to fall back to the first N characters of the JSON. A Story
// Builder `story_get` of 24 scenes (47k characters, 2026-11-19) keeps each scene's `voiceId` after
// its long `transcript` and `visualPrompt`, so the prefix showed the first two scenes and nothing
// else. The model asked for the story again, 85 times in 34 minutes.

const DEFAULT_LEVELS = [
    { maxString: 2000, maxItems: 100 },
    { maxString: 1000, maxItems: 100 },
    { maxString: 500, maxItems: 100 },
    { maxString: 240, maxItems: 100 },
    { maxString: 120, maxItems: 100 },
    { maxString: 60, maxItems: 100 },
    { maxString: 60, maxItems: 20 },
    { maxString: 40, maxItems: 10 },
    { maxString: 40, maxItems: 5 },
]
const MAX_OBJECT_KEYS = 50
const MAX_DEPTH = 9

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

// A long string that is itself JSON (an MCP text block, for example) is shrunk as data, not cut.
function parseJsonString(value) {
    const first = value.trimStart()[0]
    if (first !== '{' && first !== '[') return undefined
    try {
        return JSON.parse(value)
    } catch (_) {
        return undefined
    }
}

function shrinkValue(value, level, depth = 0) {
    if (typeof value === 'string') {
        if (value.length <= level.maxString) return value
        const parsed = parseJsonString(value)
        if (parsed !== undefined && depth < MAX_DEPTH) return shrinkValue(parsed, level, depth + 1)
        return `${value.slice(0, level.maxString)}… [${value.length - level.maxString} more chars]`
    }
    if (!value || typeof value !== 'object') return value
    if (depth >= MAX_DEPTH) return '[nested details omitted]'
    if (Array.isArray(value)) {
        const items = value.slice(0, level.maxItems).map(item => shrinkValue(item, level, depth + 1))
        if (value.length > items.length) items.push(`[${value.length - items.length} more item(s) omitted]`)
        return items
    }
    const entries = Object.entries(value)
    const out = {}
    entries.slice(0, MAX_OBJECT_KEYS).forEach(([key, item]) => {
        out[key] = shrinkValue(item, level, depth + 1)
    })
    if (entries.length > MAX_OBJECT_KEYS) out.contextOmittedObjectKeys = entries.length - MAX_OBJECT_KEYS
    return out
}

const measureChars = value => JSON.stringify(value)?.length || 0
const measureBytes = value => Buffer.byteLength(JSON.stringify(value) || '', 'utf8')

/**
 * The first shape (least shrinking) that fits `budget`, or null when even the tightest does not.
 * `maxString` caps the first level's string length (levels with longer strings are skipped).
 */
function fitToolResultToBudget(value, budget, { measure = measureBytes, maxString = Infinity } = {}) {
    for (const level of DEFAULT_LEVELS) {
        if (level.maxString > maxString) continue
        const shrunk = shrinkValue(value, level)
        if (measure(shrunk) <= budget) return shrunk
    }
    return null
}

module.exports = { fitToolResultToBudget, shrinkValue, measureChars, measureBytes, isPlainObject }
