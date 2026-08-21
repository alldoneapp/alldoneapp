import { buildMentionProjectsScope, MENTION_CONTACTS_QUERY_BY } from './mentionSearch'

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
