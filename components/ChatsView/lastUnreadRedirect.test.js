import {
    createLastUnreadRedirect,
    decideAfterUnreadAction,
    getChatsScopeUnread,
    getChatsViewContext,
    getLinkedEmailsProjectIds,
    getProjectUnreadTotal,
    isProjectInChatsView,
    LAST_UNREAD_SETTLE_MS,
} from './lastUnreadRedirect'
import { DV_TAB_ROOT_CHATS, DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'

const ALL = -1

// `unread` is { projectId: [red, grey] }: red = followed unread, grey = unfollowed unread.
const makeStore = ({
    selectedProjectIndex = ALL,
    chatsActiveTab = ALL_TAB,
    chatsUnreadOnly = true,
    unread = { p1: [1, 0], p2: [2, 0] },
    loggedUser = { uid: 'u1', archivedProjectIds: [], templateProjectIds: [] },
} = {}) => {
    const listeners = new Set()
    let state = {
        route: DV_TAB_ROOT_CHATS,
        selectedSidebarTab: DV_TAB_ROOT_CHATS,
        selectedProjectIndex,
        chatsActiveTab,
        chatsUnreadOnly,
        loggedUser,
        loggedUserProjects: [
            { id: 'p1', index: 0 },
            { id: 'p2', index: 1 },
        ],
        projectChatNotifications: {},
    }
    const notify = () => listeners.forEach(listener => listener())
    const setUnread = (projectId, red, grey = 0) => {
        state = {
            ...state,
            projectChatNotifications: {
                ...state.projectChatNotifications,
                [projectId]: { totalFollowed: red, totalUnfollowed: grey },
            },
        }
        notify()
    }
    Object.entries(unread).forEach(([projectId, [red, grey]]) => setUnread(projectId, red, grey))
    return {
        getState: () => state,
        subscribe: listener => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        setUnread,
        update: patch => {
            state = { ...state, ...patch }
            notify()
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
    const openTasks = jest.fn()
    // Mirrors the app: switching the tab keeps the Unread filter as it was.
    const showGreyUnread = jest.fn(context =>
        store.update({ chatsActiveTab: ALL_TAB, chatsUnreadOnly: context.unreadOnly })
    )
    const run = createLastUnreadRedirect({
        getState: store.getState,
        subscribe: store.subscribe,
        openTasks,
        showGreyUnread,
    })
    return { store, openTasks, showGreyUnread, run }
}

describe('lastUnreadRedirect helpers', () => {
    it('counts every unread message of a project, red and grey', () => {
        expect(getProjectUnreadTotal({ p1: { totalFollowed: 2, totalUnfollowed: 3 } }, 'p1')).toBe(5)
        expect(getProjectUnreadTotal({ p1: { totalFollowed: 0, totalUnfollowed: 0 } }, 'p1')).toBe(0)
        expect(getProjectUnreadTotal({}, 'p1')).toBeNull()
    })

    it('counts the selected project, or every project in All Projects', () => {
        const store = makeStore({ unread: { p1: [1, 2], p2: [3, 4] } })
        expect(getChatsScopeUnread(store.getState())).toEqual({ red: 4, grey: 6 })
        store.update({ selectedProjectIndex: 1 })
        expect(getChatsScopeUnread(store.getState())).toEqual({ red: 3, grey: 4 })
        store.update({ projectChatNotifications: { p1: { totalFollowed: 1, totalUnfollowed: 0 } } })
        expect(getChatsScopeUnread(store.getState())).toBeNull()
    })

    it('leaves archived and template projects out of All Projects, like the Chats badges', () => {
        const store = makeStore({
            unread: { p1: [0, 0], p2: [0, 0], archived: [5, 1], template: [2, 2] },
            loggedUser: { uid: 'u1', archivedProjectIds: ['archived'], templateProjectIds: ['template'] },
        })
        expect(getChatsScopeUnread(store.getState())).toEqual({ red: 0, grey: 0 })
    })

    it('only treats the Chats list as the view to leave, and remembers tab and filter', () => {
        const base = {
            route: DV_TAB_ROOT_CHATS,
            selectedSidebarTab: DV_TAB_ROOT_CHATS,
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            chatsUnreadOnly: true,
            loggedUserProjects: [{ id: 'p1' }],
        }
        expect(getChatsViewContext(base)).toEqual({
            selectedProjectIndex: 0,
            projectId: 'p1',
            chatsActiveTab: FOLLOWED_TAB,
            unreadOnly: true,
            userId: '',
        })
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

    it('decides red, then grey, then tasks', () => {
        const store = makeStore({ selectedProjectIndex: 0, chatsActiveTab: FOLLOWED_TAB, unread: { p1: [0, 2] } })
        const context = getChatsViewContext(store.getState())
        expect(decideAfterUnreadAction(store.getState(), context, { redAtPress: 1 })).toBe('grey')
        // No red was cleared: the press was on a grey message already, nothing to move on to.
        expect(decideAfterUnreadAction(store.getState(), context, { redAtPress: 0 })).toBe('wait')
        store.setUnread('p1', 0, 0)
        expect(decideAfterUnreadAction(store.getState(), context, { redAtPress: 1 })).toBe('tasks')
        store.setUnread('p1', 1, 0)
        expect(decideAfterUnreadAction(store.getState(), context, { redAtPress: 1 })).toBe('wait')
    })
})

describe('createLastUnreadRedirect: what counts as "nothing unread left"', () => {
    it('opens the project tasks after the last unread message is marked read', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openTasks).toHaveBeenCalledWith('p1')
    })

    it('stays in Chats while the project still has unread messages', async () => {
        const { store, openTasks, showGreyUnread, run } = setup({ selectedProjectIndex: 1 })
        await run(['p2'], () => store.setUnread('p2', 1))
        expect(openTasks).not.toHaveBeenCalled()
        expect(showGreyUnread).not.toHaveBeenCalled()
    })

    // The production report of 2026-11-19: in All Projects, clearing "Privat" opened Privat's tasks
    // while "Alldone Business" still had unread messages. !909 checked only the touched project.
    it('stays in All Projects while another project still has unread messages', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: ALL, unread: { p1: [1, 0], p2: [2, 0] } })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('stays in All Projects while another project still has grey unread messages', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: ALL, unread: { p1: [1, 0], p2: [0, 3] } })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('opens the All Projects task list once no project has anything unread', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: ALL, unread: { p1: [1, 0], p2: [0, 0] } })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openTasks).toHaveBeenCalledTimes(1)
        expect(openTasks).toHaveBeenCalledWith(null)
    })

    it('arms for the All Projects line too (an action across projects)', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: ALL })
        await run(['p1', 'p2'], () => {
            store.setUnread('p1', 0)
            store.setUnread('p2', 0)
        })
        expect(openTasks).toHaveBeenCalledWith(null)
    })

    it('never navigates for a project that is not on screen', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 1, unread: { p1: [1, 0], p2: [0, 0] } })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('stays when red unread messages hidden by a tag filter remain', async () => {
        // The filtered "Mark as read" clears only the visible ads; a colleague's message is hidden.
        const { store, openTasks, showGreyUnread, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [3, 0] },
        })
        await run(['p1'], () => store.setUnread('p1', 1))
        expect(openTasks).not.toHaveBeenCalled()
        expect(showGreyUnread).not.toHaveBeenCalled()
    })

    it('ignores unread state of archived and template projects', async () => {
        const { store, openTasks, run } = setup({
            selectedProjectIndex: ALL,
            unread: { p1: [1, 0], p2: [0, 0], old: [4, 4] },
            loggedUser: { uid: 'u1', archivedProjectIds: ['old'], templateProjectIds: [] },
        })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openTasks).toHaveBeenCalledWith(null)
    })

    it('does not arm when nothing was unread at the press', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0, unread: { p1: [0, 0], p2: [0, 0] } })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('does not arm outside the Chats list', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        store.update({ route: 'ChatDetailedView' })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('never navigates when unread state clears without a press (initial load, Gmail sync)', () => {
        const { store, openTasks, showGreyUnread } = setup({ selectedProjectIndex: 0, chatsActiveTab: FOLLOWED_TAB })
        store.setUnread('p1', 0, 1)
        store.setUnread('p1', 0, 0)
        expect(openTasks).not.toHaveBeenCalled()
        expect(showGreyUnread).not.toHaveBeenCalled()
    })

    it('does not navigate when the selected project is not loaded (stale state)', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        await run(['p1'], () => store.update({ projectChatNotifications: {} }))
        expect(openTasks).not.toHaveBeenCalled()
    })
})

