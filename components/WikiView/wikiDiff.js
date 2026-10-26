import { parseKnowledgeSourceKey } from '../../functions/KnowledgeBase/knowledgeBaseModel'
import {
    WIKI_CHANGE_ARCHIVED,
    WIKI_CHANGE_CREATED,
    getWikiChangeKind,
} from '../../functions/KnowledgeBase/knowledgeWikiFeedModel'

// The diff behind "what changed in this wiki revision". Pure functions: the view only renders the
// rows built here.
//
// A page is compared line by line (a longest common subsequence over lines, after trimming the
// common head and tail, which is all a typical edit leaves to compare), and a line that was
// replaced by another one is compared again word by word, so a corrected date is one highlighted
// word and not a whole paragraph in red and green. Long runs of unchanged lines collapse into a
// row the reader can open.
//
// Both sides are compared as the reader sees them: [[task:ID|Label]] reads "Label", not the token.

// Above this the LCS table would cost more memory than a diff is worth; the block is then shown
// as removed and re-added in full, which is still correct, only less precise.
const MAX_LINE_TABLE_CELLS = 2000000
const MAX_WORD_TABLE_CELLS = 250000
// Below this share of shared words, word highlighting is noise: the line was rewritten.
const MIN_WORD_SIMILARITY = 0.35

export const WIKI_DIFF_CONTEXT_LINES = 2

const KNOWLEDGE_TOKEN = /\[\[([^[\]\n|]{1,200})(?:\|([^[\]\n]{1,200}))?\]\]/g
const WORD_TOKEN = /\s+|[^\s.,;:!?()[\]{}"'`*_#|<>«»„“”‚‘’/\\=+~^&%$@-]+|\S/g

export function formatWikiTextForDiff(markdown, sourceLabelFor = () => '') {
    return String(markdown || '').replace(KNOWLEDGE_TOKEN, (match, inner, label) => {
        const trimmedLabel = label ? label.trim() : ''
        const source = parseKnowledgeSourceKey(inner.trim())
        if (source) return `↗ ${trimmedLabel || sourceLabelFor(source) || source.type}`
        return trimmedLabel || inner.trim()
    })
}

export function splitWikiLines(text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n')
    return normalized ? normalized.split('\n') : []
}

function diffMiddle(before, after, maxCells) {
    const n = before.length
    const m = after.length
    if (!n) return after.map(value => ({ type: 'added', value }))
    if (!m) return before.map(value => ({ type: 'removed', value }))
    if ((n + 1) * (m + 1) > maxCells) {
        return [...before.map(value => ({ type: 'removed', value })), ...after.map(value => ({ type: 'added', value }))]
    }

    const width = m + 1
    // An LCS length never exceeds the shorter side, which the cell cap keeps far below 65536.
    const table = new Uint16Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            table[i * width + j] =
                before[i] === after[j]
                    ? table[(i + 1) * width + j + 1] + 1
                    : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
        }
    }

    const ops = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
        if (before[i] === after[j]) {
            ops.push({ type: 'equal', value: before[i] })
            i += 1
            j += 1
        } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
            ops.push({ type: 'removed', value: before[i] })
            i += 1
        } else {
            ops.push({ type: 'added', value: after[j] })
            j += 1
        }
    }
    while (i < n) ops.push({ type: 'removed', value: before[i++] })
    while (j < m) ops.push({ type: 'added', value: after[j++] })
    return ops
}

export function diffSequences(before, after, maxCells = MAX_LINE_TABLE_CELLS) {
    let start = 0
    while (start < before.length && start < after.length && before[start] === after[start]) start += 1
    let endBefore = before.length
    let endAfter = after.length
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore -= 1
        endAfter -= 1
    }

    return [
        ...before.slice(0, start).map(value => ({ type: 'equal', value })),
        ...diffMiddle(before.slice(start, endBefore), after.slice(start, endAfter), maxCells),
        ...before.slice(endBefore).map(value => ({ type: 'equal', value })),
    ]
}

function mergeSegments(segments) {
    const merged = []
    segments.forEach(segment => {
        const last = merged[merged.length - 1]
        if (last && last.changed === segment.changed) last.text += segment.text
        else merged.push({ ...segment })
    })
    return merged
}

/**
 * Word-level highlighting for a line replaced by another. Null when the two lines share too little
 * for highlighting to help, in which case both are shown as changed in full.
 */
export function diffWords(beforeLine, afterLine) {
    const before = String(beforeLine).match(WORD_TOKEN) || []
    const after = String(afterLine).match(WORD_TOKEN) || []
    if (!before.length || !after.length) return null
    const ops = diffSequences(before, after, MAX_WORD_TABLE_CELLS)

    const isWord = value => /\S/.test(value)
    const sharedWords = ops.filter(op => op.type === 'equal' && isWord(op.value)).length
    const longest = Math.max(before.filter(isWord).length, after.filter(isWord).length)
    if (!longest || sharedWords / longest < MIN_WORD_SIMILARITY) return null

    // Whitespace that only one side lost is not worth a highlight of its own.
    const segmentsFor = side =>
        mergeSegments(
            ops
                .filter(op => op.type === 'equal' || op.type === side)
                .map(op => ({ text: op.value, changed: op.type === side && isWord(op.value) }))
        )
    return { before: segmentsFor('removed'), after: segmentsFor('added') }
}

