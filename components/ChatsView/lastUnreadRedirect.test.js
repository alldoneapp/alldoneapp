import {
    createLastUnreadRedirect,
    createTaskListMemory,
    decideAfterUnreadAction,
    findBoardOwner,
    getChatsScopeUnread,
    getChatsViewContext,
    getLinkedEmailsProjectIds,
    getProjectUnreadTotal,
    getTaskListTarget,
    getTaskListView,
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

    it('keeps waiting when a new red message arrives before the red count reached 0', async () => {
        const { store, openTasks, showGreyUnread, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 2] },
        })
        const action = deferred()
        const pending = run(['p1'], () => action.promise)
        store.setUnread('p1', 2, 2)
        store.setUnread('p1', 1, 2)
        action.resolve(true)
        await pending
        expect(showGreyUnread).not.toHaveBeenCalled()
        expect(openTasks).not.toHaveBeenCalled()
    })

    // AT-3108: the grey step no longer waits for the mailbox either.
    it('switches to the grey messages as soon as the red count is 0, before the archive settles', () => {
        const { store, openTasks, showGreyUnread, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 2] },
        })
        run(['p1'], () => {
            store.setUnread('p1', 0, 2)
            return deferred().promise
        })
        expect(showGreyUnread).toHaveBeenCalledTimes(1)
        expect(openTasks).not.toHaveBeenCalled()
    })

    // A bulk Mark as read lands one project at a time: "no red, grey left" can be a step on the way.
    it('still opens the tasks when the same action then clears the grey messages too', async () => {
        const { store, openTasks, showGreyUnread, run } = setup({
            selectedProjectIndex: ALL,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 0], p2: [0, 2] },
        })
        const action = deferred()
        const pending = run(['p1', 'p2'], () => {
            store.setUnread('p1', 0, 0)
            return action.promise
        })
        expect(showGreyUnread).toHaveBeenCalledTimes(1)
        store.setUnread('p2', 0, 0)
        expect(openTasks).toHaveBeenCalledWith(null)
        action.resolve(true)
        await pending
        expect(openTasks).toHaveBeenCalledTimes(1)
        expect(store.listenerCount()).toBe(0)
    })

    it('does not open the tasks after its grey switch when the user then leaves Chats', async () => {
        const { store, openTasks, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 1] },
        })
        const action = deferred()
        const pending = run(['p1'], () => {
            store.setUnread('p1', 0, 1)
            return action.promise
        })
        store.update({ route: DV_TAB_ROOT_TASKS, selectedSidebarTab: DV_TAB_ROOT_TASKS })
        store.setUnread('p1', 0, 0)
        action.resolve(true)
        await pending
        expect(openTasks).not.toHaveBeenCalled()
        expect(store.listenerCount()).toBe(0)
    })
})