describe('createLastUnreadRedirect: red, then grey, then tasks', () => {
    it('switches the Followed tab to All when the last red message is cleared and grey ones remain', async () => {
        const { store, openTasks, showGreyUnread, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 2] },
        })
        await run(['p1'], () => store.setUnread('p1', 0, 2))
        expect(showGreyUnread).toHaveBeenCalledTimes(1)
        expect(showGreyUnread.mock.calls[0][0]).toMatchObject({ chatsActiveTab: FOLLOWED_TAB, unreadOnly: true })
        expect(store.getState().chatsActiveTab).toBe(ALL_TAB)
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('then opens the tasks once the grey messages are cleared on the All tab', async () => {
        const { store, openTasks, showGreyUnread, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 1] },
        })
        await run(['p1'], () => store.setUnread('p1', 0, 1))
        expect(showGreyUnread).toHaveBeenCalledTimes(1)
        await run(['p1'], () => store.setUnread('p1', 0, 0))
        expect(openTasks).toHaveBeenCalledWith('p1')
        expect(showGreyUnread).toHaveBeenCalledTimes(1)
    })

    it('goes straight to the tasks when the Followed tab clears the last red message and no grey is left', async () => {
        const { store, openTasks, showGreyUnread, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 0] },
        })
        await run(['p1'], () => store.setUnread('p1', 0, 0))
        expect(openTasks).toHaveBeenCalledWith('p1')
        expect(showGreyUnread).not.toHaveBeenCalled()
    })

    it('stays on the All tab, where the grey messages are already listed', async () => {
        const { store, openTasks, showGreyUnread, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: ALL_TAB,
            unread: { p1: [1, 2] },
        })
        await run(['p1'], () => store.setUnread('p1', 0, 2))
        expect(showGreyUnread).not.toHaveBeenCalled()
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('in All Projects, goes to grey only when no project has red unread left', async () => {
        const { store, openTasks, showGreyUnread, run } = setup({
            selectedProjectIndex: ALL,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 0], p2: [1, 4] },
        })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(showGreyUnread).not.toHaveBeenCalled()
        await run(['p2'], () => store.setUnread('p2', 0, 4))
        expect(showGreyUnread).toHaveBeenCalledTimes(1)
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('does not switch tabs for a press that cleared no red message', async () => {
        // A grey "Daily emails" preview archived on the Followed tab with no red left.
        const { store, showGreyUnread, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [0, 3] },
        })
        await run(['p1'], () => store.setUnread('p1', 0, 2))
        expect(showGreyUnread).not.toHaveBeenCalled()
    })

    it('keeps waiting when a new red message arrives before the action settles', async () => {
        const { store, openTasks, showGreyUnread, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 2] },
        })
        const action = deferred()
        const pending = run(['p1'], () => {
            store.setUnread('p1', 0, 2)
            return action.promise
        })
        store.setUnread('p1', 1, 2)
        action.resolve(true)
        await pending
        expect(showGreyUnread).not.toHaveBeenCalled()
        expect(openTasks).not.toHaveBeenCalled()
    })
})

