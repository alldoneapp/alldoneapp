import { selectDeferredStartupFallbackAllowed, selectInitialTaskDataPublished } from './useDeferredStartupWork'
import { DV_TAB_ROOT_NOTES, DV_TAB_ROOT_TASKS } from '../utils/TabNavigationConstants'

const state = overrides => ({
    currentUser: { uid: 'user-1' },
    loggedUser: {
        uid: 'user-1',
        projectIds: ['p1', 'p2'],
        archivedProjectIds: [],
        templateProjectIds: [],
        guideProjectIds: [],
    },
    loggedUserProjects: [{ id: 'p1' }, { id: 'p2' }],
    selectedProjectIndex: -1,
    filteredOpenTasksStore: {},
    initialLoadingEndOpenTasks: {},
    initialLoadingEndObservedTasks: {},
    ...overrides,
})

describe('selectInitialTaskDataPublished', () => {
    it('keeps background fan-out behind task discovery after the first empty project answers', () => {
        expect(selectInitialTaskDataPublished(state({ initialLoadingEndOpenTasks: { 'p1user-1': true } }))).toBe(false)
    })

    it('releases deferred startup work when every scoped project has answered both task streams', () => {
        expect(
            selectInitialTaskDataPublished(
                state({
                    initialLoadingEndOpenTasks: { 'p1user-1': true, 'p2user-1': true },
                    initialLoadingEndObservedTasks: { 'p1user-1': true, 'p2user-1': true },
                })
            )
        ).toBe(true)
    })

    it('releases as soon as one scoped project publishes real task content', () => {
        expect(
            selectInitialTaskDataPublished(
                state({
                    filteredOpenTasksStore: {
                        'p2user-1': [['0', 3]],
                    },
                })
            )
        ).toBe(true)
    })

    it('ignores archived, template and guide projects when settling All Projects', () => {
        expect(
            selectInitialTaskDataPublished(
                state({
                    loggedUser: {
                        uid: 'user-1',
                        projectIds: ['p1', 'p2'],
                        archivedProjectIds: ['p2'],
                        templateProjectIds: [],
                        guideProjectIds: [],
                    },
                    initialLoadingEndOpenTasks: { 'p1user-1': true },
                    initialLoadingEndObservedTasks: { 'p1user-1': true },
                })
            )
        ).toBe(true)
    })

    it('ignores task readiness belonging to another account', () => {
        expect(selectInitialTaskDataPublished(state({ initialLoadingEndOpenTasks: { 'p1another-user': true } }))).toBe(
            false
        )
    })
})

describe('selectDeferredStartupFallbackAllowed', () => {
    it('keeps background listener fan-out behind real readiness on the task board', () => {
        expect(selectDeferredStartupFallbackAllowed({ route: DV_TAB_ROOT_TASKS })).toBe(false)
    })

    it('keeps the bounded fallback for routes that do not mount a task board', () => {
        expect(selectDeferredStartupFallbackAllowed({ route: DV_TAB_ROOT_NOTES })).toBe(true)
        expect(selectDeferredStartupFallbackAllowed({ route: null })).toBe(true)
    })
})
