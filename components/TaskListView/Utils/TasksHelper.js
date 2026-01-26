import moment from 'moment'
import { findIndex, uniq } from 'lodash'

import store from '../../../redux/store'
import {
    setBacklinkSection,
    setGoalsActiveTab,
    setShowProjectDontExistInInvitationModal,
    setSelectedNavItem,
    setSelectedNote,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setSharedMode,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentUser,
    switchProject,
    unsetSharedMode,
    updateNotesActiveTab,
    setAddingUserToGuide,
    setNewUserNeedToJoinToProject,
    setUserInfoModalWhenUserJoinsToGuide,
    navigateToAllProjectsTasks,
    navigateToAllProjectsNotes,
    navigateToGoals,
} from '../../../redux/actions'
import ProjectHelper, {
    ALL_PROJECTS_INDEX,
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
    PROJECT_PRIVATE,
} from '../../SettingsView/ProjectsSettings/ProjectHelper'
import SearchHelper from '../../../utils/SearchHelper'
import URLsTasks, {
    URL_ALL_PROJECTS_TASKS,
    URL_ALL_PROJECTS_TASKS_DONE,
    URL_ALL_PROJECTS_TASKS_OPEN,
    URL_ALL_PROJECTS_TASKS_WORKFLOW,
    URL_PROJECT_USER_TASKS,
    URL_PROJECT_USER_TASKS_DONE,
    URL_PROJECT_USER_TASKS_IN_PROGRESS,
    URL_PROJECT_USER_TASKS_OPEN,
    URL_PROJECT_USER_TASKS_WORKFLOW,
    URL_TASK_DETAILS_BACKLINKS_NOTES,
    URL_TASK_DETAILS_BACKLINKS_TASKS,
} from '../../../URLSystem/Tasks/URLsTasks'
import Backend from '../../../utils/BackendBridge'
import { chronoEntriesOrder } from '../../../utils/HelperFunctions'
import URLsNotes, {
    URL_ALL_PROJECTS_NOTES_ALL,
    URL_ALL_PROJECTS_NOTES_FOLLOWED,
    URL_NOTE_DETAILS_BACKLINKS_NOTES,
    URL_NOTE_DETAILS_BACKLINKS_TASKS,
    URL_PROJECT_USER_NOTES_ALL,
    URL_PROJECT_USER_NOTES_FOLLOWED,
} from '../../../URLSystem/Notes/URLsNotes'
import URLsGoals, {
    URL_ALL_PROJECTS_GOALS,
    URL_ALL_PROJECTS_GOALS_DONE,
    URL_ALL_PROJECTS_GOALS_OPEN,
    URL_GOAL_DETAILS_BACKLINKS_NOTES,
    URL_GOAL_DETAILS_BACKLINKS_TASKS,
    URL_GOAL_DETAILS_TASKS_OPEN,
    URL_GOAL_DETAILS_TASKS_WORKFLOW,
    URL_GOAL_DETAILS_TASKS_DONE,
    URL_PROJECT_USER_GOALS_DONE,
    URL_PROJECT_USER_GOALS_OPEN,
} from '../../../URLSystem/Goals/URLsGoals'
import { ALL_TAB, FEED_PUBLIC_FOR_ALL, FOLLOWED_TAB } from '../../Feeds/Utils/FeedsConstants'
import {
    PROJECT_TYPE_ACTIVE,
    PROJECT_TYPE_GUIDE,
    PROJECT_TYPE_SHARED,
} from '../../SettingsView/ProjectsSettings/ProjectsSettings'
import { getUserOrContactForMentions, KARMA_TRIGGER, MENTION_SPACE_CODE } from '../../Feeds/Utils/HelperFunctions'
import {
    DV_TAB_GOAL_BACKLINKS,
    DV_TAB_GOAL_LINKED_TASKS,
    DV_TAB_GOAL_PROPERTIES,
    DV_TAB_NOTE_BACKLINKS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_SKILL_BACKLINKS,
    DV_TAB_SKILL_PROPERTIES,
    DV_TAB_TASK_BACKLINKS,
    DV_TAB_TASK_PROPERTIES,
    DV_TAB_TASK_SUBTASKS,
    ROOT_ROUTES,
} from '../../../utils/TabNavigationConstants'
import { GOALS_DONE_TAB_INDEX, GOALS_OPEN_TAB_INDEX } from '../../GoalsView/GoalsHelper'
import SharedHelper from '../../../utils/SharedHelper'
import { CURRENT_DAY_VERSION_ID } from '../../UIComponents/FloatModals/RevisionHistoryModal/RevisionHistoryModal'
import {
    COLOR_KEY_4,
    HASHTAG_COLOR_MAPPING,
} from '../../NotesView/NotesDV/EditorView/HashtagInteractionPopup/HashtagsInteractionPopup'
import {
    DEFAULT_WORKSTREAM_ID,
    getWorkstreamById,
    getWorkstreamInProject,
    isWorkstream,
    WORKSTREAM_ID_PREFIX,
} from '../../Workstreams/WorkstreamHelper'
import { ESTIMATION_0_MIN } from '../../../utils/EstimationHelper'
import {
    URL_SKILL_DETAILS_BACKLINKS_NOTES,
    URL_SKILL_DETAILS_BACKLINKS_TASKS,
} from '../../../URLSystem/Skills/URLsSkills'
import { NOT_PARENT_GOAL_INDEX } from '../../../utils/backends/openTasks'
import { ALL_GOALS_ID, allGoals } from '../../AllSections/allSectionHelper'
import { getProjectData } from '../../../utils/backends/firestore'
import {
    addUserToTemplate,
    checkIfUserIsAlreadyInTemplateGuide,
} from '../../../utils/backends/Projects/guidesFirestore'
import { getAssistant } from '../../AdminPanel/Assistants/assistantsHelper'
import { getSkillData } from '../../../utils/backends/Skills/skillsFirestore'
import { getWorkstreamData } from '../../../utils/backends/Workstreams/workstreamsFirestore'
import { getMentionData } from '../../../functions/Utils/parseTextUtils'
import NavigationService from '../../../utils/NavigationService'

export const TASK_ASSIGNEE_USER_TYPE = 'USER'
export const TASK_ASSIGNEE_WORKSTREAM_TYPE = 'WORKSTREAM'
export const TASK_ASSIGNEE_CONTACT_TYPE = 'CONTACT'
export const TASK_ASSIGNEE_ASSISTANT_TYPE = 'ASSISTANT'

export const TASK_TYPE_OPEN = 'open'
export const TASK_TYPE_PENDING = 'pending'
export const TASK_TYPE_DONE = 'done'
export const TASK_TYPE_UNDEFINED = 'undefined'
export const TASK_TYPE_BACKLOG = 'backlog'
export const TASK_TYPE_OBSERVED_OPEN = 'observed_open'
export const TASK_TYPE_OBSERVED_DONE = 'observed_done'
export const TASK_TYPE_OBSERVED_BACKLOG = 'observed_backlog'

export const BACKLOG_DATE_STRING = 'BACKLOG'
export const BACKLOG_DATE_NUMERIC = Number.MAX_SAFE_INTEGER

export const TOGGLE_INDEX_OPEN = 0
export const TOGGLE_INDEX_PENDING = 1
export const TOGGLE_INDEX_IN_PROGRESS = 1
export const TOGGLE_INDEX_DONE = 2

export const OPEN_STEP = -1
export const DONE_STEP = -2
export const NONE_STEP = -3