describe('createLastUnreadRedirect: races', () => {
    it('waits for the archive to succeed and stays when it fails and restores the message', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        const archive = deferred()
        const pending = run(['p1'], () => {
            // Optimistic clear (AT-2424), then the mailbox refuses and the unread state comes back.
            store.setUnread('p1', 0)
            return archive.promise
        })
        expect(openTasks).not.toHaveBeenCalled()
        store.setUnread('p1', 1)
        archive.resolve(false)
        await expect(pending).resolves.toBe(false)
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('stays when the action throws, and passes the error on', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        const failure = new Error('offline')
        await expect(
            run(['p1'], async () => {
                store.setUnread('p1', 0)
                throw failure
            })
        ).rejects.toBe(failure)
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('opens the tasks once a slow archive succeeds', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        const archive = deferred()
        const pending = run(['p1'], () => {
            store.setUnread('p1', 0)
            return archive.promise
        })
        archive.resolve(true)
        await pending
        expect(openTasks).toHaveBeenCalledTimes(1)
    })

    // A transient empty state: project p2 looks empty only because its archive is still running.
    it('in All Projects, does not decide while another project archive is still running', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: ALL, unread: { p1: [1, 0], p2: [1, 0] } })
        const archive = deferred()
        const archivePending = run(['p2'], () => {
            store.setUnread('p2', 0)
            return archive.promise
        })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(openTasks).not.toHaveBeenCalled()
        // The mailbox refuses: p2's message comes back, and nobody was sent away.
        store.setUnread('p2', 1)
        archive.resolve(false)
        await archivePending
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('in All Projects, decides once the other project archive succeeded', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: ALL, unread: { p1: [1, 0], p2: [1, 0] } })
        const archive = deferred()
        const archivePending = run(['p2'], () => {
            store.setUnread('p2', 0)
            return archive.promise
        })
        await run(['p1'], () => store.setUnread('p1', 0))
        archive.resolve(true)
        await archivePending
        expect(openTasks).toHaveBeenCalledTimes(1)
        expect(openTasks).toHaveBeenCalledWith(null)
    })

    it('stays when the user left Chats, switched project, tab or Unread filter before the action settled', async () => {
        const changes = [
            { route: DV_TAB_ROOT_TASKS, selectedSidebarTab: DV_TAB_ROOT_TASKS },
            { selectedProjectIndex: 1 },
            { chatsActiveTab: FOLLOWED_TAB },
            { chatsUnreadOnly: false },
        ]
        for (const change of changes) {
            const { store, openTasks, run } = setup({ selectedProjectIndex: 0, unread: { p1: [1, 0], p2: [0, 0] } })
            const action = deferred()
            const pending = run(['p1'], () => action.promise)
            store.setUnread('p1', 0)
            store.update(change)
            action.resolve(true)
            await pending
            expect(openTasks).not.toHaveBeenCalled()
        }
    })

    it('stays when a new message arrives while the archive is running', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        const archive = deferred()
        const pending = run(['p1'], () => {
            store.setUnread('p1', 0)
            return archive.promise
        })
        store.setUnread('p1', 1)
        archive.resolve(true)
        await pending
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('in All Projects, stays when a new message arrives in another project', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: ALL, unread: { p1: [1, 0], p2: [0, 0] } })
        const archive = deferred()
        const pending = run(['p1'], () => {
            store.setUnread('p1', 0)
            return archive.promise
        })
        store.setUnread('p2', 0, 1)
        archive.resolve(true)
        await pending
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('lets the last of overlapping presses decide, and navigates once', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0, unread: { p1: [2, 0] } })
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
        expect(openTasks).not.toHaveBeenCalled()
        second.resolve(true)
        await secondPending
        expect(openTasks).toHaveBeenCalledTimes(1)
    })

    it('does not navigate when the last of overlapping presses fails', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0, unread: { p1: [2, 0] } })
        const first = deferred()
        const second = deferred()
        const firstPending = run(['p1'], () => first.promise)
        const secondPending = run(['p1'], () => second.promise)
        store.setUnread('p1', 0)
        first.resolve(true)
        await firstPending
        second.resolve(false)
        await secondPending
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('remembers the red messages of the first overlapping press for the grey step', async () => {
        const { store, showGreyUnread, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 2] },
        })
        const archive = deferred()
        const archivePending = run(['p1'], () => {
            store.setUnread('p1', 0, 2)
            return archive.promise
        })
        // Red is already 0 at this second press, but the batch did clear the last red message.
        await run(['p1'], () => undefined)
        archive.resolve(true)
        await archivePending
        expect(showGreyUnread).toHaveBeenCalledTimes(1)
    })

    describe('a late local snapshot', () => {
        beforeEach(() => jest.useFakeTimers())
        afterEach(() => jest.useRealTimers())

        it('navigates when the count reaches 0 shortly after the action settled', async () => {
            const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
            await run(['p1'], () => undefined)
            expect(openTasks).not.toHaveBeenCalled()
            store.setUnread('p1', 0)
            expect(openTasks).toHaveBeenCalledWith('p1')
            expect(store.listenerCount()).toBe(0)
        })

        it('switches to the grey messages when the red count reaches 0 shortly after', async () => {
            const { store, showGreyUnread, run } = setup({
                selectedProjectIndex: 0,
                chatsActiveTab: FOLLOWED_TAB,
                unread: { p1: [1, 1] },
            })
            await run(['p1'], () => undefined)
            store.setUnread('p1', 0, 1)
            expect(showGreyUnread).toHaveBeenCalledTimes(1)
            expect(store.listenerCount()).toBe(0)
        })

        it('gives up after the settle window', async () => {
            const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
            await run(['p1'], () => undefined)
            jest.advanceTimersByTime(LAST_UNREAD_SETTLE_MS + 1)
            expect(store.listenerCount()).toBe(0)
            store.setUnread('p1', 0)
            expect(openTasks).not.toHaveBeenCalled()
        })

        it('gives up when the user leaves Chats in the window', async () => {
            const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
            await run(['p1'], () => undefined)
            store.update({ route: 'ChatDetailedView' })
            store.setUnread('p1', 0)
            expect(openTasks).not.toHaveBeenCalled()
            expect(store.listenerCount()).toBe(0)
        })
    })
})

