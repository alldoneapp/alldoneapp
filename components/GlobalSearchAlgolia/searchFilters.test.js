import {
    CREATOR_ATTRIBUTE_BY_INDEX,
    buildCreatedByMeFilter,
    buildProjectsAccessFilter,
    buildSearchFilters,
} from './searchFilters'
import {
    CHATS_INDEX_NAME_PREFIX,
    CONTACTS_INDEX_NAME_PREFIX,
    GOALS_INDEX_NAME_PREFIX,
    NOTES_INDEX_NAME_PREFIX,
    TASKS_INDEX_NAME_PREFIX,
} from './searchIndexes'

const LOGGED_USER = { uid: 'me', isAnonymous: false, workstreams: {} }
const PROJECTS = [{ id: 'p1' }, { id: 'p2' }]

const ALL_INDEXES = [
    TASKS_INDEX_NAME_PREFIX,
    GOALS_INDEX_NAME_PREFIX,
    NOTES_INDEX_NAME_PREFIX,
    CONTACTS_INDEX_NAME_PREFIX,
    CHATS_INDEX_NAME_PREFIX,
]

describe('buildCreatedByMeFilter', () => {
    it('maps every searchable index to its own creator attribute', () => {
        expect(buildCreatedByMeFilter(TASKS_INDEX_NAME_PREFIX, 'me')).toBe('userId:"me"')
        expect(buildCreatedByMeFilter(NOTES_INDEX_NAME_PREFIX, 'me')).toBe('userId:"me"')
        // NOT `ownerId:"me"` — see CREATOR_ATTRIBUTE_BY_INDEX; `ownerId` is the
        // assignee-scope and is the `ALL_USERS` sentinel on virtually every goal.
        expect(buildCreatedByMeFilter(GOALS_INDEX_NAME_PREFIX, 'me')).toBe('creatorId:"me"')
        expect(buildCreatedByMeFilter(CHATS_INDEX_NAME_PREFIX, 'me')).toBe('creatorId:"me"')
    })

    it('filters contacts by who recorded them, not by the contact identity', () => {
        // `uid` is the contact's OWN id — my own contact card is not something
        // "I created", so filtering on it would be wrong.
        expect(buildCreatedByMeFilter(CONTACTS_INDEX_NAME_PREFIX, 'me')).toBe('recorderUserId:"me"')
        expect(CREATOR_ATTRIBUTE_BY_INDEX[CONTACTS_INDEX_NAME_PREFIX]).not.toBe('uid')
    })

    it('quotes the user id so ids with special characters still parse', () => {
        expect(buildCreatedByMeFilter(TASKS_INDEX_NAME_PREFIX, '-OjSHe9onWtI115trr9M')).toBe(
            'userId:"-OjSHe9onWtI115trr9M"'
        )
    })

    it('degrades to no filter rather than to a match-nothing filter', () => {
        expect(buildCreatedByMeFilter(TASKS_INDEX_NAME_PREFIX, undefined)).toBe('')
        expect(buildCreatedByMeFilter(TASKS_INDEX_NAME_PREFIX, '')).toBe('')
        expect(buildCreatedByMeFilter('dev_unknown_index', 'me')).toBe('')
    })
})

describe('buildSearchFilters', () => {
    it('is byte-for-byte unchanged from the previous behaviour when the filter is off', () => {
        ALL_INDEXES.forEach(indexPrefix => {
            const accessFilter = buildProjectsAccessFilter(PROJECTS, LOGGED_USER)
            const expected =
                indexPrefix === CONTACTS_INDEX_NAME_PREFIX ? `${accessFilter} AND isAssistant:false` : accessFilter

            expect(buildSearchFilters({ indexPrefix, projects: PROJECTS, loggedUser: LOGGED_USER })).toBe(expected)
            expect(
                buildSearchFilters({
                    indexPrefix,
                    projects: PROJECTS,
                    loggedUser: LOGGED_USER,
                    createdByMeOnly: false,
                })
            ).toBe(expected)
        })
    })

    it('appends the creator conjunct without disturbing the access scope', () => {
        const filters = buildSearchFilters({
            indexPrefix: TASKS_INDEX_NAME_PREFIX,
            projects: PROJECTS,
            loggedUser: LOGGED_USER,
            createdByMeOnly: true,
        })

        expect(filters).toBe(
            '(projectId:"p1" OR projectId:"p2") AND (isPublicFor:0 OR isPublicFor:"me" OR isPublicFor:"ws@default") AND userId:"me"'
        )
    })

    it('keeps the contacts assistant exclusion alongside the creator filter', () => {
        const filters = buildSearchFilters({
            indexPrefix: CONTACTS_INDEX_NAME_PREFIX,
            projects: PROJECTS,
            loggedUser: LOGGED_USER,
            createdByMeOnly: true,
        })

        expect(filters).toContain('AND isAssistant:false')
        expect(filters).toContain('AND recorderUserId:"me"')
    })

    it('stays a flat CNF expression Algolia can parse', () => {
        // Algolia rejects nested AND-groups: every conjunct after the access
        // scope must be a bare `attr:value`, never a parenthesised AND.
        ALL_INDEXES.forEach(indexPrefix => {
            const filters = buildSearchFilters({
                indexPrefix,
                projects: PROJECTS,
                loggedUser: LOGGED_USER,
                createdByMeOnly: true,
            })

            const conjuncts = filters.split(' AND ')
            conjuncts.slice(2).forEach(conjunct => {
                expect(conjunct).not.toContain('(')
                expect(conjunct).toMatch(/^[A-Za-z]+:/)
            })
        })
    })

    it('returns an empty string when there is no accessible project to search', () => {
        expect(
            buildSearchFilters({
                indexPrefix: TASKS_INDEX_NAME_PREFIX,
                projects: [],
                loggedUser: LOGGED_USER,
                createdByMeOnly: true,
            })
        ).toBe('')
    })

    it('never widens access: an anonymous user gets only the public facet', () => {
        const filters = buildSearchFilters({
            indexPrefix: TASKS_INDEX_NAME_PREFIX,
            projects: PROJECTS,
            loggedUser: { uid: 'me', isAnonymous: true },
            createdByMeOnly: true,
        })

        expect(filters).toContain('(isPublicFor:0)')
        expect(filters).not.toContain('isPublicFor:"me"')
    })

    it('unions workstream access ids across the searched projects', () => {
        const filters = buildSearchFilters({
            indexPrefix: TASKS_INDEX_NAME_PREFIX,
            projects: PROJECTS,
            loggedUser: { uid: 'me', isAnonymous: false, workstreams: { p1: ['ws@one'], p2: ['ws@two'] } },
        })

        expect(filters).toContain('isPublicFor:"ws@one"')
        expect(filters).toContain('isPublicFor:"ws@two"')
    })
})
