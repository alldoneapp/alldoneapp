import {
    createLastUnreadRedirect,
    getChatsViewContext,
    getLinkedEmailsProjectIds,
    getProjectUnreadTotal,
    isProjectInChatsView,
    LAST_UNREAD_SETTLE_MS,
} from './lastUnreadRedirect'
import { DV_TAB_ROOT_CHATS, DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'

const ALL = -1

const makeStore = ({ selectedProjectIndex = ALL, unread = { p1: [1, 0], p2: [2, 0] } } = {}) => {
    const listeners = new Set()
    let state = {
        route: DV_TAB_ROOT_CHATS,
        selectedSidebarTab: DV_TAB_ROOT_CHATS,
        selectedProjectIndex,
        loggedUser: { uid: 'u1' },
        loggedUserProjects: [
            { id: 'p1', index: 0 },
            { id: 'p2', index: 1 },
        ],
        projectChatNotifications: {},
    }
    const setUnread = (projectId, followed, unfollowed = 0) => {
        state = {
            ...state,
            projectChatNotifications: {
                ...state.projectChatNotifications,
                [projectId]: { totalFollowed: followed, totalUnfollowed: unfollowed },
            },
        }
        listeners.forEach(listener => listener())
    }
    Object.entries(unread).forEach(([projectId, [followed, unfollowed]]) => setUnread(projectId, followed, unfollowed))
    return {
        getState: () => state,
        subscribe: listener => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        setUnread,
        update: patch => {
            state = { ...state, ...patch }
            listeners.forEach(listener => listener())
        },
        listenerCount: () => listeners.size,
    }
}

const deferred = () => {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

const setup = options => {
    const store = makeStore(options)
    const openProjectTasks = jest.fn()
    const run = createLastUnreadRedirect({
        getState: store.getState,
        subscribe: store.subscribe,
        openProjectTasks,
    })
    return { store, openProjectTasks, run }
}

describe('lastUnreadRedirect helpers', () => {
    it('counts every unread message of the project, followed and unfollowed', () => {
        expect(getProjectUnreadTotal({ p1: { totalFollowed: 2, totalUnfollowed: 3 } }, 'p1')).toBe(5)
        expect(getProjectUnreadTotal({ p1: { totalFollowed: 0, totalUnfollowed: 0 } }, 'p1')).toBe(0)
        expect(getProjectUnreadTotal({}, 'p1')).toBeNull()
    })

    it('only treats the Chats list as the view to leave', () => {
        const base = { route: DV_TAB_ROOT_CHATS, selectedSidebarTab: DV_TAB_ROOT_CHATS, selectedProjectIndex: 0 }
        expect(getChatsViewContext(base)).toEqual({ selectedProjectIndex: 0, userId: '' })
        expect(getChatsViewContext({ ...base, route: 'ChatDetailedView' })).toBeNull()
        expect(getChatsViewContext({ ...base, selectedSidebarTab: DV_TAB_ROOT_TASKS })).toBeNull()
    })

    it('knows whether a project is on screen', () => {
        const state = { selectedProjectIndex: 1, loggedUserProjects: [{ id: 'p1' }, { id: 'p2' }] }
        expect(isProjectInChatsView(state, 'p2')).toBe(true)
        expect(isProjectInChatsView(state, 'p1')).toBe(false)
        expect(isProjectInChatsView({ ...state, selectedProjectIndex: ALL }, 'p1')).toBe(true)
    })

    it('reads the projects behind linked emails from their comment refs', () => {
        expect(
            getLinkedEmailsProjectIds([
                { key: 'a', commentId: 'c1', projectId: 'p1', commentRefs: [{ projectId: 'p1', commentId: 'c1' }] },
                { key: 'b', commentRefs: [{ projectId: 'p2', commentId: 'c2' }] },
                { key: 'c' },
            ])
        ).toEqual(['p1', 'p2'])
    })
})

describe('createLastUnreadRedirect', () => {
    it('opens the project tasks after the last unread message is marked read', async () => {
        const { store, openProjectTasks, run } = setup()
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openProjectTasks).toHaveBeenCalledWith('p1')
    })

    it('stays in Chats while the project still has unread messages', async () => {
        const { store, openProjectTasks, run } = setup()
        await run(['p2'], () => store.setUnread('p2', 1))
        expect(openProjectTasks).not.toHaveBeenCalled()
    })

    it('counts unread messages of unfollowed topics too', async () => {
        const { store, openProjectTasks, run } = setup()
        await run(['p1'], () => store.setUnread('p1', 0, 1))
        expect(openProjectTasks).not.toHaveBeenCalled()
    })

    it('opens the cleared project from All Projects even if another project is still unread', async () => {
        const { store, openProjectTasks, run } = setup({ selectedProjectIndex: ALL })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(store.getState().projectChatNotifications.p2.totalFollowed).toBe(2)
        expect(openProjectTasks).toHaveBeenCalledWith('p1')
    })

    it('works in the selected project view, but never for a project that is not on screen', async () => {
        const selected = setup({ selectedProjectIndex: 0 })
        await selected.run(['p1'], () => selected.store.setUnread('p1', 0))
        expect(selected.openProjectTasks).toHaveBeenCalledWith('p1')

        const other = setup({ selectedProjectIndex: 1 })
        await other.run(['p1'], () => other.store.setUnread('p1', 0))
        expect(other.openProjectTasks).not.toHaveBeenCalled()
    })

    it('never navigates for an action across several projects', async () => {
        const { store, openProjectTasks, run } = setup()
        await run(['p1', 'p2'], () => {
            store.setUnread('p1', 0)
            store.setUnread('p2', 0)
        })
        expect(openProjectTasks).not.toHaveBeenCalled()
    })

    it('does not arm when nothing was unread at the press (no redirect for an already empty project)', async () => {
        const { store, openProjectTasks, run } = setup({ unread: { p1: [0, 0] } })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openProjectTasks).not.toHaveBeenCalled()
    })

    it('does not arm outside the Chats list', async () => {
        const { store, openProjectTasks, run } = setup()
        store.update({ route: 'ChatDetailedView' })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openProjectTasks).not.toHaveBeenCalled()
    })

    it('never navigates when unread state clears without a press (initial load, Gmail sync)', () => {
        const { store, openProjectTasks } = setup()
        store.setUnread('p1', 0)
        expect(openProjectTasks).not.toHaveBeenCalled()
    })

    it('waits for the archive to succeed and stays when it fails and restores the message', async () => {
        const { store, openProjectTasks, run } = setup()
        const archive = deferred()
        const pending = run(['p1'], () => {
            // Optimistic clear (AT-2424), then the mailbox refuses and the unread state comes back.
            store.setUnread('p1', 0)
            return archive.promise
        })
        expect(openProjectTasks).not.toHaveBeenCalled()
        store.setUnread('p1', 1)
        archive.resolve(false)
        await expect(pending).resolves.toBe(false)
        expect(openProjectTasks).not.toHaveBeenCalled()
    })

    it('stays when the action throws, and passes the error on', async () => {
        const { store, openProjectTasks, run } = setup()
        const failure = new Error('offline')
        await expect(
            run(['p1'], async () => {
                store.setUnread('p1', 0)
                throw failure
            })
        ).rejects.toBe(failure)
        expect(openProjectTasks).not.toHaveBeenCalled()
    })

    it('opens the tasks once a slow archive succeeds', async () => {
        const { store, openProjectTasks, run } = setup()
        const archive = deferred()
        const pending = run(['p1'], () => {
            store.setUnread('p1', 0)
            return archive.promise
        })
        archive.resolve(true)
        await pending
        expect(openProjectTasks).toHaveBeenCalledTimes(1)
    })

    it('stays when the user left Chats or switched project before the action settled', async () => {
        const left = setup()
        const leftAction = deferred()
        const leftPending = left.run(['p1'], () => leftAction.promise)
        left.store.setUnread('p1', 0)
        left.store.update({ route: DV_TAB_ROOT_TASKS, selectedSidebarTab: DV_TAB_ROOT_TASKS })
        leftAction.resolve(true)
        await leftPending
        expect(left.openProjectTasks).not.toHaveBeenCalled()

        const switched = setup()
        const switchedAction = deferred()
        const switchedPending = switched.run(['p1'], () => switchedAction.promise)
        switched.store.setUnread('p1', 0)
        switched.store.update({ selectedProjectIndex: 1 })
        switchedAction.resolve(true)
        await switchedPending
        expect(switched.openProjectTasks).not.toHaveBeenCalled()
    })

    it('stays when a new message arrives while the archive is running', async () => {
        const { store, openProjectTasks, run } = setup()
        const archive = deferred()
        const pending = run(['p1'], () => {
            store.setUnread('p1', 0)
            return archive.promise
        })
        store.setUnread('p1', 1)
        archive.resolve(true)
        await pending
        expect(openProjectTasks).not.toHaveBeenCalled()
    })

    it('lets the last of overlapping presses of a project decide, and navigates once', async () => {
        const { store, openProjectTasks, run } = setup({ unread: { p1: [2, 0] } })
        const first = deferred()
        const second = deferred()
        const firstPending = run(['p1'], () => {
            store.setUnread('p1', 1)
            return first.promise
        })
        const secondPending = run(['p1'], () => {
            store.setUnread('p1', 0)
            return second.promise
        })
        first.resolve(true)
        await firstPending
        expect(openProjectTasks).not.toHaveBeenCalled()
        second.resolve(true)
        await secondPending
        expect(openProjectTasks).toHaveBeenCalledTimes(1)
    })

    it('does not navigate when the last of overlapping presses fails', async () => {
        const { store, openProjectTasks, run } = setup({ unread: { p1: [2, 0] } })
        const first = deferred()
        const second = deferred()
        const firstPending = run(['p1'], () => first.promise)
        const secondPending = run(['p1'], () => second.promise)
        store.setUnread('p1', 0)
        first.resolve(true)
        await firstPending
        second.resolve(false)
        await secondPending
        expect(openProjectTasks).not.toHaveBeenCalled()
    })

    describe('a late local snapshot', () => {
        beforeEach(() => jest.useFakeTimers())
        afterEach(() => jest.useRealTimers())

        it('navigates when the count reaches 0 shortly after the action settled', async () => {
            const { store, openProjectTasks, run } = setup()
            await run(['p1'], () => undefined)
            expect(openProjectTasks).not.toHaveBeenCalled()
            store.setUnread('p1', 0)
            expect(openProjectTasks).toHaveBeenCalledWith('p1')
            expect(store.listenerCount()).toBe(0)
        })

        it('gives up after the settle window', async () => {
            const { store, openProjectTasks, run } = setup()
            await run(['p1'], () => undefined)
            jest.advanceTimersByTime(LAST_UNREAD_SETTLE_MS + 1)
            expect(store.listenerCount()).toBe(0)
            store.setUnread('p1', 0)
            expect(openProjectTasks).not.toHaveBeenCalled()
        })

        it('gives up when the user leaves Chats in the window', async () => {
            const { store, openProjectTasks, run } = setup()
            await run(['p1'], () => undefined)
            store.update({ route: 'ChatDetailedView' })
            store.setUnread('p1', 0)
            expect(openProjectTasks).not.toHaveBeenCalled()
            expect(store.listenerCount()).toBe(0)
        })
    })
})