export const GENERIC_TASK_TYPE = 0
export const GENERIC_COMMENT_TYPE = 2
export const GENERIC_NOTE_TYPE = 3
export const GENERIC_GOAL_TYPE = 4
export const GENERIC_CHAT_TYPE = 5
export const GENERIC_SKILL_TYPE = 6

export const RECURRENCE_NEVER = 'never'
export const RECURRENCE_DAILY = 'daily'
export const RECURRENCE_EVERY_WORKDAY = 'everyWorkday'
export const RECURRENCE_WEEKLY = 'weekly'
export const RECURRENCE_EVERY_2_WEEKS = 'every2Weeks'
export const RECURRENCE_EVERY_3_WEEKS = 'every3Weeks'
export const RECURRENCE_MONTHLY = 'monthly'
export const RECURRENCE_EVERY_3_MONTHS = 'every3Months'
export const RECURRENCE_EVERY_6_MONTHS = 'every6Months'
export const RECURRENCE_ANNUALLY = 'annually'

export const MAX_GOLD_TO_EARN_BY_CHECK_TASKS = 5
export const MAX_GOLD_TO_EARN_BY_COMMENT = 3

export const RECURRENCE_MAP = {
    [RECURRENCE_NEVER]: { short: '', large: 'Never', shortcut: '0' },
    [RECURRENCE_DAILY]: { short: 'D', large: 'Daily', shortcut: '1' },
    [RECURRENCE_EVERY_WORKDAY]: { short: 'Mo-Fr', large: 'Every workday (Mo-Fr)', shortcut: '2' },
    [RECURRENCE_WEEKLY]: { short: 'W', large: 'Weekly', shortcut: '3' },
    [RECURRENCE_EVERY_2_WEEKS]: { short: '2 W', large: 'Every 2 weeks', shortcut: '4' },
    [RECURRENCE_EVERY_3_WEEKS]: { short: '3 W', large: 'Every 3 weeks', shortcut: '5' },
    [RECURRENCE_MONTHLY]: { short: 'M', large: 'Monthly', shortcut: '6' },
    [RECURRENCE_EVERY_3_MONTHS]: { short: '3 M', large: 'Every 3 months', shortcut: '7' },
    [RECURRENCE_EVERY_6_MONTHS]: { short: '6 M', large: 'Every 6 months', shortcut: '8' },
    [RECURRENCE_ANNUALLY]: { short: 'A', large: 'Annually', shortcut: '9' },
}

class TasksHelper {
    static fetchFromRoot = true

    /**
     * Determine if a task is Open
     *
     * @param task
     * @param loggedUser
     * @param currentUser
     * @param linkedParentObject
     * @returns {boolean}
     */
    static isOpenTask(task, loggedUser, currentUser, linkedParentObject) {
        if (linkedParentObject) {
            return (
                // Is not a sub task        AND
                task.parentId === null &&
                // Is not a Done task       AND
                !task.done &&
                // Is not a pending task
                task.userIds[task.userIds.length - 1] === currentUser.uid &&
                (!TasksHelper.isPrivateTask(task) || currentUser.uid === loggedUser.uid)
            )
        } else {
            return (
                // Is not a sub task        AND
                task.parentId === null &&
                // Is not a Done task       AND
                !task.done &&
                // Is not a pending task    OR
                ((task.userIds &&
                    task.userIds.length === 1 &&
                    // Task owner is the logged user        OR
                    task.userIds[0] === currentUser.uid) ||
                    // Is a pending task                    AND
                    (task.userIds &&
                        task.userIds.length > 1 &&
                        // Current user is the reviewer     AND
                        task.userIds[task.userIds.length - 1] === currentUser.uid)) &&
                // If is current user                       AND
                // task.userId === currentUser.uid &&
                // Task is not Private    OR     Is logged user     AND
                (!TasksHelper.isPrivateTask(task) || currentUser.uid === loggedUser.uid)
            )
        }
    }

    /**
     * Determine if a task is pending
     *
     * @param task
     * @param currentUser
     * @param linkedParentObject
     * @returns {boolean}
     */
    static isPendingTask(task, currentUser, linkedParentObject) {
        if (linkedParentObject) {
            // Is not a sub task        AND
            task.parentId === null && task.userIds.length > 1 && task.done === false
        } else {
            return (
                // Is not a sub task        AND
                task.parentId === null &&
                task.userIds &&
                task.userIds.length > 1 &&
                task.userIds.includes(currentUser.uid) &&
                task.userIds[task.userIds.length - 1] !== currentUser.uid &&
                task.done === false
            )
        }
    }

    /**
     * Determine if a task is Done
     *
     * @param task
     * @param loggedUser
     * @param currentUser
     * @param linkedParentObject
     * @returns {boolean|*}
     */
    static isDoneTask(task, loggedUser, currentUser, linkedParentObject) {
        if (linkedParentObject) {
            return (
                // Is not a sub task        AND
                task.parentId === null &&
                // Is a Done task           AND
                task.done &&
                // Task is not Private    OR     Is logged user     AND
                (!TasksHelper.isPrivateTask(task) || currentUser.uid === loggedUser.uid)
            )
        } else {
            return (
                // Is not a sub task        AND
                task.parentId === null &&
                // Is a Done task           AND
                task.done &&
                task.userIds &&
                // If is the assignee                       AND
                task.userId === currentUser.uid &&
                // Task is not Private    OR     Is logged user     AND
                (!TasksHelper.isPrivateTask(task) || currentUser.uid === loggedUser.uid)
            )
        }
    }

    /**
     * Determine if an observed task is Open
     *
     * @param task
     * @param currentUser
     * @returns {boolean}
     */
    static isOpenObservedTask(task, currentUser) {
        return (
            // Is not a sub task        AND
            task.parentId === null &&
            // Is not a Done task       AND
            !task.done &&
            // Current user is an observer
            task.observersIds.includes(currentUser.uid)
        )
    }

    /**
     * Determine if an observed task is Done
     *
     * @param task
     * @param currentUser
     * @returns {boolean|*}
     */
    static isDoneObservedTask(task, currentUser) {
        return (
            // Is not a sub task        AND
            task.parentId === null &&
            // Is a Done task           AND
            task.done &&
            // Current user is an observer
            task.observersIds.includes(currentUser.uid)
        )
    }

    static taskMatchWithSearchText = (task, searchText, matchSubtasks = true) => {
        const subtaskNames = task.subtaskNames && task.subtaskNames.length > 0 ? task.subtaskNames.join(' ') : ''

        // Task name [or sub tasks names] have the search text inside
        return (
            searchText === '' ||
            SearchHelper.matchSearch(task.name, searchText) ||
            // Sub Tasks names have the search text inside
            (matchSubtasks && SearchHelper.matchSearch(subtaskNames, searchText))
        )
    }

