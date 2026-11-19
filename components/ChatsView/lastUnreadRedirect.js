import { DV_TAB_ROOT_CHATS, DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import { getFollowedAndUnfollowedChatNotificationsAmount } from '../../utils/notificationBadges'

/**
 * AT-3104: after the user clears unread messages from the Chats list, move on instead of leaving
 * them in an empty list. AT-3108: move on at once, and back to the task list they came from.
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
 *   red nor grey unread left.
 * - **At once, not after the mailbox (AT-3108).** Archive clears the unread state locally first
 *   (AT-2424) and only then archives in Gmail: two round trips (the archive plus a forced summary
 *   refresh), 4-8s, longer on a cold function. !914 decided only after that, so the list emptied
 *   and then nothing happened for seconds, and any click meanwhile cancelled the jump. The store is
 *   now watched from the press on and the decision is taken as soon as the local counts allow it.
 *   If the archive fails afterwards, the unread state comes back (AT-2424) and the user is told:
 *   the row alerts as always; the bulk buttons, whose red "try again" is then no longer on screen,
 *   alert through `leftChats()` (unreadEmailArchiveContext).
 * - **Back to the task list the user came from (AT-3108).** The last task list on screen is
 *   remembered: All Projects or one project, whose board (the user's own, a colleague's, a
 *   contact's, an assistant's or a workstream's - Karsten, 2026-11-19: "genau dieses Board") and
 *   its Open / Workflow / Done (an assistant's In progress) toggle. Without one (the session started
 *   in Chats, or that project is gone) the !914 target opens: the selected project's open tasks, or
 *   the All Projects task list. A board owner no longer found in the project opens the user's own
 *   tasks of that project.
 * - **Only after a user action in the Chats list.** Armed by the press itself (row Archive / Mark as
 *   read, the previews' Archive, a project line's or the All Projects line's Mark as read / Archive
 *   emails, More > Mark as read). Nothing that clears unread state on its own - the initial load,
 *   the Gmail read sync (AT-2376), another device, opening a thread - can ever navigate.
 *
 * Races it handles:
 *
 * - **Failures before the clear.** An action that fails (rejects, throws, or resolves to `false`,
 *   the archive hook's "failed") before anything was decided ends the watch: nothing happens.
 * - **Overlapping presses** in the same view share one watch, which stays open until the last of
 *   them settles; it decides once. A press in another view replaces it.
 * - **The user moved on.** The view (Chats list on screen), the selected project, the Chats tab,
 *   the Unread filter and the logged-in user are captured at the press; any change ends the watch.
 * - **New unread messages** arriving before the counts reach the target keep the user where they
 *   are.
 * - **A grey step in the middle of a bulk action.** Clearing several projects lands one project at
 *   a time, so "no red, grey left" can be a step on the way to "nothing left". After its own switch
 *   to the All tab the watch therefore keeps going in the new view and can still open the tasks.
 * - **A late local snapshot.** Offline, `awaitWriteAck` returns before the listener has delivered
 *   the delete. After the last action settled, the store is watched for a short window
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
 * What to do now, from the live state: 'tasks' (nothing unread left in the scope), 'grey' (the
 * armed presses cleared the last red message on the Followed tab, grey ones remain),
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
 * The task list on screen (AT-3108), or null when it is not the current view: All Projects
 * (`projectId: null`) or one project, whose board (`ownerId`, the `currentUser` the list shows) and
 * Open / Workflow / Done toggle. Both `route` and the sidebar tab must say Tasks: opening Chats
 * switches the tab in the same dispatch, before ChatsView replaces the route, and a task opened from
 * the list replaces the route.
 */
export const getTaskListView = state => {
    if (!state || state.route !== DV_TAB_ROOT_TASKS || state.selectedSidebarTab !== DV_TAB_ROOT_TASKS) return null
    const userId = state.loggedUser?.uid || ''
    if (!userId) return null
    const index = state.selectedProjectIndex
    const projectId = index === ALL_PROJECTS_INDEX ? null : state.loggedUserProjects?.[index]?.id || ''
    if (projectId === '') return null
    return {
        userId,
        projectId,
        ownerId: projectId ? state.currentUser?.uid || userId : userId,
        taskViewToggleIndex: state.taskViewToggleIndex,
        taskViewToggleSection: state.taskViewToggleSection,
    }
}

/** Remembers the last task list on screen; `observe` runs on every store change. */
export function createTaskListMemory() {
    let last = null
    let lastState = null
    return {
        observe: state => {
            if (state === lastState) return
            lastState = state
            const view = getTaskListView(state)
            if (view) last = view
        },
        get: userId => (last && userId && last.userId === userId ? last : null),
    }
}

/**
 * Builds the runner. Dependencies are injected so the race handling is testable without the store.
 *
 * `openTasks(projectId)` opens the task list (the remembered one; `projectId` is the !914 fallback:
 * the selected project, or null for All Projects). `showGreyUnread(context)` switches Chats to the
 * All tab.
 *
 * Returns `run(projectIds, action)`: runs `action` (sync or async) and returns its result unchanged.
 * The action receives `{ leftChats }`, telling whether its press has already opened the tasks.
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
    // The watch of the armed presses still running or settling: the view they were made in, the
    // most red unread the scope had at any of them, and how many are still running.
    let current = null

    const stop = watch => {
        if (!watch || watch.stopped) return
        watch.stopped = true
        if (current === watch) current = null
        if (watch.unsubscribe) watch.unsubscribe()
        if (watch.timer !== null) clearTimer(watch.timer)
        watch.timer = null
    }

    const check = watch => {
        // `switching`: our own tab switch dispatches, which calls this listener again mid-change.
        if (watch.stopped || watch.switching) return
        const decision = decideAfterUnreadAction(getState(), watch.context, watch)
        if (decision === 'wait') return
        if (decision === 'grey') {
            watch.switching = true
            showGreyUnread(watch.context)
            watch.switching = false
            // Keep watching in the All tab: a bulk action may still clear the grey ones (see top).
            watch.redAtPress = 0
            watch.context = getChatsViewContext(getState())
            if (!watch.context) stop(watch)
            else check(watch)
            return
        }
        // Stopped before navigating: the navigation dispatches, which calls this listener again.
        stop(watch)
        if (decision === 'tasks') {
            watch.leftChats = true
            openTasks(watch.context.projectId)
        }
    }

    const finish = (watch, succeeded) => {
        watch.inFlight -= 1
        if (watch.stopped) return
        if (!succeeded) {
            stop(watch)
            return
        }
        if (watch.inFlight > 0) return
        check(watch)
        if (!watch.stopped) watch.timer = setTimer(() => stop(watch), settleMs)
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
        if (!armed) return action(NOT_ARMED)

        let watch = current
        if (watch && sameContext(watch.context, context)) {
            watch.inFlight += 1
            watch.redAtPress = Math.max(watch.redAtPress, unread.red)
            if (watch.timer !== null) clearTimer(watch.timer)
            watch.timer = null
        } else {
            // A press in another view supersedes an older watch.
            stop(watch)
            watch = {
                context,
                redAtPress: unread.red,
                inFlight: 1,
                stopped: false,
                switching: false,
                leftChats: false,
                unsubscribe: null,
                timer: null,
            }
            current = watch
            // Watching from the press on: the clear lands in the local cache within the press,
            // seconds before the mailbox answers (AT-3108).
            watch.unsubscribe = subscribe(() => check(watch))
        }
        const handle = { leftChats: () => watch.leftChats }

        let result
        try {
            result = action(handle)
        } catch (error) {
            finish(watch, false)
            throw error
        }
        check(watch)
        return Promise.resolve(result).then(
            value => {
                finish(watch, value !== false)
                return value
            },
            error => {
                finish(watch, false)
                throw error
            }
        )
    }
}

const NOT_ARMED = Object.freeze({ leftChats: () => false })

/**
 * The board owner of a remembered task list (AT-3108): the logged user, or the colleague, contact,
 * assistant or workstream as currently loaded for that project; null when not found there.
 */
export const findBoardOwner = (state, project, ownerId) => {
    const loggedUser = state?.loggedUser
    if (!ownerId || ownerId === loggedUser?.uid) return loggedUser || null
    const projectId = project?.id
    const byId = list => (Array.isArray(list) ? list.find(item => item?.uid === ownerId) : null)
    return (
        byId(state?.projectUsers?.[projectId]) ||
        byId(state?.projectContacts?.[projectId]) ||
        byId(state?.projectAssistants?.[projectId]) ||
        byId(state?.projectWorkstreams?.[projectId]) ||
        ((project?.globalAssistantIds || []).includes(ownerId) ? byId(state?.globalAssistants) : null) ||
        null
    )
}

const OPEN_TOGGLE = { index: 0, section: 'Open' }

const rememberedToggle = view => ({
    index: Number.isInteger(view?.taskViewToggleIndex) ? view.taskViewToggleIndex : OPEN_TOGGLE.index,
    section:
        typeof view?.taskViewToggleSection === 'string' && view.taskViewToggleSection
            ? view.taskViewToggleSection
            : OPEN_TOGGLE.section,
})

/**
 * Where the redirect lands (AT-3108), from the live state: the remembered task list, else the !914
 * target (`fallbackProjectId`'s open tasks, or All Projects for null). Returns
 * `{ projectId: null, toggle }` for All Projects, `{ project, owner, toggle }` for a project, or
 * null when there is nowhere to go.
 */
export const getTaskListTarget = (state, fallbackProjectId, rememberedView) => {
    const projects = state?.loggedUserProjects || []
    const findProject = id => projects.find(item => item?.id === id) || null

    if (rememberedView && rememberedView.projectId === null) {
        return { projectId: null, toggle: rememberedToggle(rememberedView) }
    }
    const rememberedProject = rememberedView ? findProject(rememberedView.projectId) : null
    if (rememberedProject) {
        const owner = findBoardOwner(state, rememberedProject, rememberedView.ownerId)
        if (owner) return { project: rememberedProject, owner, toggle: rememberedToggle(rememberedView) }
        // The board's owner is no longer in the project: the user's own tasks there. An assistant's
        // In progress section does not exist on a person's board (UserLine maps it the same way).
        const toggle = rememberedToggle(rememberedView)
        return {
            project: rememberedProject,
            owner: state?.loggedUser || null,
            toggle: toggle.section === 'In progress' ? OPEN_TOGGLE : toggle,
        }
    }
    if (fallbackProjectId === null) return { projectId: null, toggle: OPEN_TOGGLE }
    const project = findProject(fallbackProjectId)
    return project ? { project, owner: state?.loggedUser || null, toggle: OPEN_TOGGLE } : null
}

/** Opens the task list `getTaskListTarget` picks, with the dispatches the sidebar uses. */
export function openTaskListFromChats(store, fallbackProjectId, rememberedView) {
    const actions = require('../../redux/actions')
    const ProjectHelper = require('../SettingsView/ProjectsSettings/ProjectHelper').default
    const { dismissAllPopups } = require('../../utils/HelperFunctions')

    const state = store.getState()
    const target = getTaskListTarget(state, fallbackProjectId, rememberedView)
    if (!target) return

    dismissAllPopups(true, true, true)
    if (!target.project) {
        store.dispatch([
            actions.hideFloatPopup(),
            actions.navigateToAllProjectsTasks({
                taskViewToggleIndex: target.toggle.index,
                taskViewToggleSection: target.toggle.section,
            }),
        ])
        return
    }
    store.dispatch([
        actions.hideFloatPopup(),
        actions.storeCurrentUser(target.owner),
        actions.switchProject(target.project.index),
        actions.setSelectedTypeOfProject(ProjectHelper.getTypeOfProject(state.loggedUser, target.project.id)),
        actions.setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
        actions.setTaskViewToggleIndex(target.toggle.index),
        actions.setTaskViewToggleSection(target.toggle.section),
    ])
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
 * store observers. From then on the last task list on screen is remembered (AT-3108): one cheap
 * comparison per store change.
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
    const taskListMemory = createTaskListMemory()
    taskListMemory.observe(store.getState())
    store.subscribe(() => taskListMemory.observe(store.getState()))
    defaultRunner = createLastUnreadRedirect({
        getState: store.getState,
        subscribe: store.subscribe,
        openTasks: projectId =>
            openTaskListFromChats(store, projectId, taskListMemory.get(store.getState().loggedUser?.uid)),
        showGreyUnread: context => showGreyUnreadInChats(store, context),
    })
}

/**
 * Runs a Chats-list archive / mark-as-read action and moves on as soon as it emptied what the user
 * is looking at. See the notes at the top of this file.
 */
export function runWithLastUnreadRedirect(projectIds, action) {
    return defaultRunner ? defaultRunner(projectIds, action) : action(NOT_ARMED)
}
