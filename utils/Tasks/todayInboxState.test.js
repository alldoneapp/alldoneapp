import {
    getTodayInboxState,
    selectTodayInboxState,
    TODAY_INBOX_EMPTY,
    TODAY_INBOX_OPEN,
    TODAY_INBOX_UNKNOWN,
} from './todayInboxState'

const base = {
    userId: 'u1',
    projectIds: ['p1', 'p2', 'archived', 'template'],
    archivedProjectIds: ['archived'],
    templateProjectIds: ['template'],
}
const state = sidebarNumbers => getTodayInboxState({ ...base, sidebarNumbers })
const LOADED_EMPTY = { p1: {}, p2: {}, archived: {}, template: {} }

describe('getTodayInboxState (AT-3057)', () => {
    it('is EMPTY only for loaded counts that cover every project and add up to zero', () => {
        expect(state(LOADED_EMPTY)).toBe(TODAY_INBOX_EMPTY)
        expect(state({ ...LOADED_EMPTY, p1: { u1: 0 } })).toBe(TODAY_INBOX_EMPTY)
    })

    it('is OPEN with a task due today or overdue for the user', () => {
        expect(state({ ...LOADED_EMPTY, p2: { u1: 3 } })).toBe(TODAY_INBOX_OPEN)
        // A positive count is an answer even while another project is still loading.
        expect(state({ ...LOADED_EMPTY, p2: { u1: 1 }, loading: true })).toBe(TODAY_INBOX_OPEN)
    })

    it('counts only the user and ignores archived and template projects, like the Home badge', () => {
        expect(state({ ...LOADED_EMPTY, p1: { someoneElse: 5 } })).toBe(TODAY_INBOX_EMPTY)
        expect(state({ ...LOADED_EMPTY, archived: { u1: 2 }, template: { u1: 1 } })).toBe(TODAY_INBOX_EMPTY)
    })

    it('is UNKNOWN while loading, after teardown, or with counts for an older project list', () => {
        expect(state({ loading: true })).toBe(TODAY_INBOX_UNKNOWN)
        expect(state({ ...LOADED_EMPTY, loading: true })).toBe(TODAY_INBOX_UNKNOWN)
        expect(state({ loading: false })).toBe(TODAY_INBOX_UNKNOWN)
        expect(state(undefined)).toBe(TODAY_INBOX_UNKNOWN)
        expect(state({ p1: {} })).toBe(TODAY_INBOX_UNKNOWN)
        expect(getTodayInboxState({ ...base, userId: null, sidebarNumbers: LOADED_EMPTY })).toBe(TODAY_INBOX_UNKNOWN)
        expect(getTodayInboxState({ ...base, projectIds: [], sidebarNumbers: {} })).toBe(TODAY_INBOX_UNKNOWN)
    })

    it('reads the store through the selector', () => {
        const store = {
            sidebarNumbers: { a: {}, b: { u1: 0 } },
            loggedUser: { uid: 'u1', archivedProjectIds: [], templateProjectIds: [] },
            loggedUserProjects: [{ id: 'a' }, { id: 'b' }],
        }
        expect(selectTodayInboxState(store)).toBe(TODAY_INBOX_EMPTY)
        expect(selectTodayInboxState({ ...store, sidebarNumbers: { loading: true } })).toBe(TODAY_INBOX_UNKNOWN)
        expect(selectTodayInboxState({ ...store, sidebarNumbers: { a: { u1: 1 }, b: {} } })).toBe(TODAY_INBOX_OPEN)
    })
})
