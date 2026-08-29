import { selectInitialTaskDataPublished } from './useDeferredStartupWork'

const state = overrides => ({
    currentUser: { uid: 'user-1' },
    loggedUser: { uid: 'user-1', projectIds: ['p1', 'p2'] },
    loggedUserProjects: [{ id: 'p1' }, { id: 'p2' }],
    initialLoadingEndOpenTasks: {},
    initialLoadingEndObservedTasks: {},
    ...overrides,
})

describe('selectInitialTaskDataPublished', () => {
    it('releases deferred startup work after either task stream publishes', () => {
        expect(selectInitialTaskDataPublished(state({ initialLoadingEndOpenTasks: { 'p1user-1': true } }))).toBe(true)
        expect(selectInitialTaskDataPublished(state({ initialLoadingEndObservedTasks: { 'p2user-1': true } }))).toBe(
            true
        )
    })

    it('ignores task readiness belonging to another account', () => {
        expect(selectInitialTaskDataPublished(state({ initialLoadingEndOpenTasks: { 'p1another-user': true } }))).toBe(
            false
        )
    })
})