    static getNewDefaultTask = useLoggedUser => {
        const { loggedUser, currentUser, inBacklinksView } = store.getState()
        const date = Date.now()
        return {
            done: false,
            inDone: false,
            name: '',
            extendedName: '',
            description: '',
            userId: inBacklinksView || useLoggedUser ? loggedUser.uid : currentUser.uid,
            userIds: inBacklinksView || useLoggedUser ? [loggedUser.uid] : [currentUser.uid],
            currentReviewerId: inBacklinksView || useLoggedUser ? loggedUser.uid : currentUser.uid,
            observersIds: [],
            dueDateByObserversIds: {},
            estimationsByObserverIds: {},
            stepHistory: [OPEN_STEP],
            hasStar: '#FFFFFF',
            created: date,
            creatorId: loggedUser.uid,
            dueDate: date,
            completed: null,
            isPrivate: false,
            isPublicFor: [FEED_PUBLIC_FOR_ALL],
            parentId: null,
            isSubtask: false,
            subtaskIds: [],
            subtaskNames: [],
            recurrence: RECURRENCE_NEVER,
            lastEditorId: loggedUser.uid,
            lastEditionDate: date,
            linkBack: '',
            estimations: { [OPEN_STEP]: ESTIMATION_0_MIN },
            comments: [],
            commentsData: null,
            genericData: null,
            sortIndex: Backend.generateSortIndex(),
            linkedParentNotesIds: [],
            linkedParentTasksIds: [],
            linkedParentContactsIds: [],
            linkedParentProjectsIds: [],
            linkedParentGoalsIds: [],
            linkedParentSkillsIds: [],
            linkedParentAssistantIds: [],
            parentDone: false,
            suggestedBy: null,
            parentGoalId: null,
            parentGoalIsPublicFor: null,
            noteId: null,
            containerNotesIds: [],
            calendarData: null,
            gmailData: null,
            timesPostponed: 0,
            timesFollowed: 0,
            timesDoneInExpectedDay: 0,
            timesDone: 0,
            isPremium: false,
            lockKey: '',
            assigneeType: TASK_ASSIGNEE_USER_TYPE,
            assistantId: '',
            commentsData: null,
            autoEstimation: null,
            completedTime: null,
            // shared: SHARE_ALL_SEE_MEMBER_EDIT,
        }
    }

    static getNewDefaultNote = () => {
        const { loggedUser } = store.getState()
        const now = Date.now()

        return {
            title: '',
            extendedTitle: '',
            preview: '',
            created: now,
            lastEditionDate: now,
            lastEditorId: loggedUser.uid,
            views: 0,
            creatorId: loggedUser.uid,
            hasStar: '#FFFFFF',
            isPrivate: false,
            isPublicFor: [FEED_PUBLIC_FOR_ALL, loggedUser.uid],
            userId: loggedUser.uid,
            stickyData: { stickyEndDate: 0, days: 0 },
            linkedParentNotesIds: [],
            linkedParentTasksIds: [],
            linkedParentContactsIds: [],
            linkedParentProjectsIds: [],
            linkedParentGoalsIds: [],
            linkedParentSkillsIds: [],
            linkedParentAssistantIds: [],
            linkedParentsInTitleIds: {},
            linkedParentsInContentIds: {},
            versionId: CURRENT_DAY_VERSION_ID,
            isVisibleInFollowedFor: [],
            followersIds: [],
            parentObject: null,
            isPremium: false,
            linkedToTemplate: false,
            assistantId: '',
            commentsData: null,
        }
    }

    /**
     * Perf: Should be migrated??? (using inReview)
     * @param steps
     * @param task
     * @returns {{nextStepNum: number, steps: *, selected: *}|{nextStepNum: *, steps: *, selected: *}}
     */
    static getWorkflowStatusOfTask = (steps, task) => {
        if (steps) {
            let selected
            let nextStepNum = ''
            if (task.done) {
                return {
                    steps: steps,
                    selected: DONE_STEP,
                    nextStepNum: OPEN_STEP,
                }
            }

            const stepsEntries = Object.entries(steps).sort(chronoEntriesOrder)
            for (selected = 0; selected < stepsEntries.length; ++selected) {
                if (stepsEntries[selected][0] === task.stepHistory[task.stepHistory.length - 1]) {
                    nextStepNum = selected + 1
                    break
                }
            }

            return {
                steps: steps,
                selected: task.stepHistory.length === 1 ? OPEN_STEP : selected,
                nextStepNum: nextStepNum === stepsEntries.length - 1 ? OPEN_STEP : nextStepNum,
            }
        }
    }

    static getToggleSectionByURLConstant = (constant, isAllProjects = false) => {
        switch (constant) {
            case isAllProjects ? URL_ALL_PROJECTS_TASKS_OPEN : URL_PROJECT_USER_TASKS_OPEN:
                return { index: TOGGLE_INDEX_OPEN, name: 'Open' }
            case isAllProjects ? URL_ALL_PROJECTS_TASKS_WORKFLOW : URL_PROJECT_USER_TASKS_WORKFLOW:
                return { index: TOGGLE_INDEX_PENDING, name: 'Workflow' }
            case URL_PROJECT_USER_TASKS_IN_PROGRESS:
                return { index: TOGGLE_INDEX_IN_PROGRESS, name: 'In progress' }
            case isAllProjects ? URL_ALL_PROJECTS_TASKS_DONE : URL_PROJECT_USER_TASKS_DONE:
                return { index: TOGGLE_INDEX_DONE, name: 'Done' }

            case isAllProjects ? URL_ALL_PROJECTS_GOALS_OPEN : URL_PROJECT_USER_GOALS_OPEN:
                return { index: GOALS_OPEN_TAB_INDEX, name: 'Open' }
            case isAllProjects ? URL_ALL_PROJECTS_GOALS_DONE : URL_PROJECT_USER_GOALS_DONE:
                return { index: GOALS_DONE_TAB_INDEX, name: 'Done' }

            default:
                return { index: TOGGLE_INDEX_OPEN, name: 'Open' }
        }
    }

    static getURLConstantByToggleIndex = (index, isAllProjects, userIsAssistant) => {
        switch (index) {
            case TOGGLE_INDEX_OPEN:
                return isAllProjects ? URL_ALL_PROJECTS_TASKS_OPEN : URL_PROJECT_USER_TASKS_OPEN
            case TOGGLE_INDEX_PENDING || TOGGLE_INDEX_IN_PROGRESS:
                return userIsAssistant
                    ? URL_PROJECT_USER_TASKS_IN_PROGRESS
                    : isAllProjects
                    ? URL_ALL_PROJECTS_TASKS_WORKFLOW
                    : URL_PROJECT_USER_TASKS_WORKFLOW
            case TOGGLE_INDEX_DONE:
                return isAllProjects ? URL_ALL_PROJECTS_TASKS_DONE : URL_PROJECT_USER_TASKS_DONE
            default:
                return isAllProjects ? URL_ALL_PROJECTS_TASKS_OPEN : URL_PROJECT_USER_TASKS_OPEN
        }
    }

    static processURLAllProjectsTasks = (navigation, section = URL_ALL_PROJECTS_TASKS_OPEN) => {
        const { index: toggleIndex, name: toggleName } = TasksHelper.getToggleSectionByURLConstant(section, true)
        navigation.navigate('Root')
        store.dispatch(
            navigateToAllProjectsTasks({ taskViewToggleSection: toggleName, taskViewToggleIndex: toggleIndex })
        )
        URLsTasks.replace(section)
    }

    static processURLAllProjectsNotes = (navigation, tab = FOLLOWED_TAB) => {
        const { selectedSidebarTab } = store.getState()
        if (!selectedSidebarTab) navigation.navigate('Root')
        store.dispatch(navigateToAllProjectsNotes({ notesActiveTab: tab }))
        URLsNotes.replace(tab === ALL_TAB ? URL_ALL_PROJECTS_NOTES_ALL : URL_ALL_PROJECTS_NOTES_FOLLOWED)
    }

    static processURLAllProjectsGoals = (navigation, section = URL_ALL_PROJECTS_GOALS_OPEN) => {
        const { selectedSidebarTab } = store.getState()
        const { index: toggleIndex } = TasksHelper.getToggleSectionByURLConstant(section, true)
        if (!selectedSidebarTab) navigation.navigate('Root')
        store.dispatch(navigateToGoals({ goalsActiveTab: toggleIndex, selectedProjectIndex: ALL_PROJECTS_INDEX }))
        URLsGoals.replace(section)
    }

