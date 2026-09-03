import {
    buildMentionProjectsScope,
    MENTION_CONTACTS_QUERY_BY,
    MENTION_NOTES_CURRENT_PROJECT_SLOTS,
    MENTION_NOTES_PAGE_SIZE,
    mergeMentionPages,
} from './mentionSearch'

describe('AT-2393 — @-mention contact search matches only real results', () => {
    describe('buildMentionProjectsScope', () => {
        it('scopes the search to the given projects', () => {
            expect(buildMentionProjectsScope(['p1', 'p2'])).toBe('projectId:=[`p1`,`p2`]')
        })

        it('lets the caller allow extra projects through, without duplicates', () => {
            expect(buildMentionProjectsScope(['p1'], ['global'])).toBe('projectId:=[`p1`,`global`]')
            expect(buildMentionProjectsScope(['p1', 'global'], ['global'])).toBe('projectId:=[`p1`,`global`]')
        })

        it('returns no scope rather than an empty one when there is nothing to scope to', () => {
            // `projectId:=[]` would match nothing and blank the tab; during boot the
            // projects map can legitimately still be empty, so this must fall back to the
            // unscoped filter the modal used before.
            expect(buildMentionProjectsScope([])).toBe('')
            expect(buildMentionProjectsScope(undefined)).toBe('')
            expect(buildMentionProjectsScope([null, undefined, ''])).toBe('')
        })
    })

    describe('MENTION_CONTACTS_QUERY_BY', () => {
        it('never searches the free-text description', () => {
            // The whole defect: `cleanDescription` holds the auto-generated user
            // description (thousands of characters on the reporting account), so a
            // description-matching mention search returns the author for almost any
            // prefix. Ratchet — do not add it back here.
            expect(MENTION_CONTACTS_QUERY_BY.split(',')).not.toContain('cleanDescription')
        })

        it('still searches the identity fields a person is looked up by', () => {
            expect(MENTION_CONTACTS_QUERY_BY.split(',')).toEqual(['displayName', 'role', 'company'])
        })
    })
})

// AT-2497 — the notes tab is one page shared by every project the user belongs to, so the
// project being written in can be crowded off it entirely. Measured on the reporting
// account: the twenty most recently edited notes are sixteen from one project plus four
// from four others, and the project this ticket lives in appears zero times.
describe('AT-2497 — mergeMentionPages keeps the current project on the page', () => {
    const hit = (id, projectId) => ({ id, projectId, objectID: `${id}${projectId}` })
    const ids = page => page.map(item => item.id)

    const currentPage = n => Array.from({ length: n }, (_, i) => hit(`current${i}`, 'p-current'))
    const crossPage = n => Array.from({ length: n }, (_, i) => hit(`cross${i}`, 'p-other'))

    it('puts the current project first and fills the rest from the cross-project page', () => {
        const merged = mergeMentionPages(currentPage(2), crossPage(3))

        expect(ids(merged)).toEqual(['current0', 'current1', 'cross0', 'cross1', 'cross2'])
    })

    it('reserves a block for the current project instead of letting it be crowded out', () => {
        // The failing production shape: a full cross-project page containing nothing from
        // the project the user is writing in.
        const merged = mergeMentionPages(currentPage(20), crossPage(20))

        const fromCurrent = merged.filter(item => item.projectId === 'p-current')
        expect(fromCurrent).toHaveLength(MENTION_NOTES_CURRENT_PROJECT_SLOTS)
        expect(ids(merged).slice(0, MENTION_NOTES_CURRENT_PROJECT_SLOTS)).toEqual(
            ids(currentPage(MENTION_NOTES_CURRENT_PROJECT_SLOTS))
        )
        expect(merged).toHaveLength(MENTION_NOTES_PAGE_SIZE)
    })

    it('does not reserve slots the current project cannot fill', () => {
        // A project with two notes must not cost the page eight rows.
        const merged = mergeMentionPages(currentPage(2), crossPage(20))

        expect(merged).toHaveLength(MENTION_NOTES_PAGE_SIZE)
        expect(merged.filter(item => item.projectId === 'p-other')).toHaveLength(MENTION_NOTES_PAGE_SIZE - 2)
    })

    it('tops the page up from the current project when the cross-project page is short', () => {
        const merged = mergeMentionPages(currentPage(20), crossPage(2))

        expect(merged).toHaveLength(MENTION_NOTES_PAGE_SIZE)
        expect(ids(merged).slice(MENTION_NOTES_CURRENT_PROJECT_SLOTS, MENTION_NOTES_CURRENT_PROJECT_SLOTS + 2)).toEqual(
            ['cross0', 'cross1']
        )
    })

    it('deduplicates: the cross-project page legitimately contains current-project notes', () => {
        // Both searches are ANDed with the same privacy scope, so a recent note of the
        // current project is returned by BOTH. Showing it twice would look like a bug.
        const shared = hit('current0', 'p-current')
        const merged = mergeMentionPages([shared], [shared, hit('cross0', 'p-other')])

        expect(ids(merged)).toEqual(['current0', 'cross0'])
    })

    it('preserves the recency order it was handed inside each block', () => {
        const merged = mergeMentionPages(
            [hit('c-newest', 'p-current'), hit('c-older', 'p-current')],
            [hit('o-newest', 'p-other'), hit('o-older', 'p-other')]
        )

        expect(ids(merged)).toEqual(['c-newest', 'c-older', 'o-newest', 'o-older'])
    })

    it('never invents rows: a short page stays short', () => {
        expect(mergeMentionPages([], [])).toEqual([])
        expect(mergeMentionPages(undefined, undefined)).toEqual([])
        expect(mergeMentionPages(null, [hit('cross0', 'p-other')])).toHaveLength(1)
    })
})
