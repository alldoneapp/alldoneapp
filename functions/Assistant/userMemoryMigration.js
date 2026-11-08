// Pure helpers for migration/moveUserMemoryToPrivateStore.js (security audit 2026-11, NV-20).
//
// Until NV-20 the assistant wrote each remembered fact into the user's per-project profile note as
// one plain line `YYYY-MM-DD: <fact>` (inserted at the TOP of the note, see
// NoteService.addContentToStorage). These helpers find those lines in a note's Yjs text, so the
// migration can copy them into the private `assistantMemories` store and delete them from the note.
// Anything else in the note (what the user or a teammate wrote by hand) is left exactly where it is.

const { projectYText, toYIndex } = require('../shared/noteTextProjection')

const MEMORY_ENTRY_LINE = /^\d{4}-\d{2}-\d{2}: \S/

function isMemoryEntryLine(line) {
    return MEMORY_ENTRY_LINE.test(String(line || '').trim())
}

// Returns the memory lines (in note order) and the Y.Text ranges that hold them, each range
// including its own trailing newline, so deleting the ranges leaves no blank line behind.
function findMemoryEntriesInYText(ytext) {
    const projection = projectYText(ytext)
    const text = projection.text
    const entries = []
    const ranges = []
    let lineStart = 0
    while (lineStart < text.length) {
        const newlineIndex = text.indexOf('\n', lineStart)
        const lineEnd = newlineIndex === -1 ? text.length : newlineIndex
        const line = text.slice(lineStart, lineEnd)
        // An embed (mention, link chip, task tag) inside the line means a person wrote it in the
        // editor: the assistant only ever inserted plain text.
        const hasEmbed = projection.pieces.some(
            piece => piece.embed && piece.textStart < lineEnd && piece.textEnd > lineStart
        )
        if (!hasEmbed && isMemoryEntryLine(line)) {
            const rangeEnd = newlineIndex === -1 ? lineEnd : lineEnd + 1
            const yStart = toYIndex(projection, lineStart, 'before')
            const yEnd = toYIndex(projection, rangeEnd, 'after')
            entries.push(line.trim())
            ranges.push({ yStart, yLength: yEnd - yStart })
        }
        if (newlineIndex === -1) break
        lineStart = newlineIndex + 1
    }
    return { entries, ranges }
}

function removeRangesFromYText(ytext, ranges) {
    const ordered = [...ranges].sort((a, b) => b.yStart - a.yStart)
    for (const range of ordered) {
        if (range.yLength > 0) ytext.delete(range.yStart, range.yLength)
    }
}

// Oldest first (the private store appends the newest at the end and keeps the tail when it is
// long), dropping exact duplicates of lines already stored.
function mergeMemoryEntries(existingContent, entries) {
    const existingLines = String(existingContent || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    const seen = new Set(existingLines)
    const additions = []
    entries
        .map((entry, index) => ({ entry: String(entry).trim(), index }))
        .sort((a, b) => a.entry.slice(0, 10).localeCompare(b.entry.slice(0, 10)) || a.index - b.index)
        .forEach(({ entry }) => {
            if (!entry || seen.has(entry)) return
            seen.add(entry)
            additions.push(entry)
        })
    const lines = [...existingLines, ...additions]
    return { content: lines.length ? `${lines.join('\n')}\n` : '', added: additions.length }
}

module.exports = {
    isMemoryEntryLine,
    findMemoryEntriesInYText,
    removeRangesFromYText,
    mergeMemoryEntries,
}
