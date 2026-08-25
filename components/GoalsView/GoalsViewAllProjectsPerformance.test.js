/**
 * AT-2336 regression: "All projects - Goals" was slow because the board fans out one
 * `watchAllGoals` + one `watchAllMilestones` listener per active project (78 of them for the
 * account that reported it) and every resulting per-project redux write replaced the top-level
 * `boardMilestonesByProject` object. `GoalsViewAllProjects` subscribed to that whole object, so
 * each of the ~2 writes per project re-rendered the entire project tree: O(projects^2) renders
 * before the view settled.
 *
 * These tests pin the two properties that fix it:
 *   1. a write for project A must not re-render project B's row, and
 *   2. project listeners are admitted one-by-one while only the primary project owns page wait.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import {
    resetLoadingData,
    setBoardMilestonesInProject,
    setSharedData,
    storeCurrentUser,
    storeLoggedUser,
} from '../../redux/actions'

const renderCountsByProject = {}

// Mirrors the real module, which exports `React.memo(MilestonesListByProject)`. The memo is half
// the fix: without it every parent re-render still re-renders all 78 project rows.
jest.mock('./MilestonesListByProject', () => {
    const ReactModule = require('react')
    return {
        __esModule: true,
        default: ReactModule.memo(({ projectId }) => {
            renderCountsByProject[projectId] = (renderCountsByProject[projectId] || 0) + 1
            return ReactModule.createElement('div', { 'data-project': projectId })
        }),
    }
})

jest.mock('./EmptyGoalsAllProjects', () => ({
    __esModule: true,
    default: () => null,
}))

jest.mock('../../utils/backends/Goals/goalsFirestore', () => ({
    watchAllGoals: jest.fn(),
    watchAllMilestones: jest.fn(),
}))

jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { unwatch: jest.fn() },
}))

jest.mock('../../URLSystem/Goals/URLsGoals', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_ALL_PROJECTS_GOALS_OPEN: 'open',
    URL_ALL_PROJECTS_GOALS_DONE: 'done',
}))

const GoalsViewAllProjects = require('./GoalsViewAllProjects').default
const { watchAllGoals, watchAllMilestones } = require('../../utils/backends/Goals/goalsFirestore')
const Backend = require('../../utils/BackendBridge').default

const PROJECT_IDS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']

// `setSharedData` appends to `loggedUserProjects`, and the redux store is a module singleton, so
// the projects are seeded once for the whole file rather than per test.
const seedStoreOnce = () => {
    store.dispatch(
        storeLoggedUser({
            uid: 'user-1',
            projectIds: PROJECT_IDS,
            realProjectIds: PROJECT_IDS,
            archivedProjectIds: [],
            templateProjectIds: [],
            unlockedKeysByGuides: {},
        })
    )
    store.dispatch(storeCurrentUser({ uid: 'user-1' }))
    PROJECT_IDS.forEach(id => {
        store.dispatch(setSharedData({ id, name: id }, [], [], [], []))
    })
}

const clearBoards = () => {
    PROJECT_IDS.forEach(id => store.dispatch(setBoardMilestonesInProject(id, null)))
}

const noopProps = {
    openEdition: () => {},
    closeEdition: () => {},
    setDismissibleRefs: () => {},
    unsetDismissibleRefs: () => {},
}

describe('GoalsViewAllProjects performance (AT-2336)', () => {
    let tree

    beforeAll(() => {
        seedStoreOnce()
    })

    beforeEach(() => {
        jest.useFakeTimers()
        Object.keys(renderCountsByProject).forEach(key => delete renderCountsByProject[key])
        watchAllGoals.mockClear()
        watchAllMilestones.mockClear()
        Backend.unwatch.mockClear()
        watchAllGoals.mockImplementation((projectId, watcherKey, ownerId, options) =>
            options.onInitialSnapshot(projectId)
        )
        watchAllMilestones.mockImplementation((projectId, watcherKey, ownerId, options) =>
            options.onInitialSnapshot(projectId)
        )
        store.dispatch(resetLoadingData())
        clearBoards()
    })

    afterEach(() => {
        if (tree) {
            act(() => {
                tree.unmount()
            })
            tree = null
        }
        clearBoards()
        store.dispatch(resetLoadingData())
        jest.useRealTimers()
    })

    const mount = () => {
        act(() => {
            tree = renderer.create(
                <Provider store={store}>
                    <GoalsViewAllProjects {...noopProps} />
                </Provider>
            )
        })
    }

    const mountAll = () => {
        mount()
        for (let index = 1; index < PROJECT_IDS.length; index++) {
            act(() => {
                jest.advanceTimersByTime(500)
            })
        }
    }

    it('starts only the primary project listeners on the first render', () => {
        mount()
        expect(watchAllGoals).toHaveBeenCalledTimes(1)
        expect(watchAllMilestones).toHaveBeenCalledTimes(1)
        expect(watchAllGoals.mock.calls[0][3]).toEqual(
            expect.objectContaining({ manageLoading: true, trackConnectionHealth: true })
        )
        expect(watchAllMilestones.mock.calls[0][3]).toEqual(
            expect.objectContaining({ manageLoading: true, trackConnectionHealth: true })
        )
    })

    it('eventually watches every active project exactly once', () => {
        mountAll()
        expect(watchAllGoals).toHaveBeenCalledTimes(PROJECT_IDS.length)
        expect(watchAllMilestones).toHaveBeenCalledTimes(PROJECT_IDS.length)
        watchAllGoals.mock.calls.slice(1).forEach(call => {
            expect(call[3]).toEqual(expect.objectContaining({ manageLoading: false, trackConnectionHealth: false }))
        })
    })

    it('does not re-render other projects when one project board arrives', () => {
        mountAll()
        // p0 sorts first and therefore owns `firstMilestoneId`, which is shared by every row.
        act(() => {
            store.dispatch(setBoardMilestonesInProject('p0', [{ id: 'm-p0', date: 10 }]))
        })
        const rendersBefore = { ...renderCountsByProject }

        act(() => {
            store.dispatch(setBoardMilestonesInProject('p3', [{ id: 'm-p3', date: 100 }]))
        })

        // Only the project whose own board changed may re-render.
        expect(renderCountsByProject.p3).toBeGreaterThan(rendersBefore.p3)
        PROJECT_IDS.filter(id => id !== 'p3').forEach(id => {
            expect(renderCountsByProject[id]).toBe(rendersBefore[id])
        })
    })

    it('still propagates firstMilestoneId when the leading project changes', () => {
        // `firstMilestoneId` is one value shared by every row, so the row that becomes the first
        // visible project legitimately re-renders all of them. Pinned so the memoization above is
        // never "optimized" into dropping a real prop update.
        mountAll()
        const rendersAfterMount = { ...renderCountsByProject }
        act(() => {
            store.dispatch(setBoardMilestonesInProject('p5', [{ id: 'm-p5', date: 42 }]))
        })
        PROJECT_IDS.forEach(id => {
            expect(renderCountsByProject[id]).toBeGreaterThan(rendersAfterMount[id])
        })
    })

    it('settles in O(projects) renders, not O(projects^2), as each project board arrives', () => {
        mountAll()
        Object.keys(renderCountsByProject).forEach(key => delete renderCountsByProject[key])

        // One board write per project, exactly like one snapshot per per-project watcher.
        PROJECT_IDS.forEach((id, index) => {
            act(() => {
                store.dispatch(setBoardMilestonesInProject(id, [{ id: `m-${id}`, date: 100 + index }]))
            })
        })

        const totalRenders = Object.values(renderCountsByProject).reduce((sum, n) => sum + n, 0)
        // Before the fix this was ~projects^2 (each write re-rendered the whole tree).
        // Each write may legitimately re-render the changed row plus rows whose ordering/
        // firstMilestoneId changed, so allow generous headroom while still failing on N^2.
        expect(totalRenders).toBeLessThan(PROJECT_IDS.length * PROJECT_IDS.length)
    })

    it('re-renders when a project board is emptied again', () => {
        mountAll()
        act(() => {
            store.dispatch(setBoardMilestonesInProject('p2', [{ id: 'm-p2', date: 100 }]))
        })
        const before = renderCountsByProject.p2
        act(() => {
            store.dispatch(setBoardMilestonesInProject('p2', []))
        })
        expect(renderCountsByProject.p2).toBeGreaterThan(before)
    })

    it('unwatches both listeners for every admitted project on unmount', () => {
        mountAll()
        act(() => {
            tree.unmount()
            tree = null
        })
        expect(Backend.unwatch).toHaveBeenCalledTimes(PROJECT_IDS.length * 2)
    })
})
