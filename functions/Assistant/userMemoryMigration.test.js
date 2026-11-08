const Y = require('yjs')

const {
    findMemoryEntriesInYText,
    isMemoryEntryLine,
    mergeMemoryEntries,
    removeRangesFromYText,
} = require('./userMemoryMigration')

function noteWith(build) {
    const doc = new Y.Doc()
    const ytext = doc.getText('quill')
    build(ytext)
    return ytext
}

describe('userMemoryMigration', () => {
    test('recognises the entry format the assistant wrote', () => {
        expect(isMemoryEntryLine('2026-03-11: [preference] Prefers short summaries')).toBe(true)
        expect(isMemoryEntryLine('Meeting 2026-03-11: notes')).toBe(false)
        expect(isMemoryEntryLine('2026-03-11:')).toBe(false)
    })

    test('moves only the memory lines out of a profile note and keeps everything else', () => {
        const ytext = noteWith(text => {
            // addContentToStorage inserted each entry at the top, newest first.
            text.insert(0, 'Karsten memory\n', {})
            text.format(13, 1, { header: 1 })
            text.insert(0, '2026-03-11: Prefers short summaries\n')
            text.insert(0, '2026-04-02: [routine] Plans the day the night before\n')
            text.insert(text.length, 'Written by a teammate: ask Karsten about the offsite\n')
        })

        const { entries, ranges } = findMemoryEntriesInYText(ytext)
        expect(entries).toEqual([
            '2026-04-02: [routine] Plans the day the night before',
            '2026-03-11: Prefers short summaries',
        ])

        removeRangesFromYText(ytext, ranges)
        expect(ytext.toString()).toBe('Karsten memory\nWritten by a teammate: ask Karsten about the offsite\n')
        // The heading formatting of the remaining line survives the deletion.
        expect(ytext.toDelta().some(op => op.attributes && op.attributes.header === 1)).toBe(true)
    })

    test('leaves a dated line alone when it carries an embed a person inserted', () => {
        const ytext = noteWith(text => {
            text.insert(0, '2026-03-11: talk to ')
            text.insertEmbed(text.length, { mention: { id: 'u2', text: 'Anna' } })
            text.insert(text.length, '\n2026-03-12: Real memory\n')
        })

        const { entries, ranges } = findMemoryEntriesInYText(ytext)
        expect(entries).toEqual(['2026-03-12: Real memory'])
        removeRangesFromYText(ytext, ranges)
        expect(ytext.toDelta()).toHaveLength(3)
        expect(ytext.toString()).not.toContain('Real memory')
    })

    test('merges oldest first and skips lines already in the private store', () => {
        const result = mergeMemoryEntries('2026-03-11: Prefers short summaries\n', [
            '2026-04-02: Newer',
            '2026-03-11: Prefers short summaries',
            '2026-01-05: Older',
        ])
        expect(result).toEqual({
            content: '2026-03-11: Prefers short summaries\n2026-01-05: Older\n2026-04-02: Newer\n',
            added: 2,
        })
        expect(mergeMemoryEntries('', [])).toEqual({ content: '', added: 0 })
    })
})