function pairChangedLines(removed, added) {
    const rows = []
    const pairs = Math.min(removed.length, added.length)
    const words = []
    for (let index = 0; index < pairs; index++) words.push(diffWords(removed[index], added[index]))
    removed.forEach((text, index) =>
        rows.push({ kind: 'removed', text, segments: words[index] ? words[index].before : null })
    )
    added.forEach((text, index) =>
        rows.push({ kind: 'added', text, segments: words[index] ? words[index].after : null })
    )
    return rows
}

function collapseContext(rows, context) {
    const result = []
    const changedIndexes = rows.map((row, index) => (row.kind === 'equal' ? -1 : index)).filter(index => index >= 0)
    if (!changedIndexes.length) {
        return rows.length ? [{ kind: 'skip', id: 'skip-0', count: rows.length, rows }] : []
    }

    const visible = new Set()
    changedIndexes.forEach(index => {
        for (let offset = -context; offset <= context; offset++) visible.add(index + offset)
    })

    let hidden = []
    const flush = () => {
        if (!hidden.length) return
        // Hiding a single line saves nothing and costs a click.
        if (hidden.length === 1) result.push(hidden[0])
        else result.push({ kind: 'skip', id: `skip-${result.length}`, count: hidden.length, rows: hidden })
        hidden = []
    }
    rows.forEach((row, index) => {
        if (row.kind !== 'equal' || visible.has(index)) {
            flush()
            result.push(row)
        } else {
            hidden.push(row)
        }
    })
    flush()
    return result
}

/**
 * Rows to render for the change from `beforeText` to `afterText`: equal, removed and added lines
 * (with word segments where a line was edited) and `skip` rows holding collapsed unchanged lines.
 */
export function buildWikiDiff(beforeText, afterText, { context = WIKI_DIFF_CONTEXT_LINES } = {}) {
    const ops = diffSequences(splitWikiLines(beforeText), splitWikiLines(afterText))

    const rows = []
    let removed = []
    let added = []
    const flushChange = () => {
        if (removed.length || added.length) rows.push(...pairChangedLines(removed, added))
        removed = []
        added = []
    }
    ops.forEach(op => {
        if (op.type === 'equal') {
            flushChange()
            rows.push({ kind: 'equal', text: op.value })
        } else if (op.type === 'removed') {
            removed.push(op.value)
        } else {
            added.push(op.value)
        }
    })
    flushChange()

    const addedCount = rows.filter(row => row.kind === 'added').length
    const removedCount = rows.filter(row => row.kind === 'removed').length
    return {
        rows: collapseContext(rows, context),
        added: addedCount,
        removed: removedCount,
        unchanged: addedCount === 0 && removedCount === 0,
    }
}

export const getWikiRevisionText = revision => ({
    title: typeof revision?.title === 'string' ? revision.title : '',
    summary: typeof revision?.summary === 'string' ? revision.summary : '',
    body: typeof revision?.body === 'string' ? revision.body : '',
    sourceKeys: Array.isArray(revision?.sourceKeys) ? revision.sourceKeys : [],
})

export const EMPTY_WIKI_TEXT = { title: '', summary: '', body: '', sourceKeys: [] }

export const isUsableWikiDiffBase = revision =>
    !!revision && revision.redacted !== true && revision.archived !== true && typeof revision.body === 'string'

/**
 * What one revision changed, from the revision and the one before it.
 *   status 'ok'               before/after are the two texts to compare
 *   status 'redacted'         the revision's own text was removed (a source it used was withdrawn)
 *   status 'baseUnavailable'  the text before it was removed or never existed as text, so only the
 *                             revision's own text can be shown
 *   status 'missing'          there is no such revision
 */
export function resolveWikiChange(revision, previous) {
    if (!revision) return { status: 'missing' }
    const kind = getWikiChangeKind(revision)
    if (revision.redacted === true) return { status: 'redacted', kind }

    if (kind === WIKI_CHANGE_ARCHIVED) {
        return isUsableWikiDiffBase(previous)
            ? { status: 'ok', kind, before: getWikiRevisionText(previous), after: EMPTY_WIKI_TEXT }
            : { status: 'baseUnavailable', kind, before: null, after: EMPTY_WIKI_TEXT }
    }

    const after = getWikiRevisionText(revision)
    if (kind === WIKI_CHANGE_CREATED || previous?.archived === true) {
        return { status: 'ok', kind, before: EMPTY_WIKI_TEXT, after }
    }
    return isUsableWikiDiffBase(previous)
        ? { status: 'ok', kind, before: getWikiRevisionText(previous), after }
        : { status: 'baseUnavailable', kind, before: null, after }
}

export function diffSourceKeys(beforeKeys = [], afterKeys = []) {
    return {
        added: afterKeys.filter(key => !beforeKeys.includes(key)),
        removed: beforeKeys.filter(key => !afterKeys.includes(key)),
    }
}