describe('runWithLastUnreadRedirect (the app instance)', () => {
    afterEach(() => {
        jest.resetModules()
        jest.dontMock('../../redux/store')
    })

    it('never loads the redux store itself, so component tests stay fast', async () => {
        // Requiring the store cost ~4.4s with a cold Jest cache and timed out
        // ArchiveUnreadEmailsButton.test.js on master pipeline 3085791241.
        jest.doMock('../../redux/store', () => {
            throw new Error('lastUnreadRedirect must not require the store')
        })
        let result
        jest.isolateModules(() => {
            const { runWithLastUnreadRedirect } = require('./lastUnreadRedirect')
            result = runWithLastUnreadRedirect(['p1'], () => 'done')
        })
        expect(result).toBe('done')
    })

    it('opens the project tasks through the store App.js configures', async () => {
        jest.doMock('../../redux/actions', () => ({
            hideFloatPopup: () => ({ type: 'hide' }),
            storeCurrentUser: user => ({ type: 'user', user }),
            switchProject: index => ({ type: 'switch', index }),
            setSelectedTypeOfProject: type => ({ type: 'projectType', projectType: type }),
            setSelectedSidebarTab: tab => ({ type: 'tab', tab }),
            setTaskViewToggleIndex: index => ({ type: 'toggleIndex', index }),
            setTaskViewToggleSection: section => ({ type: 'toggleSection', section }),
        }))
        jest.doMock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
            __esModule: true,
            default: { getTypeOfProject: () => 'active' },
        }))
        jest.doMock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))

        const store = makeStore()
        const dispatched = []
        const appStore = { ...store, dispatch: actions => dispatched.push(actions) }

        let lastUnreadRedirect
        jest.isolateModules(() => {
            lastUnreadRedirect = require('./lastUnreadRedirect')
        })
        lastUnreadRedirect.configureLastUnreadRedirect(appStore)
        await lastUnreadRedirect.runWithLastUnreadRedirect(['p2'], () => store.setUnread('p2', 0))

        expect(dispatched).toHaveLength(1)
        expect(dispatched[0]).toEqual(
            expect.arrayContaining([
                { type: 'switch', index: 1 },
                { type: 'tab', tab: DV_TAB_ROOT_TASKS },
                { type: 'toggleIndex', index: 0 },
                { type: 'toggleSection', section: 'Open' },
            ])
        )
    })
})