    static tryToJoinUserToProject = async (navigation, projectId, navigateToAllProjects, redirectFn) => {
        // If I'm not a member, then try to join to it
        const { loggedUser } = store.getState()

        let project = await Backend.getProjectData(projectId)

        const failProcess = (showMessage = true) => {
            navigateToAllProjects()
            if (showMessage) store.dispatch(setShowProjectDontExistInInvitationModal(true))
            redirectFn?.()
        }

        if (project.isShared !== PROJECT_PRIVATE) {
            ProjectHelper.processProjectInvitation(navigation, loggedUser.uid, projectId).then(user => {
                if (user == null) {
                    failProcess()
                }
            })
        } else {
            failProcess(false)
        }
    }

    static processURLProjectsUserTasks = async (
        navigation,
        projectId,
        userId,
        section = URL_PROJECT_USER_TASKS_OPEN
    ) => {
        const {
            loggedUserProjects,
            loggedUser,
            projectUsers,
            projectContacts,
            newUserNeedToJoinToProject,
            projectAssistants,
            globalAssistants,
        } = store.getState()

        // Am I member of this project?
        const projectIndex = findIndex(loggedUserProjects, ['id', projectId])
        const { index: toggleIndex, name: toggleName } = TasksHelper.getToggleSectionByURLConstant(section)

        const joinProject = async () => {
            const redirectFn = () => URLsTasks.replace(URL_ALL_PROJECTS_TASKS)
            await TasksHelper.tryToJoinUserToProject(
                navigation,
                projectId,
                () => {
                    store.dispatch(
                        navigateToAllProjectsTasks({
                            taskViewToggleSection: toggleName,
                            taskViewToggleIndex: toggleIndex,
                        })
                    )
                },
                redirectFn
            )
        }

        if (SharedHelper.accessGranted(loggedUser, projectId) || loggedUser.isAnonymous) {
            // Is the given User a member of the given Project?
            const currentProjectUsers = projectUsers[projectId]
            const currentProjectContacts = projectContacts[projectId]
            const currentProjectAssistants = [...globalAssistants, ...projectAssistants[projectId]]

            const assistantIndex = findIndex(currentProjectAssistants, ['uid', userId])
            const userIndex = findIndex(currentProjectUsers, ['uid', userId])
            const contactIndex = findIndex(currentProjectContacts, ['uid', userId])
            const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId) || PROJECT_TYPE_ACTIVE

            store.dispatch([switchProject(projectIndex), setSelectedSidebarTab(DV_TAB_ROOT_TASKS)])

            if (
                assistantIndex >= 0 ||
                userIndex >= 0 ||
                contactIndex >= 0 ||
                (projectType !== PROJECT_TYPE_GUIDE && userId?.startsWith(WORKSTREAM_ID_PREFIX))
            ) {
                const currUser =
                    assistantIndex >= 0
                        ? currentProjectAssistants[assistantIndex]
                        : userIndex >= 0
                        ? currentProjectUsers[userIndex]
                        : contactIndex >= 0
                        ? currentProjectContacts[contactIndex]
                        : getWorkstreamById(projectId, userId) ||
                          Backend.mapWorkstreamData(userId, getWorkstreamById(projectId, userId))

                // Store current workstrem data when it gets fetched from DB
                if (userId?.startsWith(WORKSTREAM_ID_PREFIX) && userId !== DEFAULT_WORKSTREAM_ID) {
                    currUser.displayName = 'Loading...'
                    getWorkstreamData(projectId, userId).then(workstream => {
                        if (workstream != null) store.dispatch(storeCurrentUser(workstream))
                    })
                }

                store.dispatch([
                    storeCurrentUser(currUser),
                    switchProject(projectIndex),
                    setTaskViewToggleIndex(toggleIndex),
                    setTaskViewToggleSection(toggleName),
                    setSelectedTypeOfProject(projectType),
                ])

                URLsTasks.replace(section, null, projectId, userId)
            } else {
                const project = loggedUserProjects[projectIndex]
                let isMember = false
                if (
                    project?.userIds?.indexOf(loggedUser?.uid) >= 0 &&
                    loggedUser?.projectIds?.indexOf(projectId) >= 0
                ) {
                    isMember = true
                }
                if (isMember) {
                    store.dispatch([
                        storeCurrentUser(loggedUser),
                        switchProject(projectIndex),
                        setTaskViewToggleIndex(toggleIndex),
                        setTaskViewToggleSection(toggleName),
                        setSelectedTypeOfProject(projectType),
                    ])
                    URLsTasks.replace(section, null, projectId, loggedUser.uid)
                } else {
                    store.dispatch(
                        navigateToAllProjectsTasks({
                            taskViewToggleSection: toggleName,
                            taskViewToggleIndex: toggleIndex,
                        })
                    )
                    URLsTasks.replace(URL_ALL_PROJECTS_TASKS)
                }
            }
        } else {
            const project = await getProjectData(projectId)
            if (project && project.isTemplate) {
                const isMember = await checkIfUserIsAlreadyInTemplateGuide(loggedUser.uid, projectId)
                if (isMember) {
                    store.dispatch(
                        navigateToAllProjectsTasks({
                            taskViewToggleSection: toggleName,
                            taskViewToggleIndex: toggleIndex,
                        })
                    )
                } else {
                    store.dispatch([storeCurrentUser(loggedUser), setAddingUserToGuide(true)])
                    await addUserToTemplate(loggedUser.uid, project, false)
                    store.dispatch(setAddingUserToGuide(false))
                    if (
                        !loggedUser.role.trim() ||
                        !loggedUser.company.trim() ||
                        !loggedUser.extendedDescription.trim()
                    ) {
                        store.dispatch(setUserInfoModalWhenUserJoinsToGuide(true))
                    }
                    const { route } = store.getState()

                    if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')
                    store.dispatch(navigateToAllProjectsTasks())

                    if (newUserNeedToJoinToProject) store.dispatch(setNewUserNeedToJoinToProject(false))
                }
            } else {
                await joinProject()
            }
        }
        navigation.navigate('Root')
    }

    static processURLProjectsUserNotes = async (navigation, projectId, userId, tab = FOLLOWED_TAB) => {
        const { loggedUserProjects, loggedUser, selectedSidebarTab } = store.getState()

        // Am I member of this project?
        const projectIndex = findIndex(loggedUserProjects, ['id', projectId])

        if (!selectedSidebarTab) {
            navigation.navigate('Root')
        }

        const joinProject = async () => {
            const redirectFn = () => URLsNotes.replace(URL_ALL_PROJECTS_NOTES_ALL)
            await TasksHelper.tryToJoinUserToProject(
                navigation,
                projectId,
                () => {
                    store.dispatch(navigateToAllProjectsNotes())
                },
                redirectFn
            )
        }

        if (checkIfSelectedProject(projectIndex)) {
            const user = TasksHelper.getUserInProject(projectId, userId)
            const currentUser = user ? user : loggedUser

            store.dispatch([
                setSelectedSidebarTab(DV_TAB_ROOT_NOTES),
                storeCurrentUser(currentUser),
                switchProject(projectIndex),
                updateNotesActiveTab(tab),
            ])

            URLsNotes.replace(
                tab === ALL_TAB ? URL_PROJECT_USER_NOTES_ALL : URL_PROJECT_USER_NOTES_FOLLOWED,
                null,
                projectId,
                loggedUser.uid
            )
        } else {
            // If I'm not a member, then try to join to it
            await joinProject()
        }
        // navigation.navigate('Root')
    }

    static processURLProjectsUserGoals = async (
        navigation,
        projectId,
        userId,
        section = URL_PROJECT_USER_GOALS_OPEN
    ) => {
        const { loggedUserProjects, loggedUser, projectUsers, selectedSidebarTab } = store.getState()

        // Am I member of this project?
        const projectIndex = findIndex(loggedUserProjects, ['id', projectId])
        const { index: toggleIndex, name: toggleName } = TasksHelper.getToggleSectionByURLConstant(section)

        const joinProject = async () => {
            const redirectFn = () => URLsGoals.replace(URL_ALL_PROJECTS_GOALS)
            await TasksHelper.tryToJoinUserToProject(
                navigation,
                projectId,
                () => {
                    store.dispatch(
                        navigateToGoals({ goalsActiveTab: toggleIndex, selectedProjectIndex: ALL_PROJECTS_INDEX })
                    )
                },
                redirectFn
            )
        }

        if (SharedHelper.accessGranted(loggedUser, projectId) || loggedUser.isAnonymous) {
            // Is the given User a member of the given Project?

            const isWorkstream = userId.startsWith(WORKSTREAM_ID_PREFIX)
            let currentUser
            const isGuide = !!loggedUserProjects[projectIndex].parentTemplateId
            if (userId === ALL_GOALS_ID && !isGuide) {
                currentUser = allGoals
            } else if (isWorkstream && !isGuide) {
                currentUser =
                    getWorkstreamById(projectId, userId) ||
                    Backend.mapWorkstreamData(userId, getWorkstreamById(projectId, userId))
            } else {
                const currentProjectUsers = projectUsers[projectId]
                const userIndex = findIndex(currentProjectUsers, ['uid', userId])
                currentUser = currentProjectUsers[userIndex]
            }

            if (!selectedSidebarTab) {
                navigation.navigate('Root')
            }

            store.dispatch([switchProject(projectIndex), setSelectedSidebarTab(DV_TAB_ROOT_GOALS)])

            const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)

            if (currentUser) {
                store.dispatch([
                    storeCurrentUser(currentUser),
                    switchProject(projectIndex),
                    setGoalsActiveTab(toggleIndex),
                    setSelectedTypeOfProject(projectType),
                    //setTaskViewToggleSection(toggleName),
                ])
                URLsGoals.replace(section, null, projectId, userId)
            } else {
                const project = loggedUserProjects[projectIndex]
                let isMember = false
                if (
                    project?.userIds?.indexOf(loggedUser?.uid) >= 0 &&
                    loggedUser?.projectIds?.indexOf(projectId) >= 0
                ) {
                    isMember = true
                }
                if (isMember) {
                    store.dispatch([
                        storeCurrentUser(loggedUser),
                        switchProject(projectIndex),
                        setGoalsActiveTab(toggleIndex),
                        setSelectedSidebarTab(DV_TAB_ROOT_GOALS),
                        //setTaskViewToggleSection(toggleName),
                        setSelectedTypeOfProject(projectType),
                    ])
                    URLsGoals.replace(section, null, projectId, loggedUser.uid)
                } else {
                    store.dispatch(
                        navigateToGoals({ goalsActiveTab: toggleIndex, selectedProjectIndex: ALL_PROJECTS_INDEX })
                    )
                    URLsGoals.replace(URL_ALL_PROJECTS_GOALS)
                }
            }
        } else {
            const project = await getProjectData(projectId)
            if (project && project.isTemplate) {
                const isMember = await checkIfUserIsAlreadyInTemplateGuide(loggedUser.uid, projectId)
                if (isMember) {
                    store.dispatch(
                        navigateToAllProjectsTasks({
                            taskViewToggleSection: toggleName,
                            taskViewToggleIndex: toggleIndex,
                        })
                    )
                } else {
                    store.dispatch([storeCurrentUser(loggedUser), setAddingUserToGuide(true)])
                    await addUserToTemplate(loggedUser.uid, project, false)
                    store.dispatch(setAddingUserToGuide(false))
                    if (
                        !loggedUser.role.trim() ||
                        !loggedUser.company.trim() ||
                        !loggedUser.extendedDescription.trim()
                    ) {
                        store.dispatch(setUserInfoModalWhenUserJoinsToGuide(true))
                    }
                    const { route, newUserNeedToJoinToProject } = store.getState()

                    if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')
                    store.dispatch(navigateToAllProjectsTasks())

                    if (newUserNeedToJoinToProject) store.dispatch(setNewUserNeedToJoinToProject(false))
                }
            } else {
                await joinProject()
            }
        }
        // navigation.navigate('Root')
    }

    static processURLTaskDetails = async (navigation, projectId, taskId) => {
        const { loggedUser, selectedSidebarTab } = store.getState()
        const task = await Backend.getTaskData(projectId, taskId)
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)

        if (task !== null) {
            let data = {
                task: task,
                projectId: projectId,
            }
            navigation.navigate('TaskDetailedView', data)
        } else if (checkIfSelectedProject(projectIndex)) {
            store.dispatch([storeCurrentUser(loggedUser), switchProject(projectIndex)])
            URLsTasks.replace(URL_PROJECT_USER_TASKS_OPEN, null, projectId, loggedUser.uid)
            if (!selectedSidebarTab) {
                navigation.navigate('Root')
            }
        } else {
            if (!selectedSidebarTab) navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsTasks())
            URLsTasks.replace(URL_ALL_PROJECTS_TASKS_OPEN)
        }
    }

    static processURLNoteDetails = async (navigation, projectId, noteId) => {
        const { loggedUser, selectedSidebarTab } = store.getState()
        const note = await Backend.getNoteMeta(projectId, noteId)
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)

        if (note !== null && !note.parentObject) {
            let data = {
                noteId: note.id,
                projectId: projectId,
            }
            store.dispatch(setSelectedNote(note))
            navigation.navigate('NotesDetailedView', data)
        } else if (checkIfSelectedProject(projectIndex)) {
            store.dispatch([storeCurrentUser(loggedUser), switchProject(projectIndex)])
            URLsNotes.replace(URL_PROJECT_USER_NOTES_FOLLOWED, null, projectId, loggedUser.uid)
            if (!selectedSidebarTab) {
                navigation.navigate('Root')
            }
        } else {
            if (!selectedSidebarTab) navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsNotes())
            URLsNotes.replace(URL_ALL_PROJECTS_NOTES_FOLLOWED)
        }
    }

    static processURLGoalDetails = async (navigation, projectId, goalId) => {
        const { loggedUser, selectedSidebarTab } = store.getState()
        const goal = await Backend.getGoalData(projectId, goalId)
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)

        if (goal !== null) {
            let data = {
                goalId,
                goal,
                projectId,
            }
            navigation.navigate('GoalDetailedView', data)
        } else if (checkIfSelectedProject(projectIndex)) {
            store.dispatch([storeCurrentUser(loggedUser), switchProject(projectIndex)])
            URLsGoals.replace(URL_PROJECT_USER_GOALS_OPEN, null, projectId, loggedUser.uid)
            if (!selectedSidebarTab) {
                navigation.navigate('Root')
            }
        } else {
            if (!selectedSidebarTab) navigation.navigate('Root')
            store.dispatch(navigateToGoals({ selectedProjectIndex: ALL_PROJECTS_INDEX }))
            URLsGoals.replace(URL_ALL_PROJECTS_GOALS_OPEN)
        }
    }

    static processURLSkillDetails = async (navigation, projectId, skillId) => {
        const skill = await getSkillData(projectId, skillId)

        if (skill !== null) {
            let data = {
                skillId,
                skill,
                projectId,
            }
            navigation.navigate('SkillDetailedView', data)
        } else {
            navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsTasks())
        }
    }

    /**
     *
     * @param navigation
     * @param tab  ['Properties', 'Estimations', 'Updates']
     * @param projectId
     * @param taskId
     * @param filterConstant
     * @returns {Promise<void>}
     */
    static processURLTaskDetailsTab = async (navigation, tab, projectId, taskId, filterConstant) => {
        const { loggedUser, selectedSidebarTab } = store.getState()
        console.log('TasksHelper: Processing task details tab:', { tab, projectId, taskId })

        const task = await Backend.getTaskData(projectId, taskId)
        console.log('TasksHelper: Task data:', task)

        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        console.log('TasksHelper: Project index:', projectIndex)

        let user = task != null ? await Backend.getUserOrContactBy(projectId, task.userId) : null
        // If user not found and task has an assistantId, try finding the assistant across all projects
        // This handles cases where the assistant is from another project
        if (!user && task != null && task.userId) {
            const assistant = getAssistant(task.userId)
            if (assistant) {
                user = assistant
                console.log('TasksHelper: Found assistant via frontend lookup:', user)
            }
        }
        console.log('TasksHelper: Task user data:', user)

        if (!task) {
            console.log('TasksHelper: Navigation failed - Task not found')
            navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsTasks())
            return
        }

        if (!checkIfSelectedProject(projectIndex)) {
            console.log('TasksHelper: Navigation failed - Invalid project')
            navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsTasks())
            return
        }

        if (!user) {
            console.log('TasksHelper: Navigation failed - Task user not found')
            navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsTasks())
            return
        }

        const backlinkSection = {
            index: filterConstant === URL_TASK_DETAILS_BACKLINKS_TASKS ? 1 : 0,
            section: filterConstant === URL_TASK_DETAILS_BACKLINKS_TASKS ? 'Tasks' : 'Notes',
        }
        tab =
            filterConstant === URL_TASK_DETAILS_BACKLINKS_TASKS || filterConstant === URL_TASK_DETAILS_BACKLINKS_NOTES
                ? DV_TAB_TASK_BACKLINKS
                : tab

        const inSelectedProject = checkIfSelectedProject(projectIndex)
        if (task != null && inSelectedProject && user != null) {
            tab = tab === DV_TAB_TASK_SUBTASKS && task.parentId != null ? DV_TAB_TASK_PROPERTIES : tab
            const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
            let data = {
                task: task,
                projectId: projectId,
            }
            store.dispatch([
                switchProject(projectIndex),
                storeCurrentUser(user.recorderUserId || !!user.temperature ? loggedUser : user),
                setSelectedNavItem(tab),
                setSelectedTypeOfProject(projectType),
                setBacklinkSection(backlinkSection),
            ])
            navigation.navigate('TaskDetailedView', data)
        } else if (inSelectedProject) {
            const { loggedUser } = store.getState()
            let data = {
                projectId: projectId,
                userId: loggedUser.uid,
            }
            store.dispatch([
                switchProject(projectIndex),
                storeCurrentUser(loggedUser),
                setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            ])
            URLsTasks.replace(URL_PROJECT_USER_TASKS, data, projectId, loggedUser.uid)
            if (!selectedSidebarTab) {
                navigation.navigate('Root')
            }
        } else {
            if (!selectedSidebarTab) navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsTasks())
            URLsTasks.replace(URL_ALL_PROJECTS_TASKS_OPEN)
        }
    }

    static processURLGoalDetailsTab = async (navigation, tab, projectId, goalId, filterConstant) => {
        const { loggedUser, selectedSidebarTab } = store.getState()
        const goal = await Backend.getGoalData(projectId, goalId)
        const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        const backlinkSection = {
            index: filterConstant === URL_GOAL_DETAILS_BACKLINKS_TASKS ? 1 : 0,
            section: filterConstant === URL_GOAL_DETAILS_BACKLINKS_TASKS ? 'Tasks' : 'Notes',
        }
        tab =
            filterConstant === URL_GOAL_DETAILS_BACKLINKS_TASKS || filterConstant === URL_GOAL_DETAILS_BACKLINKS_NOTES
                ? DV_TAB_GOAL_BACKLINKS
                : tab
        tab = !accessGranted && tab === DV_TAB_GOAL_BACKLINKS ? DV_TAB_GOAL_PROPERTIES : tab

        tab =
            filterConstant === URL_GOAL_DETAILS_TASKS_OPEN ||
            filterConstant === URL_GOAL_DETAILS_TASKS_WORKFLOW ||
            filterConstant === URL_GOAL_DETAILS_TASKS_DONE
                ? DV_TAB_GOAL_LINKED_TASKS
                : tab

        const childrenTasksSection = {
            index:
                filterConstant === URL_GOAL_DETAILS_TASKS_OPEN
                    ? TOGGLE_INDEX_OPEN
                    : filterConstant === URL_GOAL_DETAILS_TASKS_WORKFLOW
                    ? TOGGLE_INDEX_PENDING
                    : TOGGLE_INDEX_DONE,
            name:
                filterConstant === URL_GOAL_DETAILS_TASKS_OPEN
                    ? 'Open'
                    : filterConstant === URL_GOAL_DETAILS_TASKS_WORKFLOW
                    ? 'Workflow'
                    : 'Done',
        }

        const inSelectedProject = checkIfSelectedProject(projectIndex)
        if (goal && inSelectedProject) {
            const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
            const selectedUser =
                projectType === PROJECT_TYPE_SHARED ? await Backend.getUserDataByUidOrEmail(goal.creatorId) : loggedUser
            let data = {
                goalId,
                goal,
                projectId,
            }
            store.dispatch([
                switchProject(projectIndex),
                storeCurrentUser(selectedUser),
                setSelectedNavItem(tab),
                setSelectedTypeOfProject(projectType),
                setBacklinkSection(backlinkSection),
                setTaskViewToggleIndex(childrenTasksSection.index),
                setTaskViewToggleSection(childrenTasksSection.name),
            ])
            navigation.navigate('GoalDetailedView', data)
        } else if (inSelectedProject) {
            const { loggedUser } = store.getState()
            let data = {
                projectId: projectId,
                userId: loggedUser.uid,
            }
            store.dispatch([
                switchProject(projectIndex),
                storeCurrentUser(loggedUser),
                setSelectedSidebarTab(DV_TAB_ROOT_GOALS),
            ])
            URLsGoals.replace(URL_PROJECT_USER_GOALS_OPEN, data, projectId, loggedUser.uid)
            if (!selectedSidebarTab) {
                navigation.navigate('Root')
            }
        } else {
            if (!selectedSidebarTab) navigation.navigate('Root')
            store.dispatch(navigateToGoals({ selectedProjectIndex: ALL_PROJECTS_INDEX }))
            URLsGoals.replace(URL_ALL_PROJECTS_GOALS_OPEN)
        }
    }

    static processURLSkillDetailsTab = async (navigation, tab, projectId, skillId, filterConstant) => {
        const { loggedUser } = store.getState()
        const skill = await getSkillData(projectId, skillId)
        const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        const backlinkSection = {
            index: filterConstant === URL_SKILL_DETAILS_BACKLINKS_TASKS ? 1 : 0,
            section: filterConstant === URL_SKILL_DETAILS_BACKLINKS_TASKS ? 'Tasks' : 'Notes',
        }
        tab =
            filterConstant === URL_SKILL_DETAILS_BACKLINKS_TASKS || filterConstant === URL_SKILL_DETAILS_BACKLINKS_NOTES
                ? DV_TAB_SKILL_BACKLINKS
                : tab
        tab = !accessGranted && tab === DV_TAB_SKILL_BACKLINKS ? DV_TAB_SKILL_PROPERTIES : tab

        if (skill != null && checkIfSelectedProject(projectIndex) /*&& user != null*/) {
            const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
            const selectedUser =
                projectType === PROJECT_TYPE_SHARED ? await Backend.getUserDataByUidOrEmail(skill.userId) : loggedUser
            let data = {
                skillId,
                skill,
                projectId,
            }
            navigation.navigate('SkillDetailedView', data)
            store.dispatch([
                switchProject(projectIndex),
                storeCurrentUser(selectedUser),
                setSelectedNavItem(tab),
                setSelectedTypeOfProject(projectType),
                setBacklinkSection(backlinkSection),
            ])
        } else {
            navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsTasks())
        }
    }

    /**
     *
     * @param navigation
     * @param tab  ['Note', 'Properties']
     * @param projectId
     * @param noteId
     * @param filterConstant
     * @param autoStartTranscription
     * @returns {Promise<void>}
     */
    static processURLNoteDetailsTab = async (
        navigation,
        tab,
        projectId,
        noteId,
        filterConstant,
        autoStartTranscription = false
    ) => {
        console.log('[TasksHelper] processURLNoteDetailsTab called')
        console.log('[TasksHelper] autoStartTranscription:', autoStartTranscription)
        const { loggedUser, selectedSidebarTab } = store.getState()
        const note = await Backend.getNoteMeta(projectId, noteId)
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        const user = note ? await Backend.getUserDataByUidOrEmail(note.userId) : null
        const backlinkSection = {
            index: filterConstant === URL_NOTE_DETAILS_BACKLINKS_TASKS ? 1 : 0,
            section: filterConstant === URL_NOTE_DETAILS_BACKLINKS_TASKS ? 'Tasks' : 'Notes',
        }
        tab =
            filterConstant === URL_NOTE_DETAILS_BACKLINKS_TASKS || filterConstant === URL_NOTE_DETAILS_BACKLINKS_NOTES
                ? DV_TAB_NOTE_BACKLINKS
                : tab

        const inSelectedProject = checkIfSelectedProject(projectIndex)
        console.log(
            '[TasksHelper] note:',
            !!note,
            'inSelectedProject:',
            inSelectedProject,
            'user:',
            !!user,
            'note.parentObject:',
            note?.parentObject
        )
        if (note && inSelectedProject && user != null && !note.parentObject) {
            const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
            let data = {
                noteId: note.id,
                projectId,
                autoStartTranscription,
            }
            console.log('[TasksHelper] Navigating to NotesDetailedView with data:', data)
            store.dispatch([
                switchProject(projectIndex),
                storeCurrentUser(user),
                setSelectedNavItem(tab),
                setSelectedTypeOfProject(projectType),
                setBacklinkSection(backlinkSection),
                setSelectedNote(note),
            ])
            navigation.navigate('NotesDetailedView', data)
        } else if (inSelectedProject) {
            const { loggedUser } = store.getState()
            let data = {
                projectId: projectId,
                userId: loggedUser.uid,
            }
            store.dispatch([
                switchProject(projectIndex),
                storeCurrentUser(loggedUser),
                setSelectedSidebarTab(DV_TAB_ROOT_NOTES),
            ])
            URLsNotes.replace(URL_PROJECT_USER_NOTES_FOLLOWED, data, projectId, loggedUser.uid)
            if (!selectedSidebarTab) {
                navigation.navigate('Root')
            }
        } else {
            URLsNotes.replace(URL_ALL_PROJECTS_NOTES_FOLLOWED)
            if (!selectedSidebarTab) {
                navigation.navigate('Root')
            }
        }
    }

    static getPeopleTypeUsingId = (userId, projectId) => {
        return userId
            ? TasksHelper.getUserInProject(projectId, userId)
                ? 'users'
                : TasksHelper.getContactInProject(projectId, userId)
                ? 'contacts'
                : ''
            : ''
    }

    static getPeopleById = (userId, projectId) => {
        return TasksHelper.getUserInProject(projectId, userId) || TasksHelper.getContactInProject(projectId, userId)
    }

    static getTaskOwner = (assigneeId, projectId) => {
        return (
            TasksHelper.getPeopleById(assigneeId, projectId) ||
            getWorkstreamInProject(projectId, assigneeId) ||
            getAssistant(assigneeId)
        )
    }

    static getUser = userId => {
        const { projectUsers } = store.getState()
        return TasksHelper.getPeople(userId, Object.values(projectUsers))
    }

    static getPeople = (peopleId, projectPeoples) => {
        for (let i = 0; i < projectPeoples.length; i++) {
            for (let n = 0; n < projectPeoples[i].length; n++) {
                if (projectPeoples[i][n].uid === peopleId) {
                    return projectPeoples[i][n]
                }
            }
        }

        return null
    }

    static getUsersInProject = projectId => {
        const { projectUsers } = store.getState()
        const users = projectUsers[projectId]
        return users || []
    }

    static getUserInProject = (projectId, userId) => {
        const { projectUsers } = store.getState()
        return projectUsers[projectId]?.find(user => user.uid === userId)
    }

    static getContactInProject = (projectId, contactId) => {
        const { projectContacts } = store.getState()
        return projectContacts[projectId]?.find(contact => contact.uid === contactId)
    }

    static getPeopleInProject = (projectId, peopleId, projectPeoples) => {
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)

        if (checkIfSelectedProject(projectIndex)) {
            const peoples = projectPeoples[projectIndex]
            if (peoples?.length > 0) {
                for (let n = 0; n < peoples.length; n++) {
                    if (peoples[n].uid === peopleId) {
                        return peoples[n]
                    }
                }
            }
        }

        return null
    }

    static getDataFromMention = (text, projectId) => {
        const { userId, mentionText } = getMentionData(text, true)
        const mentionData = {
            mention: mentionText,
            user: getUserOrContactForMentions(projectId, userId),
        }

        return mentionData
    }

    static getDataFromKarma = (text = '', projectId) => {
        const userId = text.split(KARMA_TRIGGER)[1]
        return getUserOrContactForMentions(projectId, userId)
    }

    static getTaskNameWithoutMeta = (taskName = '', removeLineBreaks) => {
        const linealText = removeLineBreaks ? taskName.replace(/(\r\n|\n|\r)/gm, ' ') : taskName
        const words = (linealText == null ? '' : linealText).split(' ')
        for (let i = 0; i < words.length; i++) {
            // sanitize mentions
            if (words[i].startsWith('@')) {
                const parts = words[i].split('#')
                if (parts.length === 2 && parts[1].trim().length >= 0) {
                    words[i] = parts[0].replaceAll(MENTION_SPACE_CODE, ' ')
                } else {
                    words[i] = words[i].replaceAll(MENTION_SPACE_CODE, ' ')
                }
            }
        }
        return words.join(' ')
    }

    static getMentionIdsFromTitle = (title = '') => {
        const words = title.split(' ')
        const ids = []

        for (let i = 0; i < words.length; i++) {
            if (words[i].startsWith('@')) {
                const parts = words[i].split('#')
                if (parts.length === 2 && (parts[1].trim().length >= 28 || getAssistant(parts[1].trim()))) {
                    ids.push(parts[1].trim())
                }
            }
        }
        return uniq(ids)
    }

    static getMentionUsersFromTitle = (projectId, title = '') => {
        const { projectUsers } = store.getState()
        const uidList = TasksHelper.getMentionIdsFromTitle(title)
        return projectUsers[projectId].filter(user => uidList.includes(user.uid))
    }

    static transformTitleMetadata = (title = '', projectId) => {
        const words = title.split(' ')
        const list = []
        for (let i = 0; i < words.length; i++) {
            if (words[i].startsWith('@')) {
                let { mention, user } = TasksHelper.getDataFromMention(words[i], projectId)
                mention = mention.replaceAll(' ', MENTION_SPACE_CODE)
                if (user != null) {
                    list.push(`${mention}###${user.photoURL}`)
                } else {
                    list.push(words[i])
                }
            } else if (words[i].startsWith('#')) {
                const { hashtagsColors } = store.getState()
                const colorKey = hashtagsColors?.[projectId]?.[words[i].substring(1)] || COLOR_KEY_4
                const color = HASHTAG_COLOR_MAPPING[colorKey].tagText
                list.push(`${words[i]}${color}`)
            } else if (words[i].startsWith(KARMA_TRIGGER)) {
                let user = TasksHelper.getDataFromKarma(words[i], projectId)
                if (user != null) {
                    list.push(`${KARMA_TRIGGER}###${user.photoURL}`)
                } else {
                    list.push(KARMA_TRIGGER)
                }
            } else {
                list.push(words[i])
            }
        }
        return list.join(' ')
    }

    static setURLOnChangeToggleOption = (index, optionText) => {
        const { selectedProjectIndex, loggedUserProjects, currentUser } = store.getState()

        const isAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

        const projectIndicator = isAllProjects
            ? ALL_PROJECTS_INDEX
            : loggedUserProjects[selectedProjectIndex]
            ? loggedUserProjects[selectedProjectIndex].id
            : ALL_PROJECTS_INDEX

        store.dispatch([setTaskViewToggleIndex(index), setTaskViewToggleSection(optionText)])

        let constant = TasksHelper.getURLConstantByToggleIndex(index, isAllProjects, !!currentUser.temperature)
        let data = {
            projectId: projectIndicator,
            userId: currentUser.uid,
        }
        URLsTasks.push(constant, data, projectIndicator, currentUser.uid)
    }

    static generateWorkflowStepIndexes = (length, excludeIndex) => {
        const indexes = [OPEN_STEP]
        for (let i = 0; i < length; i++) {
            if (i !== excludeIndex) indexes.push(i)
        }
        indexes.push(DONE_STEP)
        return indexes
    }

    static changeSharedMode = accessGranted => {
        if (accessGranted) {
            store.dispatch(unsetSharedMode())
        } else {
            store.dispatch(setSharedMode())
        }
    }

    static isPrivate = resource => {
        const { loggedUser } = store.getState()
        return resource != null && resource.isPrivate && resource.userId !== loggedUser.uid
    }

    static isPrivateTask = (task, customUser, onlyCheckPrivacy = false) => {
        const { loggedUser } = store.getState()
        const user = customUser || loggedUser
        const userId = customUser?.uid || loggedUser.uid
        return (
            task &&
            task.isPrivate &&
            (onlyCheckPrivacy ||
                user.isAnonymous ||
                (task.userId !== userId && (!task.isPublicFor || !task.isPublicFor.includes(userId))))
        )
    }

    static showWrappedTaskEllipsis = (tagsId, elementId) => {
        const tagsPos = TasksHelper.getElementRect(tagsId)
        const elemPos = TasksHelper.getElementRect(elementId)

        return elemPos?.bottom > tagsPos?.bottom || elemPos?.left > tagsPos?.left
    }

    static showWrappedTaskEllipsisInByTime = (elementId, taskItemWidth) => {
        const rect = TasksHelper.getElementRect(elementId)
        const EXTERNAL_SPACE = 64
        return taskItemWidth - EXTERNAL_SPACE < rect?.width
    }

    static getElementRect = elementId => {
        const endTextElement = document.getElementById(elementId)
        return endTextElement?.getBoundingClientRect()
    }

    static sortSubtasks = (a, b) => {
        return b.sortIndex - a.sortIndex
    }

    static sortWorkflowAndDoneTasksFn = (a, b) => {
        return b.completed - a.completed
    }

    static getDueDateAndEstimationsByObserversIds = observersIds => {
        const dueDateByObserversIds = {}
        const estimationsByObserverIds = {}

        observersIds.forEach(uid => {
            dueDateByObserversIds[uid] = moment().valueOf()
            estimationsByObserverIds[uid] = 0
        })
        return { dueDateByObserversIds, estimationsByObserverIds }
    }

    static mergeDueDateAndEstimationsByObserversIds = (
        oldDueDateByObserversIds,
        observersIds,
        oldEstimationsByObserversIds
    ) => {
        const dueDateByObserversIds = {}
        const estimationsByObserverIds = {}

        observersIds.forEach(uid => {
            if (oldDueDateByObserversIds[uid] && oldEstimationsByObserversIds[uid]) {
                dueDateByObserversIds[uid] = oldDueDateByObserversIds[uid]
                estimationsByObserverIds[uid] = oldEstimationsByObserversIds[uid]
            } else {
                dueDateByObserversIds[uid] = moment().valueOf()
                estimationsByObserverIds[uid] = 0
            }
        })
        return { dueDateByObserversIds, estimationsByObserverIds }
    }
}