describe('createLastUnreadRedirect: races', () => {
    // AT-3108, the report of 2026-11-19: the row vanished, then nothing happened for the 4-8s
    // (13s cold) the Gmail archive plus the forced summary refresh take.
    it('opens the tasks as soon as the archive cleared the message locally, without waiting for Gmail', () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        run(['p1'], () => {
            store.setUnread('p1', 0) // the optimistic clear (AT-2424)
            return deferred().promise // the mailbox never answers in this test
        })
        expect(openTasks).toHaveBeenCalledTimes(1)
        expect(openTasks).toHaveBeenCalledWith('p1')
        expect(store.listenerCount()).toBe(0)
    })

    it('opens the tasks when the local clear lands after the press but before the archive settles', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        const archive = deferred()
        const pending = run(['p1'], () => archive.promise)
        expect(openTasks).not.toHaveBeenCalled()
        store.setUnread('p1', 0)
        expect(openTasks).toHaveBeenCalledTimes(1)
        archive.resolve(true)
        await pending
        expect(openTasks).toHaveBeenCalledTimes(1)
    })

    it('does not navigate again, and passes the failure on, when the archive fails after the redirect', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        const archive = deferred()
        let handle
        const pending = run(['p1'], redirect => {
            handle = redirect
            store.setUnread('p1', 0)
            return archive.promise
        })
        expect(handle.leftChats()).toBe(true)
        // The mailbox refuses: the unread state comes back (AT-2424) and the caller reports it.
        store.setUnread('p1', 1)
        archive.resolve(false)
        await expect(pending).resolves.toBe(false)
        expect(openTasks).toHaveBeenCalledTimes(1)
    })

    it('stays when the archive fails before the message was cleared', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        const archive = deferred()
        let handle
        const pending = run(['p1'], redirect => {
            handle = redirect
            return archive.promise
        })
        archive.resolve(false)
        await expect(pending).resolves.toBe(false)
        expect(handle.leftChats()).toBe(false)
        store.setUnread('p1', 0)
        expect(openTasks).not.toHaveBeenCalled()
        expect(store.listenerCount()).toBe(0)
    })

    it('stays when the action throws before the clear, and passes the error on', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        const failure = new Error('offline')
        await expect(
            run(['p1'], async () => {
                throw failure
            })
        ).rejects.toBe(failure)
        store.setUnread('p1', 0)
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('stays when the action throws synchronously, and passes the error on', () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        const failure = new Error('boom')
        expect(() =>
            run(['p1'], () => {
                throw failure
            })
        ).toThrow(failure)
        store.setUnread('p1', 0)
        expect(openTasks).not.toHaveBeenCalled()
        expect(store.listenerCount()).toBe(0)
    })

    // AT-3108: the view still decides (!914), but on the local counts, not on the mailbox: another
    // project's archive that already cleared its messages no longer holds the user back.
    it('in All Projects, opens the tasks once every project is cleared locally, archives still running', () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: ALL, unread: { p1: [1, 0], p2: [1, 0] } })
        run(['p2'], () => {
            store.setUnread('p2', 0)
            return deferred().promise
        })
        expect(openTasks).not.toHaveBeenCalled()
        run(['p1'], () => {
            store.setUnread('p1', 0)
            return deferred().promise
        })
        expect(openTasks).toHaveBeenCalledTimes(1)
        expect(openTasks).toHaveBeenCalledWith(null)
    })

    it('in All Projects, waits while another project archive has not cleared its message yet', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: ALL, unread: { p1: [1, 0], p2: [1, 0] } })
        const archive = deferred()
        const archivePending = run(['p2'], () => archive.promise)
        run(['p1'], () => store.setUnread('p1', 0))
        expect(openTasks).not.toHaveBeenCalled()
        store.setUnread('p2', 0)
        expect(openTasks).toHaveBeenCalledWith(null)
        archive.resolve(true)
        await archivePending
        expect(openTasks).toHaveBeenCalledTimes(1)
    })

    it('stays when the user left Chats, switched project, tab or Unread filter before the clear', async () => {
        const changes = [
            { route: DV_TAB_ROOT_TASKS, selectedSidebarTab: DV_TAB_ROOT_TASKS },
            { route: 'ChatDetailedView' },
            { selectedProjectIndex: 1 },
            { chatsActiveTab: FOLLOWED_TAB },
            { chatsUnreadOnly: false },
            { loggedUser: { uid: 'u2', archivedProjectIds: [], templateProjectIds: [] } },
        ]
        for (const change of changes) {
            const { store, openTasks, showGreyUnread, run } = setup({
                selectedProjectIndex: 0,
                unread: { p1: [1, 0], p2: [0, 0] },
            })
            const action = deferred()
            const pending = run(['p1'], () => action.promise)
            store.update(change)
            store.setUnread('p1', 0)
            action.resolve(true)
            await pending
            expect(openTasks).not.toHaveBeenCalled()
            expect(showGreyUnread).not.toHaveBeenCalled()
            expect(store.listenerCount()).toBe(0)
        }
    })

    it('stays when a new message arrives before the last one was cleared', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0 })
        const archive = deferred()
        const pending = run(['p1'], () => archive.promise)
        store.setUnread('p1', 2)
        store.setUnread('p1', 1)
        archive.resolve(true)
        await pending
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('in All Projects, stays when a new message arrived in another project before the clear', () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: ALL, unread: { p1: [1, 0], p2: [0, 0] } })
        run(['p1'], () => {
            store.setUnread('p2', 0, 1)
            store.setUnread('p1', 0)
            return deferred().promise
        })
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('navigates once for overlapping presses, as soon as the last message is cleared', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0, unread: { p1: [2, 0] } })
        const first = deferred()
        const second = deferred()
        const firstPending = run(['p1'], () => {
            store.setUnread('p1', 1)
            return first.promise
        })
        expect(openTasks).not.toHaveBeenCalled()
        const secondPending = run(['p1'], () => {
            store.setUnread('p1', 0)
            return second.promise
        })
        expect(openTasks).toHaveBeenCalledTimes(1)
        first.resolve(true)
        second.resolve(true)
        await Promise.all([firstPending, secondPending])
        expect(openTasks).toHaveBeenCalledTimes(1)
    })

    it('does not navigate when an overlapping press fails before the clear', async () => {
        const { store, openTasks, run } = setup({ selectedProjectIndex: 0, unread: { p1: [2, 0] } })
        const first = deferred()
        const second = deferred()
        const firstPending = run(['p1'], () => first.promise)
        const secondPending = run(['p1'], () => second.promise)
        first.resolve(false)
        await firstPending
        store.setUnread('p1', 0)
        second.resolve(true)
        await secondPending
        expect(openTasks).not.toHaveBeenCalled()
    })

    it('shares one watch across overlapping presses and switches to grey once', async () => {
        const { store, showGreyUnread, run } = setup({
            selectedProjectIndex: 0,
            chatsActiveTab: FOLLOWED_TAB,
            unread: { p1: [1, 2] },
        })
        const archive = deferred()
        const archivePending = run(['p1'], () => archive.promise)
        // Red is still 1 at this second press, which clears it; the first press had red too.
        await run(['p1'], () => store.setUnread('p1', 0, 2))
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
            // It keeps watching the All tab until the window ends (a bulk action may clear grey too).
            jest.advanceTimersByTime(LAST_UNREAD_SETTLE_MS + 1)
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

const LOGGED = { uid: 'u1', archivedProjectIds: [], templateProjectIds: [] }
const ANNA = { uid: 'anna', displayName: 'Anna' }
const COLLEAGUE = { uid: 'colleague' }
const STREAM = { uid: 'ws1' }

const taskListState = (patch = {}) => ({
    route: DV_TAB_ROOT_TASKS,
    selectedSidebarTab: DV_TAB_ROOT_TASKS,
    selectedProjectIndex: 1,
    loggedUser: LOGGED,
    currentUser: LOGGED,
    loggedUserProjects: [
        { id: 'p1', index: 0, globalAssistantIds: [] },
        { id: 'p2', index: 1, globalAssistantIds: ['global-anna'] },
    ],
    taskViewToggleIndex: 1,
    taskViewToggleSection: 'Workflow',
    projectUsers: { p2: [LOGGED, COLLEAGUE] },
    projectAssistants: { p2: [ANNA] },
    projectWorkstreams: { p2: [STREAM] },
    projectContacts: {},
    globalAssistants: [{ uid: 'global-anna' }],
    ...patch,
})

describe('the last task list on screen (AT-3108)', () => {
    it('reads the scope, the board and the Open / Workflow / Done toggle of the task list', () => {
        expect(getTaskListView(taskListState())).toEqual({
            userId: 'u1',
            projectId: 'p2',
            ownerId: 'u1',
            taskViewToggleIndex: 1,
            taskViewToggleSection: 'Workflow',
        })
        expect(getTaskListView(taskListState({ currentUser: ANNA, taskViewToggleSection: 'In progress' }))).toEqual(
            expect.objectContaining({ projectId: 'p2', ownerId: 'anna', taskViewToggleSection: 'In progress' })
        )
        expect(
            getTaskListView(
                taskListState({ selectedProjectIndex: ALL, taskViewToggleIndex: 2, taskViewToggleSection: 'Done' })
            )
        ).toEqual(expect.objectContaining({ projectId: null, ownerId: 'u1', taskViewToggleSection: 'Done' }))
    })

    it('is not a task list while Chats, a task, or the switch to Chats is on screen', () => {
        expect(
            getTaskListView(taskListState({ route: DV_TAB_ROOT_CHATS, selectedSidebarTab: DV_TAB_ROOT_CHATS }))
        ).toBeNull()
        expect(getTaskListView(taskListState({ selectedSidebarTab: DV_TAB_ROOT_CHATS }))).toBeNull()
        expect(getTaskListView(taskListState({ route: 'TaskDetailedView' }))).toBeNull()
        expect(getTaskListView(taskListState({ loggedUser: {} }))).toBeNull()
    })

    it('remembers the last one for the logged-in user only', () => {
        const memory = createTaskListMemory()
        memory.observe(taskListState())
        memory.observe(taskListState({ route: DV_TAB_ROOT_CHATS, selectedSidebarTab: DV_TAB_ROOT_CHATS }))
        expect(memory.get('u1')).toEqual(
            expect.objectContaining({ projectId: 'p2', taskViewToggleSection: 'Workflow' })
        )
        expect(memory.get('someone-else')).toBeNull()
    })

    it('finds the board owner as loaded for the project', () => {
        const state = taskListState()
        const p2 = state.loggedUserProjects[1]
        expect(findBoardOwner(state, p2, 'u1')).toBe(LOGGED)
        expect(findBoardOwner(state, p2, 'anna')).toBe(ANNA)
        expect(findBoardOwner(state, p2, 'colleague')).toBe(COLLEAGUE)
        expect(findBoardOwner(state, p2, 'ws1')).toBe(STREAM)
        expect(findBoardOwner(state, p2, 'global-anna')).toEqual({ uid: 'global-anna' })
        expect(findBoardOwner(state, state.loggedUserProjects[0], 'global-anna')).toBeNull()
        expect(findBoardOwner(state, p2, 'gone')).toBeNull()
    })

    it('targets the remembered board with its toggle', () => {
        const state = taskListState()
        const view = getTaskListView(taskListState({ currentUser: ANNA, taskViewToggleSection: 'In progress' }))
        expect(getTaskListTarget(state, 'p1', view)).toEqual({
            project: state.loggedUserProjects[1],
            owner: ANNA,
            toggle: { index: 1, section: 'In progress' },
        })
    })

    it("targets the user's own tasks of the project when the board owner is gone", () => {
        const view = getTaskListView(taskListState({ currentUser: ANNA, taskViewToggleSection: 'In progress' }))
        const target = getTaskListTarget(taskListState({ projectAssistants: { p2: [] } }), 'p1', view)
        expect(target.owner).toBe(LOGGED)
        expect(target.toggle).toEqual({ index: 0, section: 'Open' })
        const workflowView = getTaskListView(taskListState({ currentUser: COLLEAGUE }))
        const workflowTarget = getTaskListTarget(taskListState({ projectUsers: { p2: [LOGGED] } }), 'p1', workflowView)
        expect(workflowTarget.owner).toBe(LOGGED)
        expect(workflowTarget.toggle).toEqual({ index: 1, section: 'Workflow' })
    })

    it('targets All Projects with its toggle', () => {
        const view = getTaskListView(
            taskListState({ selectedProjectIndex: ALL, taskViewToggleIndex: 2, taskViewToggleSection: 'Done' })
        )
        expect(getTaskListTarget(taskListState(), 'p1', view)).toEqual({
            projectId: null,
            toggle: { index: 2, section: 'Done' },
        })
    })

    it('falls back to the !914 target without a remembered list, or when its project is gone', () => {
        const state = taskListState()
        expect(getTaskListTarget(state, 'p1', null)).toEqual({
            project: state.loggedUserProjects[0],
            owner: LOGGED,
            toggle: { index: 0, section: 'Open' },
        })
        expect(getTaskListTarget(state, null, null)).toEqual({ projectId: null, toggle: { index: 0, section: 'Open' } })
        const goneView = { userId: 'u1', projectId: 'gone', ownerId: 'u1', taskViewToggleIndex: 2 }
        expect(getTaskListTarget(state, 'p1', goneView).project).toBe(state.loggedUserProjects[0])
        expect(getTaskListTarget(state, 'gone', null)).toBeNull()
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
            navigateToAllProjectsTasks: options => ({ type: 'allProjectsTasks', options }),
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
        expect(dispatched).toEqual([
            [
                { type: 'hide' },
                { type: 'allProjectsTasks', options: { taskViewToggleIndex: 0, taskViewToggleSection: 'Open' } },
            ],
        ])
    })

    // AT-3108, the user flow: Workflow of project 2 -> Chats > All Projects -> archive the last one.
    it('goes back to the task list visited last, at once, with its board and toggle', () => {
        const { store, dispatched, run } = configure({ selectedProjectIndex: ALL, unread: { p1: [1, 0], p2: [0, 0] } })
        store.update({
            route: DV_TAB_ROOT_TASKS,
            selectedSidebarTab: DV_TAB_ROOT_TASKS,
            selectedProjectIndex: 1,
            currentUser: ANNA,
            projectAssistants: { p2: [ANNA] },
            taskViewToggleIndex: 1,
            taskViewToggleSection: 'In progress',
        })
        store.update({ route: DV_TAB_ROOT_CHATS, selectedSidebarTab: DV_TAB_ROOT_CHATS, selectedProjectIndex: ALL })
        run(['p1'], () => {
            store.setUnread('p1', 0)
            return new Promise(() => {}) // Gmail has not answered
        })
        expect(dispatched).toEqual([
            [
                { type: 'hide' },
                { type: 'user', user: ANNA },
                { type: 'switch', index: 1 },
                { type: 'projectType', projectType: 'active' },
                { type: 'tab', tab: DV_TAB_ROOT_TASKS },
                { type: 'toggleIndex', index: 1 },
                { type: 'toggleSection', section: 'In progress' },
            ],
        ])
    })

    it('goes back to the All Projects task list visited last, with its toggle', () => {
        const { store, dispatched, run } = configure({ selectedProjectIndex: 0, unread: { p1: [1, 0], p2: [3, 0] } })
        store.update({
            route: DV_TAB_ROOT_TASKS,
            selectedSidebarTab: DV_TAB_ROOT_TASKS,
            selectedProjectIndex: ALL,
            taskViewToggleIndex: 2,
            taskViewToggleSection: 'Done',
        })
        store.update({ route: DV_TAB_ROOT_CHATS, selectedSidebarTab: DV_TAB_ROOT_CHATS, selectedProjectIndex: 0 })
        run(['p1'], () => store.setUnread('p1', 0))
        expect(dispatched).toEqual([
            [
                { type: 'hide' },
                { type: 'allProjectsTasks', options: { taskViewToggleIndex: 2, taskViewToggleSection: 'Done' } },
            ],
        ])
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