describe('runWithLastUnreadRedirect (the app instance)', () => {
    afterEach(() => {
        jest.resetModules()
        jest.dontMock('../../redux/store')
        jest.dontMock('../../redux/actions')
        jest.dontMock('../SettingsView/ProjectsSettings/ProjectHelper')
        jest.dontMock('../../utils/HelperFunctions')
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

    const configure = storeOptions => {
        jest.doMock('../../redux/actions', () => ({
            hideFloatPopup: () => ({ type: 'hide' }),
            storeCurrentUser: user => ({ type: 'user', user }),
            switchProject: index => ({ type: 'switch', index }),
            setSelectedTypeOfProject: type => ({ type: 'projectType', projectType: type }),
            setSelectedSidebarTab: tab => ({ type: 'tab', tab }),
            setTaskViewToggleIndex: index => ({ type: 'toggleIndex', index }),
            setTaskViewToggleSection: section => ({ type: 'toggleSection', section }),
            navigateToAllProjectsTasks: () => ({ type: 'allProjectsTasks' }),
            setChatsActiveTab: tab => ({ type: 'chatsTab', tab }),
            setChatsUnreadOnly: unreadOnly => ({ type: 'unreadOnly', unreadOnly }),
        }))
        jest.doMock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
            __esModule: true,
            default: { getTypeOfProject: () => 'active' },
        }))
        jest.doMock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))

        const store = makeStore(storeOptions)
        const dispatched = []
        const appStore = { ...store, dispatch: actions => dispatched.push(actions) }
        let lastUnreadRedirect
        jest.isolateModules(() => {
            lastUnreadRedirect = require('./lastUnreadRedirect')
        })
        lastUnreadRedirect.configureLastUnreadRedirect(appStore)
        return { store, dispatched, run: lastUnreadRedirect.runWithLastUnreadRedirect }
    }

    it('opens the selected project tasks through the store App.js configures', async () => {
        const { store, dispatched, run } = configure({ selectedProjectIndex: 1 })
        await run(['p2'], () => store.setUnread('p2', 0))
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

    it('opens the All Projects task list from All Projects', async () => {
        const { store, dispatched, run } = configure({ selectedProjectIndex: ALL, unread: { p1: [1, 0], p2: [0, 0] } })
        await run(['p1'], () => store.setUnread('p1', 0))
        expect(dispatched).toEqual([[{ type: 'hide' }, { type: 'allProjectsTasks' }]])
    })

    it('switches to the All tab with the Unread filter kept on', async () => {
        const { store, dispatched, run } = configure({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 1] },
        })
        await run(['p1'], () => store.setUnread('p1', 0, 1))
        expect(dispatched).toEqual([
            [
                { type: 'chatsTab', tab: ALL_TAB },
                { type: 'unreadOnly', unreadOnly: true },
            ],
        ])
    })
})
