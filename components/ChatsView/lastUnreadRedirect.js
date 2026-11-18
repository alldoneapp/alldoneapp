import { DV_TAB_ROOT_CHATS, DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'

/**
 * AT-3104 (decided with Karsten 2026-11-18): when the user archives or marks as read the LAST
 * unread message of a project from the Chats list, the app moves on to that project's open tasks
 * instead of leaving the user in an empty chat list.
 *
 * Decisions this pins:
 *
 * - **Only after a user action in the Chats list.** A redirect is armed by the press itself (row
 *   Archive / Mark as read, the email previews' Archive, the project line's Mark as read / Archive
 *   emails). Nothing that clears unread state on its own - the initial load, the Gmail read sync
 *   (AT-2376), another device, opening a thread - can ever navigate.
 * - **Single project and All Projects.** In All Projects, clearing project X's last message opens X's
 *   tasks even if other projects still have unread messages. An action that touches more than one
 *   project (the All Projects line's bulk buttons) never navigates: there is no single project to
 *   open.
 * - **"No unread left" means every unread message of the project**, followed and unfollowed, not
 *   just the active tab's count. On the Followed tab, unread messages of unfollowed topics keep the
 *   user in Chats.
 *
 * Races it handles:
 *
 * - **Archive failures.** Archiving clears the unread state optimistically and puts it back if the
 *   mailbox refuses (AT-2424), 4-8s later. The count therefore reaches 0 before we know the archive
 *   worked, so the redirect waits for the action to SUCCEED and re-checks the live count then.
 * - **Overlapping presses.** Several rows marked in quick succession: only the last action of the
 *   project to settle decides, and it decides on the live count.
 * - **The user moved on.** The view (Chats list on screen), the selected project and the logged-in
 *   user are captured at the press and must be unchanged when the action settles, or nothing
 *   happens. A newer press anywhere cancels an older pending check.
 * - **A late local snapshot.** Offline, `awaitWriteAck` returns before the listener has delivered
 *   the delete. If the count is not 0 yet when the action settles, the store is watched for a short
 *   window (LAST_UNREAD_SETTLE_MS) and the redirect happens only if it reaches 0 in that window
 *   with the view still unchanged.
 */

export const LAST_UNREAD_SETTLE_MS = 2000

// ProjectHelper's ALL_PROJECTS_INDEX. Not imported: ProjectHelper loads the store and the Firebase
// client, and this module is pulled into rows that are unit-tested on their own.
const ALL_PROJECTS_INDEX = -1

/** Every unread message of the project (followed and unfollowed), or null when not loaded. */
export const getProjectUnreadTotal = (projectChatNotifications, projectId) => {
    const projectNotifications = projectChatNotifications?.[projectId]
    if (!projectNotifications) return null
    return (Number(projectNotifications.totalFollowed) || 0) + (Number(projectNotifications.totalUnfollowed) || 0)
}

/** What has to stay the same between the press and the redirect; null when the Chats list is not on screen. */
export const getChatsViewContext = state => {
    if (!state || state.route !== DV_TAB_ROOT_CHATS || state.selectedSidebarTab !== DV_TAB_ROOT_CHATS) return null
    return { selectedProjectIndex: state.selectedProjectIndex, userId: state.loggedUser?.uid || '' }
}

const sameContext = (previous, next) =>
    !!previous &&
    !!next &&
    previous.selectedProjectIndex === next.selectedProjectIndex &&
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
 * Builds the runner. Dependencies are injected so the race handling is testable without the store.
 *
 * Returns `run(projectIds, action)`: runs `action` (sync or async) and returns its result unchanged.
 * An action that resolves to `false` (the archive hook's "failed") or throws never redirects.
 */
export function createLastUnreadRedirect({
    getState,
    subscribe,
    openProjectTasks,
    settleMs = LAST_UNREAD_SETTLE_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
}) {
    const inFlight = new Map()
    let waiter = null

    const cancelWaiter = () => {
        if (!waiter) return
        const current = waiter
        waiter = null
        current.cancel()
    }

    // 'done' (navigated), 'wait' (count not 0 yet) or 'cancel' (the user moved on).
    const tryRedirect = (projectId, context) => {
        const state = getState()
        if (!sameContext(context, getChatsViewContext(state))) return 'cancel'
        if (!isProjectInChatsView(state, projectId)) return 'cancel'
        const total = getProjectUnreadTotal(state.projectChatNotifications, projectId)
        if (total === null) return 'cancel'
        if (total > 0) return 'wait'
        openProjectTasks(projectId)
        return 'done'
    }

    const settle = (projectId, context) => {
        cancelWaiter()
        if (tryRedirect(projectId, context) !== 'wait') return

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
            if (tryRedirect(projectId, context) !== 'wait') cancelWaiter()
        })
        timer = setTimer(() => {
            if (waiter === self) cancelWaiter()
        }, settleMs)
    }

    return function runWithLastUnreadRedirect(projectIds, action) {
        const ids = uniqueProjectIds(projectIds)
        const state = getState()
        const context = getChatsViewContext(state)
        const projectId = ids.length === 1 ? ids[0] : null
        const armed =
            !!projectId &&
            !!context &&
            isProjectInChatsView(state, projectId) &&
            getProjectUnreadTotal(state.projectChatNotifications, projectId) > 0
        if (!armed) return action()

        // A newer press supersedes an older pending check, in this project or another.
        cancelWaiter()
        inFlight.set(projectId, (inFlight.get(projectId) || 0) + 1)

        const finish = succeeded => {
            const left = inFlight.get(projectId) - 1
            if (left > 0) inFlight.set(projectId, left)
            else inFlight.delete(projectId)
            // An earlier action of the same project still running decides when it settles.
            if (succeeded && left <= 0) settle(projectId, context)
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
        openProjectTasks: projectId => openProjectTasksFromChats(store, projectId),
    })
}

/**
 * Runs a Chats-list archive / mark-as-read action and, if it cleared the last unread message of
 * the one project it touched, opens that project's tasks. See the notes at the top of this file.
 */
export function runWithLastUnreadRedirect(projectIds, action) {
    return defaultRunner ? defaultRunner(projectIds, action) : action()
}