export const getHandlerData = (handlerId, projectId) => {
    const handlerIsWorkstream = isWorkstream(handlerId)
    const isUser = false
    const isContact = false
    const isPublicForLoggedUser = true

    if (handlerIsWorkstream) {
        const workstream = getWorkstreamInProject(projectId, handlerId)
        return { handler: workstream, isWorkstream: true, isUser, isContact, isPublicForLoggedUser }
    } else {
        const user = TasksHelper.getUserInProject(projectId, handlerId)
        if (user) {
            return { handler: user, isWorkstream, isUser: true, isContact, isPublicForLoggedUser }
        } else {
            const contact = TasksHelper.getContactInProject(projectId, handlerId)
            return {
                handler: contact,
                isWorkstream,
                isUser,
                isContact: true,
                isPublicForLoggedUser: objectIsPublicForLoggedUser(contact),
            }
        }
    }
}

export const objectIsPublicForLoggedUser = object => {
    if (!object) return false

    const { isPublicFor } = object
    if (!isPublicFor || isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) return true

    const { uid, isAnonymous } = store.getState().loggedUser
    return !isAnonymous && isPublicFor.includes(uid)
}

export const getFinalTaskList = originalTasksList => {
    const finalTasksList =
        originalTasksList.length > 0 && originalTasksList[0][0] === NOT_PARENT_GOAL_INDEX
            ? [...originalTasksList.slice(1), originalTasksList[0]]
            : originalTasksList
    return finalTasksList
}

export const getTaskAutoEstimation = (projectId, estimation, taskAutoEstimation, loggedUserProjectsMap) => {
    if (taskAutoEstimation === true || taskAutoEstimation === false) {
        return taskAutoEstimation
    } else if (estimation === 0) {
        return false
    } else {
        const project = loggedUserProjectsMap
            ? loggedUserProjectsMap[projectId]
            : ProjectHelper.getProjectById(projectId)
        const projectAutoEstimation = project ? project.autoEstimation : true
        return projectAutoEstimation
    }
}

export const shouldOnPressInput = (event, blockOpen) => {
    const { target } = event

    let shouldOnPress = true
    document.querySelectorAll('.react-tiny-popover-container').forEach(e => {
        if (e.contains(target)) {
            shouldOnPress = false
        }
    })
    if (shouldOnPress) {
        const label = target.getAttribute('aria-label')
        shouldOnPress = label == null || label === '' || label !== 'social-text-block'
    }
    return !blockOpen && shouldOnPress
}

export default TasksHelper
