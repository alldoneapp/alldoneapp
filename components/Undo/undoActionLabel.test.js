import {
    abbreviateUndoLabel,
    shortenUrl,
    truncateText,
    UNDO_LABEL_MAX_LENGTH,
    UNDO_LABEL_NAME_MAX_LENGTH,
} from './undoActionLabel'

const charCount = text => Array.from(text).length

describe('abbreviateUndoLabel (AT-2626)', () => {
    it('leaves ordinary labels untouched', () => {
        expect(abbreviateUndoLabel('Completed “Buy milk”')).toBe('Completed “Buy milk”')
        expect(abbreviateUndoLabel('Added “Launch” to “Q3 goals”')).toBe('Added “Launch” to “Q3 goals”')
        expect(abbreviateUndoLabel('3 actions completed')).toBe('3 actions completed')
    })

    it('shortens the reported task name with a Jira link to a readable, bounded label', () => {
        const label =
            'Completed “Kremer den aktuellen AVV schicken (Y Chi): https://jtl-software.atlassian.net/browse/LEG-257?atlOrigin=eyJpIjoiNWRkNTljNzYxNjVmNDY3MDlhMDU5Y2ZhYzA5YTRkZjUiLCJwIjoiaiJ9”'
        const result = abbreviateUndoLabel(label)

        expect(result.startsWith('Completed “Kremer den aktuellen AVV schicken (Y Chi): jtl-software')).toBe(true)
        expect(result).not.toContain('https://')
        expect(result).not.toContain('atlOrigin')
        expect(result.endsWith('…”')).toBe(true)
        const name = result.slice('Completed “'.length, -1)
        expect(charCount(name)).toBeLessThanOrEqual(UNDO_LABEL_NAME_MAX_LENGTH)
    })

    it('keeps a short link path but drops the scheme and the query', () => {
        expect(abbreviateUndoLabel('Completed “Read https://example.com/post/1?utm_source=x”')).toBe(
            'Completed “Read example.com/post/1…”'
        )
        expect(abbreviateUndoLabel('Completed “See www.example.com/docs.”')).toBe('Completed “See example.com/docs.”')
    })

    it('abbreviates each quoted name independently, keeping the words around them', () => {
        const longName = 'A'.repeat(200)
        const result = abbreviateUndoLabel(`Added “${longName}” to “Finetuning & Bugfixing”`)
        expect(result).toMatch(/^Added “A+…” to “Finetuning & Bugfixing”$/)
    })

    it('abbreviates the "Undone:" variant too', () => {
        const result = abbreviateUndoLabel(`Undone: Completed “${'word '.repeat(40)}”`)
        expect(result.startsWith('Undone: Completed “word')).toBe(true)
        expect(result.endsWith('…”')).toBe(true)
    })

    it('caps a label with no quoted name as a last line of defence', () => {
        const result = abbreviateUndoLabel('x'.repeat(500))
        expect(charCount(result)).toBe(UNDO_LABEL_MAX_LENGTH)
        expect(result.endsWith('…')).toBe(true)
    })

    it('tolerates missing labels', () => {
        expect(abbreviateUndoLabel(undefined)).toBe('')
        expect(abbreviateUndoLabel('')).toBe('')
    })
})

describe('truncateText', () => {
    it('never splits an emoji into a broken glyph', () => {
        const result = truncateText('🎉'.repeat(10), 5)
        expect(result).toBe('🎉🎉🎉🎉…')
    })

    it('does not end on a dangling separator', () => {
        expect(truncateText('Plan the launch - with everybody', 17)).toBe('Plan the launch…')
    })
})

describe('shortenUrl', () => {
    it('cuts a long path back to the host', () => {
        expect(shortenUrl(`https://docs.google.com/document/d/${'x'.repeat(60)}/edit`)).toBe('docs.google.com/…')
    })

    it('keeps trailing sentence punctuation outside the link', () => {
        expect(shortenUrl('https://example.com/a),')).toBe('example.com/a),')
    })
})
