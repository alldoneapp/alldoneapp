import {
    buildWikiDiff,
    diffSequences,
    diffSourceKeys,
    diffWords,
    formatWikiTextForDiff,
    resolveWikiChange,
    splitWikiLines,
} from './wikiDiff'

const kinds = rows => rows.map(row => (row.kind === 'skip' ? `skip:${row.count}` : `${row.kind}:${row.text}`))
const changedWords = segments => segments.filter(segment => segment.changed).map(segment => segment.text)

describe('diffSequences', () => {
    it('keeps the longest common run and reports the rest as removed and added', () => {
        expect(diffSequences(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e'])).toEqual([
            { type: 'equal', value: 'a' },
            { type: 'removed', value: 'b' },
            { type: 'added', value: 'x' },
            { type: 'equal', value: 'c' },
            { type: 'equal', value: 'd' },
            { type: 'added', value: 'e' },
        ])
    })

    it('falls back to removing and re-adding a block too large to compare, and stays correct', () => {
        const before = ['same', 'b1', 'b2', 'b3', 'same end']
        const after = ['same', 'a1', 'a2', 'same end']

        const ops = diffSequences(before, after, 4)

        expect(ops.filter(op => op.type !== 'added').map(op => op.value)).toEqual(before)
        expect(ops.filter(op => op.type !== 'removed').map(op => op.value)).toEqual(after)
        expect(ops[0]).toEqual({ type: 'equal', value: 'same' })
    })
})

describe('diffWords', () => {
    it('highlights only the words that changed in an edited line', () => {
        const words = diffWords('Acme ist seit Mai Kunde.', 'Acme ist seit März Kunde.')

        expect(changedWords(words.before)).toEqual(['Mai'])
        expect(changedWords(words.after)).toEqual(['März'])
        expect(words.before.map(segment => segment.text).join('')).toBe('Acme ist seit Mai Kunde.')
        expect(words.after.map(segment => segment.text).join('')).toBe('Acme ist seit März Kunde.')
    })

    it('gives up on a line that was rewritten rather than edited', () => {
        expect(diffWords('Acme ist Pilotkunde.', 'Der Vertrag endet im Juni.')).toBeNull()
    })
})

describe('buildWikiDiff', () => {
    const before = ['# Kunden', '', 'Acme ist seit Mai Kunde.', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'Ende'].join('\n')

    it('shows an edited line as removed and added, with word highlights', () => {
        const after = before.replace('Mai', 'März')

        const diff = buildWikiDiff(before, after)

        expect(diff).toMatchObject({ added: 1, removed: 1, unchanged: false })
        const removed = diff.rows.find(row => row.kind === 'removed')
        const added = diff.rows.find(row => row.kind === 'added')
        expect(changedWords(removed.segments)).toEqual(['Mai'])
        expect(changedWords(added.segments)).toEqual(['März'])
    })

    it('folds unchanged lines away beyond the context around a change, and keeps them openable', () => {
        const after = before.replace('Ende', 'Ende.')

        const diff = buildWikiDiff(before, after, { context: 2 })

        expect(kinds(diff.rows)).toEqual(['skip:8', 'equal:f', 'equal:g', 'removed:Ende', 'added:Ende.'])
        expect(diff.rows[0].rows.map(row => row.text)).toEqual([
            '# Kunden',
            '',
            'Acme ist seit Mai Kunde.',
            'a',
            'b',
            'c',
            'd',
            'e',
        ])
    })

    it('does not fold a single line, which would only cost a click', () => {
        const diff = buildWikiDiff('x\na\nb\nc', 'x\na\nb\nC', { context: 2 })

        expect(kinds(diff.rows)).toEqual(['equal:x', 'equal:a', 'equal:b', 'removed:c', 'added:C'])
    })

    it('treats a new page as all added and an archived one as all removed', () => {
        expect(kinds(buildWikiDiff('', 'Eins\nZwei').rows)).toEqual(['added:Eins', 'added:Zwei'])
        expect(kinds(buildWikiDiff('Eins\nZwei', '').rows)).toEqual(['removed:Eins', 'removed:Zwei'])
    })

    it('says so when nothing changed', () => {
        expect(buildWikiDiff(before, before)).toMatchObject({ unchanged: true, added: 0, removed: 0 })
        expect(buildWikiDiff('', '')).toMatchObject({ unchanged: true, rows: [] })
    })
})

describe('formatWikiTextForDiff', () => {
    it('compares wiki tokens as the reader sees them', () => {
        const text = 'Siehe [[entscheidungen]] und [[kunden|die Kunden]]. Quelle [[task:t1]], [[note:n1|Protokoll]].'

        expect(formatWikiTextForDiff(text, source => (source.id === 't1' ? 'Acme gewinnen' : ''))).toBe(
            'Siehe entscheidungen und die Kunden. Quelle ↗ Acme gewinnen, ↗ Protokoll.'
        )
    })

    it('splits Windows line endings like any other', () => {
        expect(splitWikiLines('a\r\nb')).toEqual(['a', 'b'])
        expect(splitWikiLines('')).toEqual([])
    })
})

describe('resolveWikiChange', () => {
    const revision = (number, extra = {}) => ({
        revision: number,
        title: `Titel ${number}`,
        summary: `Zusammenfassung ${number}`,
        body: `Text ${number}`,
        sourceKeys: [`task:t${number}`],
        mode: 'ingest',
        ...extra,
    })

    it('compares a revision with the one before it', () => {
        expect(resolveWikiChange(revision(3), revision(2))).toMatchObject({
            status: 'ok',
            kind: 'updated',
            before: { body: 'Text 2', title: 'Titel 2' },
            after: { body: 'Text 3', title: 'Titel 3' },
        })
    })

    it('compares a creation, and a page brought back after an archive, with nothing', () => {
        expect(resolveWikiChange(revision(1), null)).toMatchObject({
            status: 'ok',
            kind: 'created',
            before: { body: '' },
        })
        expect(resolveWikiChange(revision(5, { created: true }), { revision: 4, archived: true })).toMatchObject({
            status: 'ok',
            kind: 'created',
            before: { body: '' },
        })
    })

    it('shows an archive as the previous text removed', () => {
        expect(resolveWikiChange({ revision: 4, archived: true }, revision(3))).toMatchObject({
            status: 'ok',
            kind: 'archived',
            before: { body: 'Text 3' },
            after: { body: '' },
        })
    })

    it('never shows a revision whose text the wiki removed, and says when the text before it is gone', () => {
        expect(resolveWikiChange({ revision: 3, redacted: true }, revision(2))).toEqual({
            status: 'redacted',
            kind: 'updated',
        })
        expect(resolveWikiChange(revision(3, { mode: 'rebuild' }), { revision: 2, redacted: true })).toMatchObject({
            status: 'baseUnavailable',
            kind: 'rebuilt',
            before: null,
            after: { body: 'Text 3' },
        })
        expect(resolveWikiChange({ revision: 4, archived: true }, { revision: 3, redacted: true })).toMatchObject({
            status: 'baseUnavailable',
            kind: 'archived',
        })
    })

    it('reports a revision that does not exist', () => {
        expect(resolveWikiChange(null, revision(1))).toEqual({ status: 'missing' })
    })
})

describe('diffSourceKeys', () => {
    it('lists the sources a revision started and stopped citing', () => {
        expect(diffSourceKeys(['task:a', 'note:b'], ['note:b', 'goal:c'])).toEqual({
            added: ['goal:c'],
            removed: ['task:a'],
        })
    })
})
