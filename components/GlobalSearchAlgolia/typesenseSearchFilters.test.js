// Port of searchFilters.test.js for the Typesense filter builder (Phase 3). The invariants
// are identical — only the syntax differs. Where searchFilters.test.js pins the access
// model itself, this suite pins that the Typesense port cannot drift from it.
import {
    buildTypesenseCreatedByMeFilter,
    buildTypesenseProjectsAccessFilter,
    buildTypesenseSearchFilters,
    formatTypesenseValue,
} from './typesenseSearchFilters'
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

describe('formatTypesenseValue', () => {
    it('backtick-quotes values so special characters parse', () => {
        expect(formatTypesenseValue('ws@default')).toBe('`ws@default`')
        expect(formatTypesenseValue('-OjSHe9onWtI115trr9M')).toBe('`-OjSHe9onWtI115trr9M`')
    })

    it('stringifies the numeric public sentinel to match the string[] index field', () => {
        expect(formatTypesenseValue(0)).toBe('`0`')
    })

    it('strips backticks so a value can never break out of the quoting', () => {
        expect(formatTypesenseValue('a`b')).toBe('`ab`')
    })
})

describe('buildTypesenseCreatedByMeFilter', () => {
    it('maps every searchable index to the same creator attribute as the Algolia builder', () => {
        expect(buildTypesenseCreatedByMeFilter(TASKS_INDEX_NAME_PREFIX, 'me')).toBe('userId:=`me`')
        expect(buildTypesenseCreatedByMeFilter(NOTES_INDEX_NAME_PREFIX, 'me')).toBe('userId:=`me`')
        expect(buildTypesenseCreatedByMeFilter(GOALS_INDEX_NAME_PREFIX, 'me')).toBe('creatorId:=`me`')
        expect(buildTypesenseCreatedByMeFilter(CHATS_INDEX_NAME_PREFIX, 'me')).toBe('creatorId:=`me`')
        expect(buildTypesenseCreatedByMeFilter(CONTACTS_INDEX_NAME_PREFIX, 'me')).toBe('recorderUserId:=`me`')
    })

    it('degrades to no filter rather than to a match-nothing filter', () => {
        expect(buildTypesenseCreatedByMeFilter(TASKS_INDEX_NAME_PREFIX, undefined)).toBe('')
        expect(buildTypesenseCreatedByMeFilter(TASKS_INDEX_NAME_PREFIX, '')).toBe('')
        expect(buildTypesenseCreatedByMeFilter('dev_unknown_index', 'me')).toBe('')
    })
})

describe('buildTypesenseSearchFilters', () => {
    it('carries both access conjuncts: project membership and privacy scope', () => {
        const filters = buildTypesenseSearchFilters({
            indexPrefix: TASKS_INDEX_NAME_PREFIX,
            projects: PROJECTS,
            loggedUser: LOGGED_USER,
        })

        expect(filters).toBe('projectId:=[`p1`,`p2`] && isPublicFor:=[`0`,`me`,`ws@default`]')
    })

    it('appends the creator conjunct without disturbing the access scope', () => {
        const filters = buildTypesenseSearchFilters({
            indexPrefix: TASKS_INDEX_NAME_PREFIX,
            projects: PROJECTS,
            loggedUser: LOGGED_USER,
            createdByMeOnly: true,
        })

        expect(filters).toBe('projectId:=[`p1`,`p2`] && isPublicFor:=[`0`,`me`,`ws@default`] && userId:=`me`')
    })

    it('keeps the contacts assistant exclusion alongside the creator filter', () => {
        const filters = buildTypesenseSearchFilters({
            indexPrefix: CONTACTS_INDEX_NAME_PREFIX,
            projects: PROJECTS,
            loggedUser: LOGGED_USER,
            createdByMeOnly: true,
        })

        expect(filters).toContain(' && isAssistant:=false')
        expect(filters).toContain(' && recorderUserId:=`me`')
    })

    it('returns an empty string when there is no accessible project to search', () => {
        ALL_INDEXES.forEach(indexPrefix => {
            expect(
                buildTypesenseSearchFilters({
                    indexPrefix,
                    projects: [],
                    loggedUser: LOGGED_USER,
                    createdByMeOnly: true,
                })
            ).toBe('')
        })
    })

    it('never widens access: an anonymous user gets only the public facet', () => {
        const filters = buildTypesenseSearchFilters({
            indexPrefix: TASKS_INDEX_NAME_PREFIX,
            projects: PROJECTS,
            loggedUser: { uid: 'me', isAnonymous: true },
            createdByMeOnly: true,
        })

        // The privacy scope must be exactly the public facet — the trailing creator
        // conjunct (userId:=`me`) narrows, so it is allowed; widening isPublicFor is not.
        expect(filters).toContain('isPublicFor:=[`0`] &&')
        expect(filters).not.toContain('isPublicFor:=[`0`,')
    })

    it('unions workstream access ids across the searched projects', () => {
        const filters = buildTypesenseSearchFilters({
            indexPrefix: TASKS_INDEX_NAME_PREFIX,
            projects: PROJECTS,
            loggedUser: { uid: 'me', isAnonymous: false, workstreams: { p1: ['ws@one'], p2: ['ws@two'] } },
        })

        expect(filters).toContain('`ws@one`')
        expect(filters).toContain('`ws@two`')
    })
})
