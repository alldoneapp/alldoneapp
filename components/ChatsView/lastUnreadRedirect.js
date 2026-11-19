import { DV_TAB_ROOT_CHATS, DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import { getFollowedAndUnfollowedChatNotificationsAmount } from '../../utils/notificationBadges'

/**
 * AT-3104: after the user clears unread messages from the Chats list, move on instead of leaving
 * them in an empty list.
 *
 * Red unread is an unread chat notification with `followed: true`, grey unread one with
 * `followed: false` (`projectChatNotifications[pid].totalFollowed` / `totalUnfollowed`, the counts
 * the red and grey badges are drawn from). The Followed tab of Chats lists only chats with red
 * unread messages; the All tab lists red and grey.
 *
 * Decisions this pins (Karsten, 2026-11-18 and 2026-11-19):
 *
 * - **The view decides, not the project that was touched.** The scope is what the Chats list shows:
 *   the selected project, or every project in All Projects (counted like the Chats tab chips and the
 *   top bar badge). The first version (!909) checked only the touched project, so in All Projects
 *   clearing project X opened X's tasks while other projects still had unread messages - the
 *   "still unread, but it sent me to the task list" report of 2026-11-19 (production logs: emails
 *   of "Privat" and "Alldone Business" archived seconds apart from All Projects).
 * - **Red, then grey, then tasks.** When an action clears the last red message of the scope on
 *   the Followed tab and grey ones remain, Chats switches to the All tab (keeping the Unread filter
 *   on or off as it was), so the grey messages show. The tasks open only when the scope has neither
 *   red nor grey unread left: the selected project's open tasks, or the All Projects task list.
 * - **Only after a user action in the Chats list.** Armed by the press itself (row Archive / Mark as
 *   read, the previews' Archive, a project line's or the All Projects line's Mark as read / Archive
 *   emails, More > Mark as read). Nothing that clears unread state on its own - the initial load,
 *   the Gmail read sync (AT-2376), another device, opening a thread - can ever navigate.
 *
 * Races it handles:
 *
 * - **Archive failures.** Archiving clears the unread state optimistically and puts it back if the
 *   mailbox refuses (AT-2424), 4-8s later. The redirect waits for the action to SUCCEED and then
 *   re-checks the live counts.
 * - **Overlapping presses.** While any armed action is still running, nothing is decided: in All
 *   Projects a pending archive of project Y has already cleared Y optimistically, and could still
 *   put it back. The last action to settle decides on the live counts; if it failed, nothing happens.
 * - **The user moved on.** The view (Chats list on screen), the selected project, the Chats tab,
 *   the Unread filter and the logged-in user are captured at the press and must be unchanged when
 *   the action settles. A newer press cancels an older pending check.
 * - **New unread messages** arriving before the action settles keep the user where they are.
 * - **A late local snapshot.** Offline, `awaitWriteAck` returns before the listener has delivered
 *   the delete. If the scope is not settled yet, the store is watched for a short window
 *   (LAST_UNREAD_SETTLE_MS) with the same checks.
 */

export const LAST_UNREAD_SETTLE_MS = 2000

// ProjectHelper's ALL_PROJECTS_INDEX. Not imported: ProjectHelper loads the store and the Firebase
// client, and this module is pulled into rows that are unit-tested on their own.
const ALL_PROJECTS_INDEX = -1

/** Every unread message of the project (red and grey), or null when not loaded. */
export const getProjectUnreadTotal = (projectChatNotifications, projectId) => {
    const projectNotifications = projectChatNotifications?.[projectId]
    if (!projectNotifications) return null
    return (Number(projectNotifications.totalFollowed) || 0) + (Number(projectNotifications.totalUnfollowed) || 0)
}

/**
 * The red and grey unread counts of what the Chats list shows: the selected project, or every
 * project in All Projects (the same count as the Chats tab chips and the top bar badge). Null when
 * the selected project's notifications are not loaded.
 */
export const getChatsScopeUnread = state => {
    const index = state?.selectedProjectIndex
    const projectChatNotifications = state?.projectChatNotifications || {}
    if (index === ALL_PROJECTS_INDEX) {
        const { totalFollowed, totalUnfollowed } = getFollowedAndUnfollowedChatNotificationsAmount(
            true,
            '',
            projectChatNotifications,
            state?.loggedUser?.archivedProjectIds || [],
            state?.loggedUser?.templateProjectIds || []
        )
        return { red: Number(totalFollowed) || 0, grey: Number(totalUnfollowed) || 0 }
    }
    const projectId = index > ALL_PROJECTS_INDEX ? state?.loggedUserProjects?.[index]?.id : null
    const projectNotifications = projectId ? projectChatNotifications[projectId] : null
    if (!projectNotifications) return null
    return {
        red: Number(projectNotifications.totalFollowed) || 0,
        grey: Number(projectNotifications.totalUnfollowed) || 0,
    }
}

/** What has to stay the same between the press and the redirect; null when the Chats list is not on screen. */
export const getChatsViewContext = state => {
    if (!state || state.route !== DV_TAB_ROOT_CHATS || state.selectedSidebarTab !== DV_TAB_ROOT_CHATS) return null
    return {
        selectedProjectIndex: state.selectedProjectIndex,
        projectId:
            state.selectedProjectIndex === ALL_PROJECTS_INDEX
                ? null
                : state.loggedUserProjects?.[state.selectedProjectIndex]?.id || null,
        chatsActiveTab: state.chatsActiveTab,
        unreadOnly: !!state.chatsUnreadOnly,
        userId: state.loggedUser?.uid || '',
    }
}

const sameContext = (previous, next) =>
    !!previous &&
    !!next &&
    previous.selectedProjectIndex === next.selectedProjectIndex &&
    previous.projectId === next.projectId &&
    previous.chatsActiveTab === next.chatsActiveTab &&
    previous.unreadOnly === next.unreadOnly &&
    previous.userId === next.userId

/** The project is on screen: All Projects, or the selected project is this one. */
export const isProjectInChatsView = (state, projectId) => {
    const index = state?.selectedProjectIndex
    if (index === ALL_PROJECTS_INDEX) return true
    return index > ALL_PROJECTS_INDEX && state?.loggedUserProjects?.[index]?.id === projectId
}

const uniqueProjectIds = projectIds => [...new Set((projectIds || []).filter(id => typeof id === 'string' && id))]

/** The project ids behind a set of linked emails (their chat comments' projects). */
export const getLinkedEmailsProjectIds = linkedEmails =>
    uniqueProjectIds(
        (linkedEmails || []).flatMap(email => [
            ...(email?.commentRefs || []).map(ref => ref?.projectId),
            email?.commentId ? email?.projectId : null,
        ])
    )

/**
 * What to do now that an action settled, from the live state: 'tasks' (nothing unread left in the
 * scope), 'grey' (the action cleared the last red message on the Followed tab, grey ones remain),
 * 'wait' (unread left that the user still sees) or 'cancel' (the user moved on).
 */
export const decideAfterUnreadAction = (state, context, { redAtPress = 0 } = {}) => {
    if (!sameContext(context, getChatsViewContext(state))) return 'cancel'
    const unread = getChatsScopeUnread(state)
    if (!unread) return 'cancel'
    if (unread.red + unread.grey === 0) return 'tasks'
    if (unread.red === 0 && redAtPress > 0 && context.chatsActiveTab === FOLLOWED_TAB) return 'grey'
    return 'wait'
}

/**
 * Builds the runner. Dependencies are injected so the race handling is testable without the store.
 *
 * `openTasks(projectId)` opens the project's tasks, or the All Projects task list for null.
 * `showGreyUnread(context)` switches Chats to the All tab.
 *
 * Returns `run(projectIds, action)`: runs `action` (sync or async) and returns its result unchanged.
 * An action that resolves to `false` (the archive hook's "failed") or throws never redirects.
 */
export function createLastUnreadRedirect({
    getState,
    subscribe,
    openTasks,
    showGreyUnread,
    settleMs = LAST_UNREAD_SETTLE_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
}) {
    let inFlight = 0
    // The armed presses still running or settling: the view they were made in and the most red
    // unread the scope had at any of them.
    let batch = null
    let waiter = null

    const cancelWaiter = () => {
        if (!waiter) return
        const current = waiter
        waiter = null
        current.cancel()
    }

    // 'done' (navigated or switched tab), 'wait' or 'cancel'.
    const tryRedirect = pending => {
        const decision = decideAfterUnreadAction(getState(), pending.context, pending)
        if (decision === 'tasks') {
            openTasks(pending.context.projectId)
            return 'done'
        }
        if (decision === 'grey') {
            showGreyUnread(pending.context)
            return 'done'
        }
        return decision
    }

    const settle = pending => {
        cancelWaiter()
        if (tryRedirect(pending) !== 'wait') return

        let unsubscribe = null
        let timer = null
        const self = {
            cancel: () => {
                if (unsubscribe) unsubscribe()
                if (timer !== null) clearTimer(timer)
            },
        }
        waiter = self
        unsubscribe = subscribe(() => {
            if (waiter !== self) return
            if (tryRedirect(pending) !== 'wait') cancelWaiter()
        })
        timer = setTimer(() => {
            if (waiter === self) cancelWaiter()
        }, settleMs)
    }

    return function runWithLastUnreadRedirect(projectIds, action) {
        const ids = uniqueProjectIds(projectIds)
        const state = getState()
        const context = getChatsViewContext(state)
        const unread = context ? getChatsScopeUnread(state) : null
        const armed =
            !!context &&
            !!unread &&
            unread.red + unread.grey > 0 &&
            ids.some(projectId => isProjectInChatsView(state, projectId))
        if (!armed) return action()

        // A newer press supersedes an older pending check.
        cancelWaiter()
        inFlight += 1
        batch =
            batch && sameContext(batch.context, context)
                ? { context, redAtPress: Math.max(batch.redAtPress, unread.red) }
                : { context, redAtPress: unread.red }

        const finish = succeeded => {
            inFlight -= 1
            if (inFlight > 0) return
            // The last armed action to settle decides, on the live counts.
            const pending = batch
            batch = null
            if (succeeded && pending) settle(pending)
        }

        let result
        try {
            result = action()
        } catch (error) {
            finish(false)
            throw error
        }
        return Promise.resolve(result).then(
            value => {
                finish(value !== false)
                return value
            },
            error => {
                finish(false)
                throw error
            }
        )
    }
}

/** The same dispatches as pressing the project in the sidebar: the project's open tasks. */
export function openProjectTasksFromChats(store, projectId) {
    const actions = require('../../redux/actions')
    const ProjectHelper = require('../SettingsView/ProjectsSettings/ProjectHelper').default
    const { dismissAllPopups } = require('../../utils/HelperFunctions')

    const { loggedUser, loggedUserProjects } = store.getState()
    const project = (loggedUserProjects || []).find(item => item.id === projectId)
    if (!project) return

    dismissAllPopups(true, true, true)
    store.dispatch([
        actions.hideFloatPopup(),
        actions.storeCurrentUser(loggedUser),
        actions.switchProject(project.index),
        actions.setSelectedTypeOfProject(ProjectHelper.getTypeOfProject(loggedUser, projectId)),
        actions.setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
        actions.setTaskViewToggleIndex(0),
        actions.setTaskViewToggleSection('Open'),
    ])
}

/** The All Projects task list (open tasks), as the thread view's "back to tasks" does. */
export function openAllProjectsTasksFromChats(store) {
    const actions = require('../../redux/actions')
    const { dismissAllPopups } = require('../../utils/HelperFunctions')

    dismissAllPopups(true, true, true)
    store.dispatch([actions.hideFloatPopup(), actions.navigateToAllProjectsTasks()])
}

/**
 * Chats > All tab, where the grey unread messages are listed. `Set chats active tab` turns the
 * Unread filter off, so it is put back as it was.
 */
export function showGreyUnreadInChats(store, context) {
    const actions = require('../../redux/actions')
    store.dispatch([actions.setChatsActiveTab(ALL_TAB), actions.setChatsUnreadOnly(!!context?.unreadOnly)])
}

let configuredStore = null
let defaultRunner = null

/**
 * Hands the app's redux store to the redirect; App.js calls it once at boot, next to the other
 * store observers.
 *
 * The store is passed in rather than required here on the first press. Requiring it pulls in the
 * Firebase client and most of the app, about 4.4s with a cold Jest cache, and every test that
 * presses an archive or mark-as-read button paid that inside its first case: on master pipeline
 * 3085791241 it pushed `ArchiveUnreadEmailsButton.test.js` past Jest's 5s timeout. Without a
 * configured store (component tests that render a row or a button on their own) the action simply
 * runs and nothing navigates.
 */
export function configureLastUnreadRedirect(store) {
    if (!store || store === configuredStore) return
    configuredStore = store
    defaultRunner = createLastUnreadRedirect({
        getState: store.getState,
        subscribe: store.subscribe,
        openTasks: projectId =>
            projectId ? openProjectTasksFromChats(store, projectId) : openAllProjectsTasksFromChats(store),
        showGreyUnread: context => showGreyUnreadInChats(store, context),
    })
}

/**
 * Runs a Chats-list archive / mark-as-read action and then moves on if it emptied what the user is
 * looking at. See the notes at the top of this file.
 */
export function runWithLastUnreadRedirect(projectIds, action) {
    return defaultRunner ? defaultRunner(projectIds, action) : action()
}
