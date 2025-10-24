import { createStore } from 'redux'
import { reduxBatch } from '@manaflair/redux-batch'
import moment from 'moment'
import { cloneDeep, difference, uniq } from 'lodash'

import { PROJECT_TYPE_ACTIVE, PROJECT_TYPE_SHARED } from '../components/SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper, {
    ALL_PROJECTS_INDEX,
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
} from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import { FOLLOWED_TAB } from '../components/Feeds/Utils/FeedsConstants'
import {
    DV_TAB_ADMIN_PANEL_USER,
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_UPDATES,
    DV_TAB_SETTINGS_PROFILE,
} from '../utils/TabNavigationConstants'
import { GOALS_OPEN_TAB_INDEX, GOAL_OPEN_TASKS_EXPANDED_SOMEDAY } from '../components/GoalsView/GoalsHelper'
import { WATCHER_VARS_DEFAULT } from '../utils/backends/openTasks'
import { PROJECT_COLOR_DEFAULT } from '../Themes/Modern/ProjectColors'
import URLTrigger from '../URLSystem/URLTrigger'
import { URL_NOT_MATCH } from '../URLSystem/URLSystemTrigger'
import { TOGGLE_INDEX_OPEN } from '../components/TaskListView/Utils/TasksHelper'
import { WORKSTREAM_TASKS_MY_DAY_TYPE } from '../utils/backends/Tasks/myDayTasks'
import {
    addProjectDataToMyDayData,
    processMyDayData,
    resetActiveTaskDatesIfTaskChanges,
    updateDataLoadedState,
} from '../components/MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'
import {
    generateMyDayWorkflowTasks,
    updateMyDayWorkflowDataLoadedState,
} from '../components/MyDayView/MyDayTasks/MyDayWorkflowTasks/myDayWorkflowTasksHelper'

import {
    generateMyDayDoneTasks,
    updateMyDayDoneDataLoadedState,
} from '../components/MyDayView/MyDayTasks/MyDayDoneTasks/myDayDoneTasksHelper'
import { addProjectDataToOpenTasksShowMoreData } from '../utils/backends/Tasks/openTasksShowMore/openTasksShowMore'
import { getProjectChatLastNotification } from '../utils/backends/Chats/chatsComments'

export const initialState = {
    loggedIn: null,
    loadingStep: 0,
    loadingMessage: 'Initializing...',
    loggedUser: {},
    currentUser: {},
    loggedUserProjects: [],
    loggedUserProjectsMap: {},
    loggedUserProjectNamesMap: {},
    projectUsers: {},
    projectContacts: {},
    projectAssistants: {},
    projectWorkstreams: {},
    projectsMeetings: {},
    projectInvitations: {},
    projectChatNotifications: {},
    projectChatLastNotification: {},
    globalAssistants: [],
    defaultAssistant: {},
    selectedProjectIndex: ALL_PROJECTS_INDEX,
    selectedTypeOfProject: PROJECT_TYPE_ACTIVE,
    selectedNavItem: DV_TAB_ROOT_TASKS,
    selectedSidebarTab: '',
    expandedNavPicker: false,
    isMiddleScreen: false,
    isMiddleScreenNoteDV: false,
    smallScreen: false,
    smallScreenNavigation: false,
    reallySmallScreenNavigation: false,
    smallScreenNavSidebarCollapsed: false,
    showProjectColorPicker: {
        visible: false,
        layout: { x: 0, y: 0, width: 0, height: 0 },
    },
    currentProjectColor: PROJECT_COLOR_DEFAULT,
    showAddProjectOptions: {
        visible: false,
        layout: { x: 0, y: 0, width: 0, height: 112 },
    },
    showInviteUserOptions: {
        visible: false,
        layout: { x: 0, y: 0, width: 0, height: 103 },
    },
    showConfirmPopupData: {
        visible: false,
        trigger: null,
        object: {},
    },
    showProjectDontExistInInvitationModal: false,
    showProjectInvitationPopup: {
        visible: false,
        data: { project: null, user: null },
    },
    showSwipeDueDatePopup: {
        visible: false,
        data: { projectId: null, task: null },
    },
    showFloatPopup: 0,
    shownFloatPopup: false,
    dismissibleActive: false,
    dismissibleComponent: null,
    dismissibleLimits: null,
    shortcutFocusTasks: { current: '', prev: '', next: '' },
    focusedTaskItem: { id: '', isObserved: false },
    checkTaskItem: { id: '', isObserved: false },
    showWebSideBar: { visible: true, layout: { x: 0, y: 0, width: 0, height: 0 } },
    showAssigneePicker: { visible: false, layout: { x: 0, y: 0, width: 0, height: 0 } },
    showProjectPicker: { visible: false, layout: { x: 0, y: 0, width: 0, height: 0 } },
    showDueDateCalendar: { visible: false, layout: { x: 0, y: 0, width: 0, height: 0 } },
    assignee: {},
    browserHistoryState: {},
    initialUrl: '/',
    processedInitialURL: false,
    taskInDetailView: {},
    route: '',
    subTaskSection: null,
    taskTitleInEditMode: false,
    taskViewToggleIndex: 0,
    taskViewToggleSection: 'Open',
    workflowStep: {},
    userWorkflow: {},
    amountTasksByProjects: [],
    activeSearchForm: false,
    searchText: '',
    feedCount: [0],
    allNewFeedCount: {},
    allFeedCount: [0],
    feedListByProjects: [],
    lastVisitedScreen: ['/projects/tasks/open'],
    taskTitleElementsWidths: [],
    isLoadingData: 0,
    showLoadingDataSpinner: false,
    registeredNewUser: false,
    alldoneVersion: { major: 0, minor: 0, patch: 0 },
    alldoneNewVersion: { major: 0, minor: 0, patch: 0 },
    showSideBarVersionRefresher: false,
    showOptionalVersionNotification: false,
    globalSearchResults: null,
    showGlobalSearchPopup: null,
    globalSearchPopupOpenUsingShortcuts: false,
    realTimeSearchResults: null,
    sidebarNumbers: { loading: true },
    addTaskRepeatMode: false,
    activeEditMode: false,
    feedsCount: {},
    uploadedNewSubtask: false,
    feedActiveTab: FOLLOWED_TAB,
    notesActiveTab: FOLLOWED_TAB,
    contactsActiveTab: FOLLOWED_TAB,
    chatsActiveTab: FOLLOWED_TAB,
    screenDimensions: {},
    showNewDayNotification: false,
    showNewVersionMandtoryNotifcation: false,
    noteChangedNotification: false,
    lastAddNewTaskDate: null,
    lastAddNewNoteDate: null,
    lastAddNewContact: null,
    showMoreInMainSection: false,
    activeDragGoalMode: false,
    activeDragTaskModeInDate: false,
    tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode: {},
    activeModalInFeed: false,
    notesAmounts: [],
    updatesAmounts: [],
    goalsAmounts: [[], []],
    prevScreen: '',
    needReloadGlobalFeeds: false,
    showShortcuts: false,
    showNoteCtrlShortcuts: false,
    showNoteAltShortcuts: false,
    followedFeeds: {},
    allFeeds: {},
    newLocalFeedData: null,
    showCheatSheet: false,
    loadedNewFeeds: false,
    inPartnerFeeds: false,
    lastSelectedDueDate: moment().valueOf(),
    projectNotes: [],
    watchTasksTrigger: 0,
    draggingParentTaskId: '',
    openTasksMap: {},
    openSubtasksMap: {},
    taskListWatchersVars: WATCHER_VARS_DEFAULT,
    globalDataByProject: {},
    inSharedMode: false,
    showAccessDeniedPopup: false,
    endCopyProjectPopupData: { visible: false, name: '', color: '' },
    quillEditorProjectId: '',
    isQuillTagEditorOpen: false,
    inBacklinksView: false,
    backlinkSection: { index: 0, section: 'Notes' },
    projectTypeSectionIndex: 0,
    selectedTasks: [],
    isDragging: false,
    openModals: {},
    mentionModalStack: [],
    mentionModalNewFormOpen: false,
    blockBackgroundTabShortcut: false,
    selectedNote: {},
    shortcutSelectedProjectIndex: null,
    shortcutCurrentUserUid: null,
    goalsActiveTab: GOALS_OPEN_TAB_INDEX,
    milestoneInEditionId: '',
    goalInEditionMilestoneId: '',
    goalSwipeMilestoneModalOpen: false,
    forceCloseGoalEditionId: '',
    forceCloseSkillEditionId: '',
    showLimitedFeatureModal: false,
    limitQuotaModalData: { visible: false, quotaType: null, projectName: '', monthlyXp: 0, monthlyTraffic: 0 },
    showLimitPremiumQuotaModal: false,
    openMilestonesByProject: {},
    doneMilestonesByProject: {},
    goalsByProject: {},
    boardMilestonesByProject: {},
    boardGoalsByMilestoneByProject: {},
    boardNeedShowMoreByProject: {},
    openGoalsAmountByProject: { total: 0 },
    doneGoalsAmountByProject: { total: 0 },
    activeNoteId: '',
    activeNoteIsReadOnly: false,
    hashtagsColors: {},
    virtualQuillLoaded: false,
    blockShortcuts: false,
    isLoadingNoteData: false,
    noteEditorScrollDimensions: { width: 0, height: 0 },
    tmpInputTextTask: '',
    tmpInputTextGoal: '',
    tmpInputTextNote: '',
    tmpInputTextContact: '',
    tmpInputTextChat: '',
    showNoteMaxLengthModal: false,
    todayEmptyGoalsTotalAmountInOpenTasksView: { total: 0 },
    goalsShowMoreExpanded: false,
    hashtagFilters: new Map(),
    goldEarnedData: { goldEarned: 0, checkBoxId: '' },
    showGoldChain: false,
    showGoldCoin: false,
    topBarWidth: 0,
    notesInnerTasks: {},
    showUserInfoModalWhenUserJoinsToGuide: false,
    laterTasksExpandedForNavigateFromAllProjects: false,
    somedayTasksExpandedForNavigateFromAllProjects: false,
    tasksArrowButtonIsExpanded: false,
    sidebarInputOpenType: null,
    sidebarHovered: false,
    addProjectIsOpen: false,
    addContactIsOpen: false,
    followedFeedsAmount: 0,
    allFeedsAmount: 0,
    followedFeedsData: {},
    allFeedsData: {},
    amountDoneTasksExpanded: 0,
    laterTasksExpanded: false,
    somedayTasksExpanded: false,
    openTasksAmount: 0,
    doneTasksAmount: null,
    earlierDoneTasksAmount: null,
    workflowTasksAmount: { amount: 0, loaded: false },
    thereAreLaterOpenTasks: {},
    thereAreSomedayOpenTasks: {},
    thereAreLaterEmptyGoals: {},
    thereAreSomedayEmptyGoals: {},
    openTasksStore: {},
    thereAreHiddenNotMainTasks: {},
    filteredOpenTasksStore: {},
    subtaskByTaskStore: {},
    thereAreNotTasksInFirstDay: {},
    initialLoadingEndOpenTasks: false,
    initialLoadingEndObservedTasks: false,
    openMilestonesByProjectInTasks: {},
    doneMilestonesByProjectInTasks: {},
    goalsByProjectInTasks: {},
    skillsByProject: {},
    activeDragSkillModeId: null,
    skillsDefaultPrivacyByProject: {},
    skillInDv: null,
    activeDragProjectModeType: null,
    activeDragTaskModeInMyDay: false,
    dvIsFullScreen: false,
    quotedNoteText: '',
    quotedText: null,
    activeChatMessageId: '',
    chatPagesAmount: 0,
    administratorUser: {},
    selectedGoalDataInTasksListWhenAddTask: null,
    addTaskSectionToOpenData: null,
    addingUserToGuide: false,
    activeGuideId: '',
    activeTemplateId: '',
    areArchivedActive: false,
    newUserNeedToJoinToProject: false,
    userIdsAllowedToCreateTemplates: [
        '64s4RwKszFXPYlmRCpdx91L3tiC3',
        'W6mJp7iqgVWAyZq8BoOheotf6H72',
        'lejVqrT6FBcMRRCxnBbBhQwPgSg1',
    ],
    showNotificationAboutTheBotBehavior: false,
    assistantEnabled: false,
    notEnabledAssistantWhenLoadComments: false,
    triggerBotSpinner: false,
    preConfigTaskExecuting: false,
    disableAutoFocusInChat: false,
    mainChatEditor: null,
    goalOpenTasksData: [],
    goalOpenSubtasksByParent: {},
    goalOpenTasksExpandState: GOAL_OPEN_TASKS_EXPANDED_SOMEDAY,
    goalOpenMainTasksExpanded: false,
    goalWorkflowTasksData: [],
    goalWorkflowSubtasksByParent: {},
    goalDoneTasksData: [],
    goalDoneSubtasksByParent: {},
    goalDoneTasksExpandedAmount: 0,
    recordVideoModalData: { visible: false, projectId: '' },
    screenRecordingModalData: { visible: false, projectId: '' },
    chatGoogleMeetModalData: { visible: false, projectId: '', userId: '', userIds: [], title: '' },
    googleMeetModalData: { visible: false, projectId: '', userId: '' },
    googleMeetNotificationModalData: { visible: false, projectId: '', email: '', meeting: null },
    taskSuggestedCommentModalData: { visible: false, projectId: '', task: null, taskName: '' },
    activeChatData: { projectId: '', chatId: '', chatType: '' },
    quillTextInputProjectIdsByEditorId: {},
    taskInFocus: null,
    myDayAllTodayTasks: {},
    myDaySelectedTasks: [],
    myDaySortingSelectedTasks: [],
    myDayOtherTasks: [],
    myDaySortingOtherTasks: [],
    myDayOpenSubtasksMap: {},
    myDaySortingSubtasksMap: {},
    myDayShowAllTasks: false,
    myDayWorkflowTasksByProject: {},
    myDayWorkflowTasks: [],
    myDayWorkflowSubtasksMap: {},
    myDayDoneTasksByProject: {},
    myDayDoneTasks: [],
    myDayDoneSubtasksMap: {},
    lastTaskAddedId: '',
    openTasksShowMoreData: { hasFutureTasks: false, hasSomedayTasks: false },
    navigationSource: null,
    showTaskCompletionAnimation: false,
}

const checkIfNeedToJointToProject = initialUrl => {
    const matchersList = URLTrigger.getRegexList()
    let needToJoinToProject = false
    for (let key in matchersList) {
        if (matchersList[key].match(initialUrl) !== URL_NOT_MATCH) {
            needToJoinToProject =
                matchersList[key].urlPointToJoinLogic && matchersList[key].urlPointToJoinLogic(initialUrl)
            break
        }
    }
    return needToJoinToProject
}

const updateInactiveProjectsData = (user, activeGuideId, activeTemplateId, areArchivedActive) => {
    let projectIds = user.projectIds || []
    const realProjectIds = [...projectIds]

    let guideProjectIds = user.guideProjectIds || []
    const realGuideProjectIds = [...guideProjectIds]

    let templateProjectIds = user.templateProjectIds || []
    const realTemplateProjectIds = [...templateProjectIds]

    let archivedProjectIds = user.archivedProjectIds || []
    const realArchivedProjectIds = [...archivedProjectIds]

    if (!user.isAnonymous) {
        const isLoggedUserAndCreator = templateProjectIds.length > 0

        if (isLoggedUserAndCreator) {
            projectIds = difference(projectIds, guideProjectIds)
            if (activeGuideId && guideProjectIds.includes(activeGuideId)) {
                projectIds.push(activeGuideId)
                guideProjectIds = [activeGuideId]
            } else {
                guideProjectIds = []
            }
            projectIds = difference(projectIds, templateProjectIds)
            if (activeTemplateId && templateProjectIds.includes(activeTemplateId)) {
                projectIds.push(activeTemplateId)
                templateProjectIds = [activeTemplateId]
            } else {
                templateProjectIds = []
            }
        }
        if (!areArchivedActive) {
            projectIds = difference(projectIds, archivedProjectIds)
            archivedProjectIds = []
        }
    }

    return {
        ...user,
        projectIds,
        guideProjectIds,
        templateProjectIds,
        archivedProjectIds,
        realProjectIds,
        realGuideProjectIds,
        realTemplateProjectIds,
        realArchivedProjectIds,
    }
}

const updateCurrentUserIfNeeded = (state, users) => {
    return users.find(user => user.uid === state.currentUser.uid) || state.currentUser
}

const getDefaultAssistant = state => {
    // Get the default project ID
    const defaultProjectId = state?.loggedUser?.defaultProjectId

    if (!defaultProjectId) {
        console.warn('No default project ID found')
        return {}
    }

    // Get the project itself to check its assistantId
    const defaultProject = state?.loggedUserProjectsMap?.[defaultProjectId]
    const projectAssistants = state?.projectAssistants?.[defaultProjectId] || []
    const globalAssistants = state?.globalAssistants || []

    // Strategy 1: Look for a project assistant marked as default
    let defaultAssistant = projectAssistants.find(assistant => assistant.isDefault)

    // Strategy 2: If no marked default, check if project.assistantId points to an assistant
    if (!defaultAssistant && defaultProject?.assistantId) {
        // First check if it's a project assistant
        defaultAssistant = projectAssistants.find(a => a.uid === defaultProject.assistantId)

        // If not found in project assistants, check global assistants
        if (!defaultAssistant) {
            defaultAssistant = globalAssistants.find(a => a.uid === defaultProject.assistantId)
        }
    }

    // Strategy 3: Fall back to the first project assistant
    if (!defaultAssistant && projectAssistants.length > 0) {
        defaultAssistant = projectAssistants[0]
    }

    console.log('Selected default assistant from project:', {
        projectId: defaultProjectId,
        projectAssistantId: defaultProject?.assistantId,
        selectedAssistantId: defaultAssistant?.uid,
        selectedAssistantName: defaultAssistant?.displayName,
        isDefault: defaultAssistant?.isDefault,
        isGlobal: globalAssistants.some(a => a.uid === defaultAssistant?.uid),
        allProjectAssistants: projectAssistants.map(a => ({
            uid: a.uid,
            name: a.displayName,
            isDefault: a.isDefault,
        })),
    })

    return defaultAssistant || {}
}

export const theReducer = (state = initialState, action) => {
    switch (action.type) {
        case 'Set selected Note':
            return { ...state, selectedNote: action.selectedNote }
        case 'Log out':
            return { ...state, loggedIn: false }
        case 'Set Version':
            return { ...state, alldoneVersion: action.version }
        case 'Set new version':
            return { ...state, alldoneNewVersion: action.version }
        case 'Set side bar version refresher button':
            return { ...state, showSideBarVersionRefresher: action.showSideBarVersionRefresher }
        case 'Set optional version notification':
            return { ...state, showOptionalVersionNotification: action.showOptionalVersionNotification }
        case 'Switch project':
            return { ...state, selectedProjectIndex: action.index }
        case 'Update user project': {
            const { project } = action

            const updatedProject = { ...state.loggedUserProjectsMap[project.id], ...project }

            const loggedUserProjects = [...state.loggedUserProjects]
            loggedUserProjects[updatedProject.index] = updatedProject

            const loggedUserProjectsMap = { ...state.loggedUserProjectsMap, [updatedProject.id]: updatedProject }

            return { ...state, loggedUserProjects, loggedUserProjectsMap }
        }
        case 'Store logged user': {
            const loggedUser = updateInactiveProjectsData(
                action.loggedUser,
                state.activeGuideId,
                state.activeTemplateId,
                state.areArchivedActive
            )
            const currentUser = updateCurrentUserIfNeeded(state, [loggedUser])

            return { ...state, loggedUser, currentUser }
        }
        case 'Store current user': {
            return { ...state, currentUser: action.currentUser }
        }
        case 'Update loading step': {
            return { ...state, loadingStep: action.step, loadingMessage: action.message }
        }
        case 'Set selected nav item':
            return { ...state, selectedNavItem: action.navItem }
        case 'Set selected sidebar tab':
            return { ...state, selectedSidebarTab: action.tab }
        case 'Toggle nav picker':
            return { ...state, expandedNavPicker: action.expanded }
        case 'Toggle middle screen':
            return { ...state, isMiddleScreen: action.isMiddleScreen }
        case 'Toggle middle screen Note DV':
            return { ...state, isMiddleScreenNoteDV: action.isMiddleScreenNoteDV }
        case 'Toggle small screen':
            return { ...state, smallScreen: action.smallScreen }
        case 'Toggle small screen navigation':
            return {
                ...state,
                smallScreenNavigation: action.smallScreenNavigation,
            }
        case 'Toggle really small screen navigation':
            return {
                ...state,
                reallySmallScreenNavigation: action.reallySmallScreenNavigation,
            }
        case 'Toggle small screen navigation sidebar collapsed':
            return {
                ...state,
                smallScreenNavSidebarCollapsed: action.smallScreenNavSidebarCollapsed,
            }
        case 'Show project color picker':
            return {
                ...state,
                showProjectColorPicker: {
                    ...state.showProjectColorPicker,
                    visible: true,
                },
            }
        case 'Hide project color picker':
            return {
                ...state,
                showProjectColorPicker: {
                    ...state.showProjectColorPicker,
                    visible: false,
                },
            }
        case 'Set project color picker layout':
            return {
                ...state,
                showProjectColorPicker: {
                    ...state.showProjectColorPicker,
                    layout: action.layout,
                },
            }
        case 'Set current project color':
            return { ...state, currentProjectColor: action.newColor }
        case 'Show add project options':
            return {
                ...state,
                showAddProjectOptions: {
                    ...state.showAddProjectOptions,
                    visible: true,
                },
            }
        case 'Hide add project options':
            return {
                ...state,
                showAddProjectOptions: {
                    ...state.showAddProjectOptions,
                    visible: false,
                },
            }
        case 'Set add project options layout':
            return {
                ...state,
                showAddProjectOptions: {
                    ...state.showAddProjectOptions,
                    layout: action.layout,
                },
            }
        case 'Show add user options':
            return {
                ...state,
                showInviteUserOptions: {
                    ...state.showInviteUserOptions,
                    visible: true,
                },
            }
        case 'Hide add user options':
            return {
                ...state,
                showInviteUserOptions: {
                    ...state.showInviteUserOptions,
                    visible: false,
                },
            }
        case 'Set add user options layout':
            return {
                ...state,
                showInviteUserOptions: {
                    ...state.showInviteUserOptions,
                    layout: action.layout,
                },
            }

        case 'Show confirm popup':
            return {
                ...state,
                showConfirmPopupData: {
                    visible: true,
                    trigger: action.trigger,
                    object: action.object,
                },
            }
        case 'Hide confirm popup':
            return {
                ...state,
                showConfirmPopupData: {
                    visible: false,
                    trigger: null,
                    object: {},
                },
            }
        case 'Set show project dont exist in invitation modal':
            return { ...state, showProjectDontExistInInvitationModal: action.value }
        case 'Show project invitation popup':
            return {
                ...state,
                showProjectInvitationPopup: {
                    ...state.showProjectInvitationPopup,
                    visible: true,
                },
            }
        case 'Hide project invitation popup':
            return {
                ...state,
                showProjectInvitationPopup: {
                    ...state.showProjectInvitationPopup,
                    visible: false,
                },
            }
        case 'Set project invitation data':
            return {
                ...state,
                showProjectInvitationPopup: {
                    ...state.showProjectInvitationPopup,
                    data: action.data,
                },
            }
        case 'Show swipe due date popup':
            return {
                ...state,
                showSwipeDueDatePopup: {
                    ...state.showSwipeDueDatePopup,
                    visible: true,
                },
            }
        case 'Hide swipe due date popup':
            return {
                ...state,
                showSwipeDueDatePopup: {
                    ...state.showSwipeDueDatePopup,
                    visible: false,
                },
            }
        case 'Set swipe due date data':
            return {
                ...state,
                showSwipeDueDatePopup: {
                    ...state.showSwipeDueDatePopup,
                    data: action.data,
                },
            }
        case 'Show float popup': {
            const valueInc = state.showFloatPopup + 1
            return { ...state, showFloatPopup: valueInc, shownFloatPopup: valueInc > 0 }
        }
        case 'Hide float popup': {
            const valueDec = state.showFloatPopup > 0 ? state.showFloatPopup - 1 : 0
            return { ...state, showFloatPopup: valueDec, shownFloatPopup: valueDec > 0 }
        }
        case 'Reset float popup': {
            return { ...state, showFloatPopup: 0, shownFloatPopup: false }
        }
        case 'Toggle dismissible active':
            return { ...state, dismissibleActive: action.dismissibleActive }
        case 'Set dismissible component':
            return { ...state, dismissibleComponent: action.dismissibleComponent }
        case 'Set shortcut focus tasks': {
            return { ...state, shortcutFocusTasks: action.shortcutFocusTasks }
        }
        case 'Set focused task item': {
            return {
                ...state,
                focusedTaskItem: { id: action.taskId, isObserved: !!action.isObservedTask },
            }
        }
        case 'Set check task item':
            return { ...state, checkTaskItem: { id: action.taskId, isObserved: !!action.isObservedTask } }
        case 'Override store':
            return { ...action.store }
        case 'Set show web side bar':
            return { ...state, showWebSideBar: { ...state.showWebSideBar, visible: true } }
        case 'Set web side bar layout':
            return { ...state, showWebSideBar: { ...state.showWebSideBar, layout: action.layout } }
        case 'Hide web side bar':
            return { ...state, showWebSideBar: { ...state.showWebSideBar, visible: false } }
        case 'Show assignee picker':
            return { ...state, showAssigneePicker: { ...state.showAssigneePicker, visible: true } }
        case 'Hide assignee picker':
            return { ...state, showAssigneePicker: { ...state.showAssigneePicker, visible: false } }
        case 'Set assignee picker layout':
            return { ...state, showAssigneePicker: { ...state.showAssigneePicker, layout: action.layout } }
        case 'Set assignee':
            return { ...state, assignee: action.assignee }
        case 'Show project picker':
            return { ...state, showProjectPicker: { ...state.showProjectPicker, visible: true } }
        case 'Hide project picker':
            return { ...state, showProjectPicker: { ...state.showProjectPicker, visible: false } }
        case 'Set project picker layout':
            return { ...state, showProjectPicker: { ...state.showProjectPicker, layout: action.layout } }
        case 'Show due date calendar':
            return { ...state, showDueDateCalendar: { ...state.showDueDateCalendar, visible: true } }
        case 'Hide due date calendar':
            return { ...state, showDueDateCalendar: { ...state.showDueDateCalendar, visible: false } }
        case 'Set due date calendar layout':
            return { ...state, showDueDateCalendar: { ...state.showDueDateCalendar, layout: action.layout } }
        case 'Set web being responsive':
            return { ...state, webBeingResponsive: action.webBeingResponsive }
        case 'Set initial url':
            return { ...state, initialUrl: action.url }
        case 'Set task in detail view':
            return { ...state, taskInDetailView: action.task }
        case 'Set navigation route':
            return { ...state, route: action.route }
        case 'Set sub task section':
            return { ...state, subTaskSection: action.subTaskSection }
        case 'Set users in project': {
            const { projectId, users } = action

            const currentUser = updateCurrentUserIfNeeded(state, users)
            const projectUsers = { ...state.projectUsers, [projectId]: users }

            return { ...state, projectUsers, currentUser }
        }
        case 'Set contacts in project':
            const { projectId, contacts } = action

            const currentUser = updateCurrentUserIfNeeded(state, contacts)
            const projectContacts = { ...state.projectContacts, [projectId]: contacts }

            return { ...state, projectContacts, currentUser }
        case 'Set assistants in project': {
            const { projectId, assistants } = action

            const currentUser = updateCurrentUserIfNeeded(state, assistants)
            const projectAssistants = { ...state.projectAssistants, [projectId]: assistants }

            // Update default assistant if this is the default project
            const isDefaultProject = projectId === state.loggedUser?.defaultProjectId
            if (isDefaultProject) {
                const newState = { ...state, projectAssistants, currentUser }
                const defaultAssistant = getDefaultAssistant(newState)
                return { ...newState, defaultAssistant }
            }

            return { ...state, projectAssistants, currentUser }
        }
        case 'Set workstreams in project': {
            const { projectId, workstreams } = action

            const currentUser = updateCurrentUserIfNeeded(state, workstreams)
            const projectWorkstreams = { ...state.projectWorkstreams, [projectId]: workstreams }

            return { ...state, projectWorkstreams, currentUser }
        }
        case 'Set meetings in project': {
            const { projectId, meetings } = action
            const projectsMeetings = { ...state.projectsMeetings, [projectId]: meetings }
            return { ...state, projectsMeetings }
        }
        case 'Set invitations in projects': {
            const { projectId, invitations } = action
            const projectInvitations = { ...state.projectInvitations, [projectId]: invitations }
            return { ...state, projectInvitations }
        }
        case 'Set chat notifications in projects': {
            const { projectId, notifications } = action

            const projectChatNotifications = {
                ...state.projectChatNotifications,
                [projectId]: { totalUnfollowed: 0, totalFollowed: 0 },
            }

            notifications.forEach(notification => {
                const { followed, chatId } = notification
                if (projectChatNotifications[projectId][chatId]) {
                    projectChatNotifications[projectId][chatId] = { ...projectChatNotifications[projectId][chatId] }
                } else {
                    projectChatNotifications[projectId][chatId] = { totalUnfollowed: 0, totalFollowed: 0 }
                }

                if (followed) {
                    projectChatNotifications[projectId].totalFollowed++
                    projectChatNotifications[projectId][chatId].totalFollowed++
                } else {
                    projectChatNotifications[projectId].totalUnfollowed++
                    projectChatNotifications[projectId][chatId].totalUnfollowed++
                }
            })

            return {
                ...state,
                projectChatNotifications,
                projectChatLastNotification: state.loggedUser.projectIds.includes(projectId)
                    ? getProjectChatLastNotification(projectId, notifications, state.projectChatLastNotification)
                    : state.projectChatLastNotification,
            }
        }
        case 'Set global assistants': {
            // Update state first so getDefaultAssistant can access it
            const newState = { ...state, globalAssistants: action.globalAssistants }
            const defaultAssistant = getDefaultAssistant(newState)
            return { ...newState, defaultAssistant }
        }
        case 'Set selected type of project':
            return { ...state, selectedTypeOfProject: action.selectedTypeOfProject }
        case 'Set task title in edit mode':
            return { ...state, taskTitleInEditMode: action.isInEditMode }
        case 'Set task view toggle index':
            return { ...state, taskViewToggleIndex: action.taskViewToggleIndex }
        case 'Set task view toggle section':
            return { ...state, taskViewToggleSection: action.taskViewToggleSection }
        case 'Set workflow step':
            return { ...state, workflowStep: action.step }
        case 'Set user workflow':
            return { ...state, userWorkflow: action.workflow }
        case 'Set amount tasks by projects':
            return { ...state, amountTasksByProjects: action.amountTasksByProjects }
        case 'Activate search form':
            return { ...state, activeSearchForm: true }
        case 'Deactivate search form':
            return { ...state, activeSearchForm: false }
        case 'Set search text':
            return { ...state, searchText: action.searchText }
        case 'Set new feed count': {
            const newState = { ...state }
            if (action.projectIndex < 0) {
                for (let i = 0; i < newState.loggedUserProjects.length; ++i) {
                    newState.feedCount[i] = action.feedCount[i]
                }
            } else {
                newState.feedCount[action.projectIndex] = action.feedCount
            }
            return { ...newState }
        }
        case 'Set all new feed count': {
            const newState = { ...state, allNewFeedCount: action.allNewFeedCount }
            return { ...newState }
        }
        case 'Set all feed count': {
            const newState = { ...state }
            newState.allFeedCount[action.projectIndex] = action.projectFeedCount
            return { ...newState }
        }
        case 'Store feed list by projects': {
            return { ...state, feedListByProjects: action.feedListByProjects }
        }
        case 'Set new feed count pause':
            return { ...state, pauseNewFeedCount: action.newFeedCountPause }
        case 'Set last visited screen':
            return { ...state, lastVisitedScreen: action.lastVisitedScreen }
        case 'Set task title elements widths':
            return { ...state, taskTitleElementsWidths: action.taskTitleElementsWidths }
        case 'Start loading data': {
            const { processes } = action
            const valueInc =
                processes !== undefined && processes !== null && processes > 0
                    ? state.isLoadingData + processes
                    : state.isLoadingData + 1
            return { ...state, isLoadingData: valueInc, showLoadingDataSpinner: valueInc > 0 }
        }
        case 'Stop loading data': {
            const valueDec = state.isLoadingData > 0 ? state.isLoadingData - 1 : 0
            return { ...state, isLoadingData: valueDec, showLoadingDataSpinner: valueDec > 0 }
        }
        case 'Reset loading data':
            return { ...state, isLoadingData: 0, showLoadingDataSpinner: false }
        case 'Set registered new user':
            return { ...state, registeredNewUser: action.registeredNewUser }
        case 'Set global search results':
            return { ...state, globalSearchResults: action.results }
        case 'Show global search popup':
            return {
                ...state,
                showGlobalSearchPopup: true,
                globalSearchPopupOpenUsingShortcuts: action.globalSearchPopupOpenUsingShortcuts,
            }
        case 'Hide global search popup':
            return {
                ...state,
                showGlobalSearchPopup: false,
                globalSearchPopupOpenUsingShortcuts: false,
            }
        case 'Set real time search results':
            return { ...state, realTimeSearchResults: action.results }
        case 'Set sidebar numbers':
            return { ...state, sidebarNumbers: action.numbers }
        case 'Set add task repeat mode':
            return { ...state, addTaskRepeatMode: true }
        case 'Unset add task repeat mode':
            return { ...state, addTaskRepeatMode: false }
        case 'Set active edit mode':
            return { ...state, activeEditMode: true }
        case 'Unset active edit mode':
            return { ...state, activeEditMode: false }
        case 'Update feeds count':
            return { ...state, feedsCount: action.feedsCount }
        case 'Set uploaded new subtask':
            return { ...state, uploadedNewSubtask: true }
        case 'Unset uploaded new subtask':
            return { ...state, uploadedNewSubtask: false }
        case 'Update feed active tab':
            return { ...state, feedActiveTab: action.feedActiveTab }
        case 'Update notes active tab':
            return { ...state, notesActiveTab: action.notesActiveTab }
        case 'Set goals active tab':
            return { ...state, goalsActiveTab: action.goalsActiveTab }
        case 'Set chats active tab':
            return { ...state, chatsActiveTab: action.chatsActiveTab }
        case 'Update contacts active tab':
            return { ...state, contactsActiveTab: action.contactsActiveTab }
        case 'Set screen dimensions':
            return { ...state, screenDimensions: action.screenDimensions }
        case 'Set show new day notification':
            return { ...state, showNewDayNotification: action.show }
        case 'Show note changed notification':
            return { ...state, noteChangedNotification: action.notification }
        case 'Set last add new task date':
            return { ...state, lastAddNewTaskDate: action.lastAddNewTaskDate }
        case 'Set last add new note date':
            return { ...state, lastAddNewNoteDate: action.lastAddNewNoteDate }
        case 'Set last add new contact':
            return { ...state, lastAddNewContact: action.lastAddNewContact }
        case 'Set show more in main section':
            return { ...state, showMoreInMainSection: action.showMoreInMainSection }
        case 'Set active drag goal mode':
            return { ...state, activeDragGoalMode: action.activeDragGoalMode }
        case 'Set active drag task mode in date': {
            return {
                ...state,
                activeDragTaskModeInDate: {
                    projectId: action.projectId,
                    dateIndex: action.dateIndex,
                },
            }
        }
        case 'Remove active drag task mode in date': {
            return { ...state, activeDragTaskModeInDate: false }
        }

        case 'Add task id with subtasks expanded when active drag task mode': {
            const tasksIds = { ...state.tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode, [action.taskId]: true }
            return {
                ...state,
                tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode: tasksIds,
            }
        }

        case 'Remove task id with subtasks expanded when active drag task mode': {
            const tasksIds = { ...state.tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode }
            delete tasksIds[action.taskId]
            return {
                ...state,
                tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode: tasksIds,
            }
        }

        case 'Clear tasks ids with subtasks expanded when active drag task mode': {
            return {
                ...state,
                tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode: {},
            }
        }

        case 'Set active modal in feed':
            return { ...state, activeModalInFeed: action.activeModalInFeed }
        case 'Set notes amounts':
            const notesAmounts = [...state.notesAmounts]
            notesAmounts[action.projectIndex] = action.amount
            return { ...state, notesAmounts }
        case 'Reset notes amounts':
            return { ...state, notesAmounts: [] }
        case 'Set updates amounts':
            const updatesAmounts = [...state.updatesAmounts]
            updatesAmounts[action.projectIndex] = action.amount
            return { ...state, updatesAmounts }
        case 'Reset updates amounts':
            return { ...state, updatesAmounts: [] }
        case 'Set previous screen': {
            return { ...state, prevScreen: action.prevScreen }
        }
        case 'Set reload global feeds': {
            return { ...state, needReloadGlobalFeeds: action.needReloadGlobalFeeds }
        }
        case 'Show shortcuts': {
            return { ...state, showShortcuts: true }
        }
        case 'Hide shortcuts': {
            return { ...state, showShortcuts: false }
        }
        case 'Show note ctrl shortcuts': {
            return { ...state, showNoteCtrlShortcuts: true }
        }
        case 'Hide note ctrl shortcuts': {
            return { ...state, showNoteCtrlShortcuts: false }
        }
        case 'Show note alt shortcuts': {
            return { ...state, showNoteAltShortcuts: true }
        }
        case 'Hide note alt shortcuts': {
            return { ...state, showNoteAltShortcuts: false }
        }
        case 'Set followed feeds': {
            if (action.projectId) {
                return { ...state, followedFeeds: { ...state.followedFeeds, [action.projectId]: action.followedFeeds } }
            }
            return { ...state, followedFeeds: {} }
        }
        case 'Set all feeds': {
            if (action.projectId) {
                return { ...state, allFeeds: { ...state.allFeeds, [action.projectId]: action.allFeeds } }
            }
            return { ...state, allFeeds: {} }
        }
        case 'Set new local feeed data': {
            return { ...state, newLocalFeedData: action.newLocalFeedData }
        }
        case 'Set in partner feeds': {
            return { ...state, inPartnerFeeds: action.inPartnerFeeds }
        }
        case 'Set show cheat sheet': {
            return { ...state, showCheatSheet: action.showCheatSheet }
        }
        case 'Set loaded new feeds': {
            return { ...state, loadedNewFeeds: true }
        }
        case 'Set last selected due date': {
            return { ...state, lastSelectedDueDate: action.lastSelectedDueDate }
        }
        case 'Set project notes': {
            return { ...state, projectNotes: action.projectNotes }
        }
        case 'Trigger watch tasks':
            return { ...state, watchTasksTrigger: state.watchTasksTrigger + 1 }
        case 'Set dragging parent task id': {
            return { ...state, draggingParentTaskId: action.draggingParentTaskId }
        }
        case 'Set open tasks map': {
            const openTasksMap = { ...state.openTasksMap, [action.projectId]: action.openTasksMap }
            return { ...state, openTasksMap }
        }
        case 'Clear open tasks map': {
            const openTasksMap = { ...state.openTasksMap }
            delete openTasksMap[action.projectId]
            return { ...state, openTasksMap }
        }
        case 'Set open subtasks map': {
            const openSubtasksMap = { ...state.openSubtasksMap, [action.projectId]: action.openSubtasksMap }
            return { ...state, openSubtasksMap }
        }
        case 'Clear open subtasks map': {
            const openSubtasksMap = { ...state.openSubtasksMap }
            delete openSubtasksMap[action.projectId]
            return { ...state, openSubtasksMap }
        }
        case 'Set task list watchers vars': {
            return { ...state, taskListWatchersVars: action.taskListWatchersVars }
        }
        case 'Set global data by project': {
            return { ...state, globalDataByProject: action.globalDataByProject }
        }
        case 'Set shared mode': {
            return { ...state, inSharedMode: true }
        }
        case 'Unset shared mode': {
            return { ...state, inSharedMode: false }
        }
        case 'Set show access denied popup': {
            return { ...state, showAccessDeniedPopup: action.showAccessDeniedPopup }
        }
        case 'Set show end copy project popup': {
            return { ...state, endCopyProjectPopupData: action.endCopyProjectPopupData }
        }
        case 'Set quill editor project id': {
            return { ...state, quillEditorProjectId: action.quillEditorProjectId }
        }
        case 'Set is quill tag editor open': {
            return { ...state, isQuillTagEditorOpen: action.isQuillTagEditorOpen }
        }
        case 'Set in backlinks view': {
            return { ...state, inBacklinksView: action.inBacklinksView }
        }
        case 'Set backlink section': {
            return { ...state, backlinkSection: action.backlinkSection }
        }
        case 'Set project type section index': {
            return { ...state, projectTypeSectionIndex: action.projectTypeSectionIndex }
        }
        case 'Set Select tasks': {
            if (!action.reset) {
                const task = { ...action.selectedTasks }
                if (!state.selectedTasks.some(elem => elem.id === task.id)) {
                    return {
                        ...state,
                        selectedTasks: [...state.selectedTasks.filter(item => item.id !== task.id), task],
                    }
                } else {
                    return { ...state, selectedTasks: state.selectedTasks.filter(item => item.id !== task.id) }
                }
            } else {
                return { ...state, selectedTasks: [] }
            }
        }
        case 'Update all selected tasks': {
            return { ...state, selectedTasks: action.selectedTasks }
        }
        case 'Is Dragging': {
            return { ...state, isDragging: action.isDragging }
        }
        case 'Store open modal': {
            const modals = { ...state.openModals }
            modals[action.modalId] = action.params ? action.params : {}
            return { ...state, openModals: modals }
        }
        case 'Remove open modal': {
            const modals = { ...state.openModals }
            delete modals[action.modalId]
            return { ...state, openModals: modals }
        }
        case 'Reset open modal': {
            return { ...state, openModals: {} }
        }
        case 'Store in mention modal stack': {
            const stack = [...state.mentionModalStack]
            stack.unshift(action.modalId)
            return { ...state, mentionModalStack: stack }
        }
        case 'Remove from mention modal stack': {
            const stack = [...state.mentionModalStack]
            const index = stack.indexOf(action.modalId)
            stack.splice(index, 1)
            return { ...state, mentionModalStack: stack }
        }
        case 'Set mention modal new form open': {
            return { ...state, mentionModalNewFormOpen: action.mentionModalNewFormOpen }
        }
        case 'Block background tab shortcut': {
            return { ...state, blockBackgroundTabShortcut: true }
        }
        case 'Unblock background tab shortcut': {
            return { ...state, blockBackgroundTabShortcut: false }
        }
        case 'Switch shortcut project':
            return { ...state, shortcutSelectedProjectIndex: action.projectIndex }
        case 'Store current shortcut user':
            return { ...state, shortcutCurrentUserUid: action.currentUserUid }
        case 'Set milestone in edition id':
            return { ...state, milestoneInEditionId: action.milestoneInEditionId }
        case 'Set goal in edition milestone id':
            return { ...state, goalInEditionMilestoneId: action.goalInEditionMilestoneId }
        case 'Set goal swipe milestone modal open':
            return { ...state, goalSwipeMilestoneModalOpen: action.goalSwipeMilestoneModalOpen }
        case 'Set force close goal edition id':
            return { ...state, forceCloseGoalEditionId: action.forceCloseGoalEditionId }
        case 'Set force close skill edition id':
            return { ...state, forceCloseSkillEditionId: action.forceCloseSkillEditionId }
        case 'Set show limited feature modal':
            return { ...state, showLimitedFeatureModal: action.showLimitedFeatureModal }
        case 'Set show limit premium quota modal':
            return { ...state, showLimitPremiumQuotaModal: action.showLimitPremiumQuotaModal }
        case 'Set limit quota modal data':
            return {
                ...state,
                limitQuotaModalData: {
                    visible: action.visible,
                    quotaType: action.quotaType,
                    projectName: action.projectName,
                    monthlyXp: action.monthlyXp,
                    monthlyTraffic: action.monthlyTraffic,
                },
            }
        case 'Show new version mandtory notifcation': {
            return {
                ...state,
                showNewVersionMandtoryNotifcation: true,
            }
        }
        case 'Set active note id': {
            return {
                ...state,
                activeNoteId: action.activeNoteId,
            }
        }
        case 'Set active note is read only': {
            return {
                ...state,
                activeNoteIsReadOnly: action.activeNoteIsReadOnly,
            }
        }
        case 'Set top bar width': {
            return {
                ...state,
                topBarWidth: action.topBarWidth,
            }
        }
        case 'Set hashtags colors': {
            const { projectId, text, colorKey } = action
            const projectHashtagsColors = state.hashtagsColors[projectId] ? state.hashtagsColors[projectId] : {}
            return {
                ...state,
                hashtagsColors: {
                    ...state.hashtagsColors,
                    [projectId]: { ...projectHashtagsColors, [text]: colorKey },
                },
            }
        }
        case 'Set virtual quill loaded': {
            return {
                ...state,
                virtualQuillLoaded: action.virtualQuillLoaded,
            }
        }
        case 'Set block shortcuts': {
            return {
                ...state,
                blockShortcuts: action.blockShortcuts,
            }
        }

        case 'Set goals show more expanded': {
            return {
                ...state,
                goalsShowMoreExpanded: action.goalsShowMoreExpanded,
            }
        }

        case 'Set is loading note data': {
            return {
                ...state,
                isLoadingNoteData: action.isLoadingNoteData,
            }
        }

        case 'Set note editor scroll dimensions': {
            return {
                ...state,
                noteEditorScrollDimensions: action.noteEditorScrollDimensions,
            }
        }

        case 'Set tmp input text task': {
            return {
                ...state,
                tmpInputTextTask: action.text,
            }
        }

        case 'Set tmp input text goal': {
            return {
                ...state,
                tmpInputTextGoal: action.text,
            }
        }

        case 'Set tmp input text note': {
            return {
                ...state,
                tmpInputTextNote: action.text,
            }
        }

        case 'Set show note max length modal': {
            return {
                ...state,
                showNoteMaxLengthModal: action.showNoteMaxLengthModal,
            }
        }

        case 'Set tmp input text contact': {
            return {
                ...state,
                tmpInputTextContact: action.text,
            }
        }

        case 'Set today empty goals total amount in open tasks view': {
            const projectId = action.projectId
            const amount = action.amount

            const todayEmptyGoalsTotalAmountInOpenTasksView = { ...state.todayEmptyGoalsTotalAmountInOpenTasksView }

            if (todayEmptyGoalsTotalAmountInOpenTasksView[projectId]) {
                todayEmptyGoalsTotalAmountInOpenTasksView.total -= todayEmptyGoalsTotalAmountInOpenTasksView[projectId]
            }

            if (amount) {
                todayEmptyGoalsTotalAmountInOpenTasksView.total += amount
                todayEmptyGoalsTotalAmountInOpenTasksView[projectId] = amount
            } else {
                delete todayEmptyGoalsTotalAmountInOpenTasksView[projectId]
            }

            return {
                ...state,
                todayEmptyGoalsTotalAmountInOpenTasksView,
            }
        }

        case 'Set gold earned': {
            const { goldEarned, checkBoxId } = action
            return {
                ...state,
                goldEarnedData: { goldEarned, checkBoxId },
                showGoldChain: true,
                showGoldCoin: true,
            }
        }

        case 'Hide gold chain': {
            return {
                ...state,
                showGoldChain: false,
            }
        }

        case 'Hide gold coin': {
            return {
                ...state,
                showGoldCoin: false,
            }
        }

        case 'Clear hashtag filters': {
            return {
                ...state,
                hashtagFilters: new Map(),
            }
        }

        case 'Add hashtag filters': {
            const newMap = new Map(state.hashtagFilters)
            newMap.set(action.hashtag, action.colorKey)
            return {
                ...state,
                hashtagFilters: newMap,
            }
        }

        case 'Remove hashtag filters': {
            const newMap = new Map(state.hashtagFilters)
            newMap.delete(action.hashtag)
            return {
                ...state,
                hashtagFilters: newMap,
            }
        }

        case 'Set quill textinput project ids by editor id': {
            const quillTextInputProjectIdsByEditorId = { ...state.quillTextInputProjectIdsByEditorId }
            if (action.projectId) {
                quillTextInputProjectIdsByEditorId[action.editorId] = action.projectId
            } else {
                delete quillTextInputProjectIdsByEditorId[action.editorId]
            }
            return { ...state, quillTextInputProjectIdsByEditorId }
        }

        case 'Set note inner tasks': {
            return {
                ...state,
                notesInnerTasks: { ...state.notesInnerTasks, [action.noteId]: action.innerTasks },
            }
        }

        case 'Remove note inner tasks': {
            const notesInnerTasks = { ...state.notesInnerTasks }
            delete notesInnerTasks[action.noteId]
            return {
                ...state,
                notesInnerTasks,
            }
        }

        case 'Set active chat data': {
            return {
                ...state,
                activeChatData: action.activeChatData,
            }
        }

        case 'Set later tasks expanded for navigate from all projects': {
            return {
                ...state,
                laterTasksExpandedForNavigateFromAllProjects: action.laterTasksExpandedForNavigateFromAllProjects,
            }
        }

        case 'Set someday tasks expanded for navigate from all projects': {
            return {
                ...state,
                somedayTasksExpandedForNavigateFromAllProjects: action.somedayTasksExpandedForNavigateFromAllProjects,
            }
        }

        case 'Tasks arrow button is expanded': {
            return {
                ...state,
                tasksArrowButtonIsExpanded: action.tasksArrowButtonIsExpanded,
            }
        }

        case 'Set hover sidebar': {
            return {
                ...state,
                sidebarHovered: action.hover,
            }
        }

        case 'Set add project status': {
            return {
                ...state,
                addProjectIsOpen: action.status,
            }
        }

        case 'Set add contact status': {
            return {
                ...state,
                addContactIsOpen: action.status,
            }
        }

        case 'Set followed feeds amount': {
            return {
                ...state,
                followedFeedsAmount: action.followedFeedsAmount,
            }
        }

        case 'Set all feeds amount': {
            return {
                ...state,
                allFeedsAmount: action.allFeedsAmount,
            }
        }

        case 'Set followed feeds data': {
            return {
                ...state,
                followedFeedsData: action.followedFeedsData,
            }
        }

        case 'Set all feeds data': {
            return {
                ...state,
                allFeedsData: action.allFeedsData,
            }
        }

        case 'Set amount done tasks expanded': {
            const { amountDoneTasksExpanded } = action
            return {
                ...state,
                amountDoneTasksExpanded: amountDoneTasksExpanded > 0 ? amountDoneTasksExpanded : 0,
            }
        }

        case 'Set later tasks expanded': {
            return {
                ...state,
                laterTasksExpanded: action.laterTasksExpanded,
            }
        }

        case 'Set someday tasks expanded': {
            return {
                ...state,
                somedayTasksExpanded: action.somedayTasksExpanded,
            }
        }

        case 'Set open tasks amount': {
            const { openTasksAmount } = action
            return {
                ...state,
                openTasksAmount: openTasksAmount ? openTasksAmount : 0,
            }
        }

        case 'Set done tasks amount': {
            const { doneTasksAmount } = action
            return {
                ...state,
                doneTasksAmount,
            }
        }

        case 'Set earlier done tasks amount': {
            const { earlierDoneTasksAmount } = action
            return {
                ...state,
                earlierDoneTasksAmount,
            }
        }

        case 'Add there are later open tasks': {
            const { projectId, thereAreLaterOpenTasks } = action
            return {
                ...state,
                thereAreLaterOpenTasks: {
                    ...state.thereAreLaterOpenTasks,
                    [projectId]: thereAreLaterOpenTasks,
                },
            }
        }

        case 'Remove there are later open tasks': {
            const { projectId } = action
            const thereAreLaterOpenTasks = { ...state.thereAreLaterOpenTasks }
            delete thereAreLaterOpenTasks[projectId]
            return {
                ...state,
                thereAreLaterOpenTasks,
            }
        }

        case 'Add there are someday open tasks': {
            const { projectId, thereAreSomedayOpenTasks } = action
            return {
                ...state,
                thereAreSomedayOpenTasks: {
                    ...state.thereAreSomedayOpenTasks,
                    [projectId]: thereAreSomedayOpenTasks,
                },
            }
        }

        case 'Update record video modal data': {
            return {
                ...state,
                recordVideoModalData: action.recordVideoModalData,
            }
        }

        case 'Update screen recording modal data': {
            return {
                ...state,
                screenRecordingModalData: action.screenRecordingModalData,
            }
        }

        case 'Update chat google meet modal data': {
            return {
                ...state,
                chatGoogleMeetModalData: action.chatGoogleMeetModalData,
            }
        }

        case 'Update google meet modal data': {
            return {
                ...state,
                googleMeetModalData: action.googleMeetModalData,
            }
        }

        case 'Update google meet notification modal data': {
            return {
                ...state,
                googleMeetNotificationModalData: action.googleMeetNotificationModalData,
            }
        }

        case 'Update task suggested comment modal data': {
            return {
                ...state,
                taskSuggestedCommentModalData: action.taskSuggestedCommentModalData,
            }
        }

        case 'Remove there are someday open tasks': {
            const { projectId } = action
            const thereAreSomedayOpenTasks = {
                ...state.thereAreSomedayOpenTasks,
            }
            delete thereAreSomedayOpenTasks[projectId]
            return {
                ...state,
                thereAreSomedayOpenTasks,
            }
        }

        case 'Add there are later empty goals': {
            const { projectId, thereAreLaterEmptyGoals } = action
            return {
                ...state,
                thereAreLaterEmptyGoals: {
                    ...state.thereAreLaterEmptyGoals,
                    [projectId]: thereAreLaterEmptyGoals,
                },
            }
        }

        case 'Remove there are later empty goals': {
            const { projectId } = action
            const thereAreLaterEmptyGoals = { ...state.thereAreLaterEmptyGoals }
            delete thereAreLaterEmptyGoals[projectId]
            return {
                ...state,
                thereAreLaterEmptyGoals,
            }
        }

        case 'Add there are someday empty goals': {
            const { projectId, thereAreSomedayEmptyGoals } = action
            return {
                ...state,
                thereAreSomedayEmptyGoals: {
                    ...state.thereAreSomedayEmptyGoals,
                    [projectId]: thereAreSomedayEmptyGoals,
                },
            }
        }

        case 'Remove there are someday empty goals': {
            const { projectId } = action
            const thereAreSomedayEmptyGoals = { ...state.thereAreSomedayEmptyGoals }
            delete thereAreSomedayEmptyGoals[projectId]
            return {
                ...state,
                thereAreSomedayEmptyGoals,
            }
        }

        case 'Set workflow tasks amount': {
            const { workflowTasksAmount } = action

            const loading = workflowTasksAmount === null || workflowTasksAmount === undefined
            return {
                ...state,
                workflowTasksAmount: loading
                    ? { amount: 0, loaded: false }
                    : { amount: workflowTasksAmount, loaded: true },
            }
        }

        case 'Update open tasks': {
            const { instanceKey, openTasksStore } = action
            const newData = { ...state.openTasksStore }
            openTasksStore === null ? delete newData[instanceKey] : (newData[instanceKey] = openTasksStore)
            return {
                ...state,
                openTasksStore: newData,
            }
        }

        case 'Update there are hidden not main tasks': {
            const { instanceKey, thereAreHiddenNotMainTasks } = action
            const newData = { ...state.thereAreHiddenNotMainTasks }
            thereAreHiddenNotMainTasks === null
                ? delete newData[instanceKey]
                : (newData[instanceKey] = thereAreHiddenNotMainTasks)
            return {
                ...state,
                thereAreHiddenNotMainTasks: newData,
            }
        }

        case 'Update filtered open tasks': {
            const { instanceKey, filteredOpenTasksStore } = action
            const newData = { ...state.filteredOpenTasksStore }
            filteredOpenTasksStore === null
                ? delete newData[instanceKey]
                : (newData[instanceKey] = filteredOpenTasksStore)
            return {
                ...state,
                filteredOpenTasksStore: newData,
            }
        }

        case 'Update subtask by task': {
            const { instanceKey, subtaskByTaskStore } = action
            const newData = { ...state.subtaskByTaskStore }
            subtaskByTaskStore === null ? delete newData[instanceKey] : (newData[instanceKey] = subtaskByTaskStore)
            return {
                ...state,
                subtaskByTaskStore: newData,
            }
        }

        case 'Update thre are not tasks in first day': {
            const { instanceKey, thereAreNotTasksInFirstDay } = action
            const newData = { ...state.thereAreNotTasksInFirstDay }
            thereAreNotTasksInFirstDay === null
                ? delete newData[instanceKey]
                : (newData[instanceKey] = thereAreNotTasksInFirstDay)
            return {
                ...state,
                thereAreNotTasksInFirstDay: newData,
            }
        }

        case 'Update initial loading end open tasks': {
            const { instanceKey, initialLoadingEndOpenTasks } = action
            const newData = { ...state.initialLoadingEndOpenTasks }
            initialLoadingEndOpenTasks === null
                ? delete newData[instanceKey]
                : (newData[instanceKey] = initialLoadingEndOpenTasks)
            return {
                ...state,
                initialLoadingEndOpenTasks: newData,
            }
        }

        case 'Update initial loading end observed tasks': {
            const { instanceKey, initialLoadingEndObservedTasks } = action
            const newData = { ...state.initialLoadingEndObservedTasks }
            initialLoadingEndObservedTasks === null
                ? delete newData[instanceKey]
                : (newData[instanceKey] = initialLoadingEndObservedTasks)
            return {
                ...state,
                initialLoadingEndObservedTasks: newData,
            }
        }

        case 'Set open milestones in project in tasks': {
            const { projectId, milestones } = action
            const openMilestonesByProjectInTasks = { ...state.openMilestonesByProjectInTasks }
            milestones
                ? (openMilestonesByProjectInTasks[projectId] = milestones)
                : delete openMilestonesByProjectInTasks[projectId]
            return { ...state, openMilestonesByProjectInTasks }
        }
        case 'Set done milestones in project in tasks': {
            const { projectId, milestones } = action
            const doneMilestonesByProjectInTasks = { ...state.doneMilestonesByProjectInTasks }
            milestones
                ? (doneMilestonesByProjectInTasks[projectId] = milestones)
                : delete doneMilestonesByProjectInTasks[projectId]
            return { ...state, doneMilestonesByProjectInTasks }
        }

        case 'Set goals in project in tasks': {
            const { projectId, goals } = action
            const goalsByProjectInTasks = { ...state.goalsByProjectInTasks }
            goals ? (goalsByProjectInTasks[projectId] = goals) : delete goalsByProjectInTasks[projectId]
            return { ...state, goalsByProjectInTasks }
        }

        case 'Set adding user to community': {
            return { ...state, addingUserToGuide: action.addingUserToGuide }
        }

        case 'Set active community id': {
            return { ...state, activeGuideId: action.activeGuideId }
        }

        case 'Set active template id': {
            return { ...state, activeTemplateId: action.activeTemplateId }
        }

        case 'Set are archived actives': {
            return { ...state, areArchivedActive: action.areArchivedActive }
        }

        case 'Set skills by project': {
            const { projectId, skills } = action
            const skillsByProject = { ...state.skillsByProject }
            if (!skillsByProject.total) skillsByProject.total = 0
            if (skills) {
                if (skillsByProject[projectId]) skillsByProject.total -= skillsByProject[projectId].length
                skillsByProject[projectId] = skills
                skillsByProject.total += skillsByProject[projectId].length
            } else {
                delete skillsByProject[projectId]
                if (Object.keys(skillsByProject).length === 1) delete skillsByProject.total
            }
            return { ...state, skillsByProject }
        }

        case 'Set active drag skill mode id': {
            const { activeDragSkillModeId } = action
            return { ...state, activeDragSkillModeId }
        }

        case 'Set skills default privacy': {
            const { projectId, skillsDefaultPrivacy } = action
            const skillsDefaultPrivacyByProject = { ...state.skillsDefaultPrivacyByProject }
            skillsDefaultPrivacy
                ? (skillsDefaultPrivacyByProject[projectId] = skillsDefaultPrivacy)
                : delete skillsDefaultPrivacyByProject[projectId]
            return { ...state, skillsDefaultPrivacyByProject }
        }

        case 'Set skill in dv': {
            return { ...state, skillInDv: action.skillInDv }
        }

        case 'Set dv is full screen': {
            return { ...state, dvIsFullScreen: action.dvIsFullScreen }
        }
        case 'Set sidebar input open type': {
            return { ...state, sidebarInputOpenType: action.sidebarInputOpenType }
        }
        case 'Set quoted note text': {
            return { ...state, quotedNoteText: action.quotedNoteText }
        }
        case 'Set quoted text': {
            return { ...state, quotedText: action.quotedText }
        }
        case 'Set active chat message id': {
            return { ...state, activeChatMessageId: action.activeChatMessageId }
        }
        case 'Set chat pages amount': {
            return { ...state, chatPagesAmount: action.chatPagesAmount }
        }
        case 'Set user info modal when user joins to community': {
            return {
                ...state,
                showUserInfoModalWhenUserJoinsToGuide: action.showUserInfoModalWhenUserJoinsToGuide,
            }
        }

        case 'Set open milestones in project': {
            const { projectId, milestones } = action
            const openMilestonesByProject = { ...state.openMilestonesByProject }
            milestones ? (openMilestonesByProject[projectId] = milestones) : delete openMilestonesByProject[projectId]
            return { ...state, openMilestonesByProject }
        }
        case 'Set done milestones in project': {
            const { projectId, milestones } = action
            const doneMilestonesByProject = { ...state.doneMilestonesByProject }
            milestones ? (doneMilestonesByProject[projectId] = milestones) : delete doneMilestonesByProject[projectId]
            return { ...state, doneMilestonesByProject }
        }

        case 'Set goals in project': {
            const { projectId, goals } = action
            const goalsByProject = { ...state.goalsByProject }
            goals ? (goalsByProject[projectId] = goals) : delete goalsByProject[projectId]
            return { ...state, goalsByProject }
        }

        case 'Set board milestones in project': {
            const { projectId, milestones } = action
            const boardMilestonesByProject = { ...state.boardMilestonesByProject }
            milestones ? (boardMilestonesByProject[projectId] = milestones) : delete boardMilestonesByProject[projectId]
            return { ...state, boardMilestonesByProject }
        }

        case 'Set board goals by milestone in project': {
            const { projectId, goalsByMilestone } = action
            const boardGoalsByMilestoneByProject = { ...state.boardGoalsByMilestoneByProject }
            goalsByMilestone
                ? (boardGoalsByMilestoneByProject[projectId] = goalsByMilestone)
                : delete boardGoalsByMilestoneByProject[projectId]
            return { ...state, boardGoalsByMilestoneByProject }
        }

        case 'Set board need show more in project': {
            const { projectId, needShowMore } = action
            const boardNeedShowMoreByProject = { ...state.boardNeedShowMoreByProject }
            needShowMore
                ? (boardNeedShowMoreByProject[projectId] = needShowMore)
                : delete boardNeedShowMoreByProject[projectId]
            return { ...state, boardNeedShowMoreByProject }
        }

        case 'Set open goals amount': {
            const projectId = action.projectId
            const amount = action.amount

            const openGoalsAmountByProject = { ...state.openGoalsAmountByProject }

            if (openGoalsAmountByProject[projectId]) {
                openGoalsAmountByProject.total -= openGoalsAmountByProject[projectId]
            }

            if (amount) {
                openGoalsAmountByProject.total += amount
                openGoalsAmountByProject[projectId] = amount
            } else {
                delete openGoalsAmountByProject[projectId]
            }

            return {
                ...state,
                openGoalsAmountByProject,
            }
        }

        case 'Set done goals amount': {
            const projectId = action.projectId
            const amount = action.amount

            const doneGoalsAmountByProject = { ...state.doneGoalsAmountByProject }

            if (doneGoalsAmountByProject[projectId]) {
                doneGoalsAmountByProject.total -= doneGoalsAmountByProject[projectId]
            }

            if (amount) {
                doneGoalsAmountByProject.total += amount
                doneGoalsAmountByProject[projectId] = amount
            } else {
                delete doneGoalsAmountByProject[projectId]
            }

            return {
                ...state,
                doneGoalsAmountByProject,
            }
        }

        case 'Press show later tasks in all projects': {
            const { projectIndex, projectType, projectId, thereAreLaterObjects } = action
            return {
                ...state,
                laterTasksExpandedForNavigateFromAllProjects: true,
                somedayTasksExpandedForNavigateFromAllProjects: !thereAreLaterObjects,
                selectedSidebarTab: DV_TAB_ROOT_TASKS,
                selectedProjectIndex: projectIndex,
                selectedTypeOfProject: projectType,
                laterTasksExpanded: true,
                somedayTasksExpanded: !thereAreLaterObjects,
            }
        }

        case 'Set administrator user': {
            return { ...state, administratorUser: action.administratorUser }
        }

        case 'Set selected goal data in tasks list when add task': {
            return { ...state, selectedGoalDataInTasksListWhenAddTask: action.selectedGoalDataInTasksListWhenAddTask }
        }

        case 'Set add task section to open data': {
            return { ...state, addTaskSectionToOpenData: action.addTaskSectionToOpenData }
        }

        case 'Set new user need to join to project': {
            return { ...state, newUserNeedToJoinToProject: action.newUserNeedToJoinToProject }
        }

        case 'Set show notification about the bot behavior': {
            return { ...state, showNotificationAboutTheBotBehavior: action.showNotificationAboutTheBotBehavior }
        }

        case 'Set assistant enabled': {
            return { ...state, assistantEnabled: action.assistantEnabled }
        }

        case 'Set not enabled assistant when load comments': {
            return { ...state, notEnabledAssistantWhenLoadComments: action.notEnabledAssistantWhenLoadComments }
        }

        case 'Set trigger bot spinner': {
            return { ...state, triggerBotSpinner: action.triggerBotSpinner }
        }

        case 'Set pre-config task executing': {
            return { ...state, preConfigTaskExecuting: action.isExecuting }
        }

        case 'Set disable auto focus in chat': {
            return { ...state, disableAutoFocusInChat: action.disableAutoFocusInChat }
        }

        case 'Set main chat editor': {
            return { ...state, mainChatEditor: action.mainChatEditor }
        }

        case 'Set goal open tasks data': {
            return { ...state, goalOpenTasksData: action.goalOpenTasksData }
        }

        case 'Set goal open subtasks data': {
            return { ...state, goalOpenSubtasksByParent: action.goalOpenSubtasksByParent }
        }

        case 'Set goal workflow tasks data': {
            return { ...state, goalWorkflowTasksData: action.goalWorkflowTasksData }
        }

        case 'Set goal workflow subtasks data': {
            return { ...state, goalWorkflowSubtasksByParent: action.goalWorkflowSubtasksByParent }
        }

        case 'Set goal done tasks data': {
            return { ...state, goalDoneTasksData: action.goalDoneTasksData }
        }

        case 'Set goal done subtasks data': {
            return { ...state, goalDoneSubtasksByParent: action.goalDoneSubtasksByParent }
        }

        case 'Set goal open tasks expand state': {
            return { ...state, goalOpenTasksExpandState: action.goalOpenTasksExpandState }
        }

        case 'Set goal open main tasks expanded': {
            return { ...state, goalOpenMainTasksExpanded: action.goalOpenMainTasksExpanded }
        }

        case 'Set goal done tasks expanded amount': {
            return { ...state, goalDoneTasksExpandedAmount: action.goalDoneTasksExpandedAmount }
        }

        ////////////////ANONYMOUS

        case 'Init anonymous sesion': {
            const { loggedUser, currentUser } = action
            return {
                ...state,
                loggedUser: updateInactiveProjectsData(
                    loggedUser,
                    state.activeGuideId,
                    state.activeTemplateId,
                    state.areArchivedActive
                ),
                currentUser,
                loggedIn: true,
            }
        }

        case 'Set anonymous sesion data': {
            const { project, users, workstreams, contacts, assistants, globalAssistants, administratorUser } = action
            project.index = 0

            return {
                ...state,
                selectedProjectIndex: 0,
                loggedUserProjects: [project],
                loggedUserProjectsMap: { [project.id]: project },
                projectUsers: { [project.id]: users },
                projectWorkstreams: { [project.id]: workstreams },
                projectContacts: { [project.id]: contacts },
                projectAssistants: { [project.id]: assistants },
                projectsMeetings: { [project.id]: [] },
                projectInvitations: { [project.id]: [] },
                projectChatNotifications: { [project.id]: { totalUnfollowed: 0, totalFollowed: 0 } },
                globalAssistants,
                administratorUser,
            }
        }

        ////////////////NEW USER

        case 'Set initial data for new user': {
            const {
                user,
                projects,
                projectsMap,
                projectUsers,
                projectContacts,
                projectWorkstreams,
                projectAssistants,
            } = action

            const projectsMeetings = {}
            const projectInvitations = {}
            const projectChatNotifications = {}

            let projectIdsForSetChatNotifications = []
            projects.forEach(project => {
                projectsMeetings[project.id] = []
                projectInvitations[project.id] = []
                projectIdsForSetChatNotifications.push(project.id)
            })

            const newUserNeedToJoinToProject = checkIfNeedToJointToProject(state.initialUrl)

            const loggedUser = updateInactiveProjectsData(
                user,
                state.activeGuideId,
                state.activeTemplateId,
                state.areArchivedActive
            )

            projectIdsForSetChatNotifications = uniq([
                ...projectIdsForSetChatNotifications,
                ...loggedUser.realProjectIds,
            ])
            projectIdsForSetChatNotifications.forEach(projectId => {
                projectChatNotifications[projectId] = { totalUnfollowed: 0, totalFollowed: 0 }
            })

            const newState = {
                ...state,
                loggedUser,
                currentUser: user,
                selectedTypeOfProject: PROJECT_TYPE_ACTIVE,
                loggedUserProjects: projects,
                loggedUserProjectsMap: projectsMap,
                projectUsers,
                projectWorkstreams,
                projectContacts,
                projectAssistants,
                projectsMeetings,
                projectInvitations,
                projectChatNotifications,
                loggedIn: true,
            }
            if (newUserNeedToJoinToProject) {
                newState.newUserNeedToJoinToProject = true
                newState.selectedProjectIndex = 0
            } else {
                newState.initialUrl = '/projects/tasks/open'
                newState.selectedProjectIndex = ALL_PROJECTS_INDEX
                newState.taskViewToggleIndex = 0
                newState.selectedSidebarTab = DV_TAB_ROOT_TASKS
                newState.taskViewToggleSection = 'Open'
            }

            // Set default assistant from the default project
            newState.defaultAssistant = getDefaultAssistant(newState)

            return newState
        }

        case 'Set end data for new user': {
            return { ...state, processedInitialURL: true, registeredNewUser: false }
        }

        ////////////////LOGGED USER

        case 'Init log in for logged user': {
            const { loggedUser } = action
            return {
                ...state,
                loggedUser: updateInactiveProjectsData(
                    loggedUser,
                    state.activeGuideId,
                    state.activeTemplateId,
                    state.areArchivedActive
                ),
                loggedIn: true,
            }
        }

        case 'Set projects initial data': {
            const {
                projectsArray,
                projectsMap,
                projectUsers,
                projectWorkstreams,
                projectContacts,
                projectAssistants,
            } = action

            const projectsMeetings = {}
            const projectInvitations = {}
            const projectChatNotifications = {}

            let projectIdsForSetChatNotifications = []
            projectsArray.forEach(project => {
                projectsMeetings[project.id] = []
                projectInvitations[project.id] = []
                projectIdsForSetChatNotifications.push(project.id)
            })

            projectIdsForSetChatNotifications = uniq([
                ...projectIdsForSetChatNotifications,
                ...state.loggedUser.realProjectIds,
            ])
            projectIdsForSetChatNotifications.forEach(projectId => {
                projectChatNotifications[projectId] = { totalUnfollowed: 0, totalFollowed: 0 }
            })

            const newState = {
                ...state,
                loggedUserProjects: projectsArray,
                loggedUserProjectsMap: projectsMap,
                projectUsers,
                projectWorkstreams,
                projectContacts,
                projectAssistants,
                projectsMeetings,
                projectInvitations,
                projectChatNotifications,
                processedInitialURL: true,
            }

            // Set default assistant from the default project
            newState.defaultAssistant = getDefaultAssistant(newState)

            return newState
        }

        ////////////////SHARED

        case 'Set shared data': {
            const { project, users, workstreams, contacts, assistants } = action
            project.index = state.loggedUserProjects.length

            return {
                ...state,
                selectedTypeOfProject: PROJECT_TYPE_SHARED,
                selectedProjectIndex: project.index,
                loggedUserProjects: [...state.loggedUserProjects, project],
                loggedUserProjectsMap: { ...state.loggedUserProjectsMap, [project.id]: project },
                projectUsers: { ...state.projectUsers, [project.id]: users },
                projectWorkstreams: { ...state.projectWorkstreams, [project.id]: workstreams },
                projectContacts: { ...state.projectContacts, [project.id]: contacts },
                projectAssistants: { ...state.projectAssistants, [project.id]: assistants },
                projectsMeetings: { ...state.projectsMeetings, [project.id]: [] },
                projectInvitations: { ...state.projectInvitations, [project.id]: [] },
                projectChatNotifications: {
                    ...state.projectChatNotifications,
                    [project.id]: { totalUnfollowed: 0, totalFollowed: 0 },
                },
            }
        }

        case 'Set administrator and global assistants': {
            // Update state first so getDefaultAssistant can access it
            const newState = {
                ...state,
                globalAssistants: action.globalAssistants,
                administratorUser: action.administratorUser,
            }
            const defaultAssistant = getDefaultAssistant(newState)
            return {
                ...newState,
                defaultAssistant,
            }
        }

        //NEW PROJECT ADDED

        case 'Set project initial data': {
            const { project, users, workstreams, contacts, assistants } = action
            project.index = state.loggedUserProjects.length

            const newState = {
                ...state,
                loggedUserProjects: [...state.loggedUserProjects, project],
                loggedUserProjectsMap: { ...state.loggedUserProjectsMap, [project.id]: project },
                projectUsers: { ...state.projectUsers, [project.id]: users },
                projectWorkstreams: { ...state.projectWorkstreams, [project.id]: workstreams },
                projectContacts: { ...state.projectContacts, [project.id]: contacts },
                projectAssistants: { ...state.projectAssistants, [project.id]: assistants },
                projectsMeetings: { ...state.projectsMeetings, [project.id]: [] },
                projectInvitations: { ...state.projectInvitations, [project.id]: [] },
                projectChatNotifications: {
                    ...state.projectChatNotifications,
                    [project.id]: { totalUnfollowed: 0, totalFollowed: 0 },
                },
            }

            // Update default assistant if this is the default project
            const isDefaultProject = project.id === state.loggedUser?.defaultProjectId
            if (isDefaultProject) {
                newState.defaultAssistant = getDefaultAssistant(newState)
            }

            return newState
        }

        case 'Remove shared projects data': {
            const { projectIds } = action

            const loggedUserProjects = state.loggedUserProjects.filter(project => !projectIds.includes(project.id))
            const loggedUserProjectsMap = { ...state.loggedUserProjectsMap }
            const projectUsers = { ...state.projectUsers }
            const projectWorkstreams = { ...state.projectWorkstreams }
            const projectContacts = { ...state.projectContacts }
            const projectAssistants = { ...state.projectAssistants }
            const projectsMeetings = { ...state.projectsMeetings }
            const projectInvitations = { ...state.projectInvitations }
            const projectChatNotifications = { ...state.projectChatNotifications }
            const projectChatLastNotification = { ...state.projectChatLastNotification }

            projectIds.forEach(projectId => {
                delete loggedUserProjectsMap[projectId]
                delete projectUsers[projectId]
                delete projectWorkstreams[projectId]
                delete projectContacts[projectId]
                delete projectAssistants[projectId]
                delete projectsMeetings[projectId]
                delete projectInvitations[projectId]
                delete projectChatNotifications[projectId]
                delete projectChatLastNotification[projectId]
            })

            const selectedProjectIndex = loggedUserProjects.findIndex(
                project => project.index === state.selectedProjectIndex
            )

            loggedUserProjects.forEach((project, index) => {
                loggedUserProjects[index] = { ...project, index }
                loggedUserProjectsMap[project.id] = loggedUserProjects[index]
            })

            return {
                ...state,
                loggedUserProjects,
                loggedUserProjectsMap,
                projectUsers,
                projectWorkstreams,
                projectContacts,
                projectAssistants,
                projectsMeetings,
                projectInvitations,
                projectChatNotifications,
                projectChatLastNotification,
                selectedProjectIndex,
            }
        }

        case 'Remove project data': {
            const { projectId } = action

            const loggedUserProjects = state.loggedUserProjects.filter(project => project.id !== projectId)
            const loggedUserProjectsMap = { ...state.loggedUserProjectsMap }
            const projectUsers = { ...state.projectUsers }
            const projectWorkstreams = { ...state.projectWorkstreams }
            const projectContacts = { ...state.projectContacts }
            const projectAssistants = { ...state.projectAssistants }
            const projectsMeetings = { ...state.projectsMeetings }
            const projectInvitations = { ...state.projectInvitations }
            const projectChatNotifications = { ...state.projectChatNotifications }
            const projectChatLastNotification = { ...state.projectChatLastNotification }

            delete loggedUserProjectsMap[projectId]
            delete projectUsers[projectId]
            delete projectWorkstreams[projectId]
            delete projectContacts[projectId]
            delete projectAssistants[projectId]
            delete projectsMeetings[projectId]
            delete projectInvitations[projectId]
            delete projectChatNotifications[projectId]
            delete projectChatLastNotification[projectId]

            const selectedProjectIndex = loggedUserProjects.findIndex(
                project => project.index === state.selectedProjectIndex
            )

            loggedUserProjects.forEach((project, index) => {
                loggedUserProjects[index] = { ...project, index }
                loggedUserProjectsMap[project.id] = loggedUserProjects[index]
            })

            const selectedProjectWasRemoved =
                checkIfSelectedAllProjects(selectedProjectIndex) && checkIfSelectedProject(state.selectedProjectIndex)

            if (selectedProjectWasRemoved) {
                return {
                    ...state,
                    loggedUserProjects,
                    loggedUserProjectsMap,
                    projectUsers,
                    projectWorkstreams,
                    projectContacts,
                    projectAssistants,
                    projectsMeetings,
                    projectInvitations,
                    projectChatNotifications,
                    projectChatLastNotification,
                    selectedProjectIndex,
                    currentUser: state.loggedUser,
                    selectedSidebarTab: DV_TAB_ROOT_TASKS,
                    taskViewToggleIndex: 0,
                    taskViewToggleSection: 'Open',
                    selectedTypeOfProject: PROJECT_TYPE_ACTIVE,
                    showFloatPopup: 0,
                    shownFloatPopup: false,
                }
            } else {
                return {
                    ...state,
                    loggedUserProjects,
                    loggedUserProjectsMap,
                    projectUsers,
                    projectWorkstreams,
                    projectContacts,
                    projectAssistants,
                    projectsMeetings,
                    projectInvitations,
                    projectChatNotifications,
                    projectChatLastNotification,
                    selectedProjectIndex,
                }
            }
        }

        case 'Navigate to new project': {
            const { project, users, workstreams, contacts, assistants } = action

            project.index = state.loggedUserProjects.length

            return {
                ...state,
                loggedUserProjects: [...state.loggedUserProjects, project],
                loggedUserProjectsMap: { ...state.loggedUserProjectsMap, [project.id]: project },
                projectUsers: { ...state.projectUsers, [project.id]: users },
                projectWorkstreams: { ...state.projectWorkstreams, [project.id]: workstreams },
                projectContacts: { ...state.projectContacts, [project.id]: contacts },
                projectAssistants: { ...state.projectAssistants, [project.id]: assistants },
                projectsMeetings: { ...state.projectsMeetings, [project.id]: [] },
                projectInvitations: { ...state.projectInvitations, [project.id]: [] },
                projectChatNotifications: {
                    ...state.projectChatNotifications,
                    [project.id]: { totalUnfollowed: 0, totalFollowed: 0 },
                },
                currentUser: state.loggedUser,
                selectedTypeOfProject: PROJECT_TYPE_ACTIVE,
                selectedProjectIndex: project.index,
                selectedSidebarTab: DV_TAB_ROOT_TASKS,
                taskViewToggleSection: 'Open',
                taskViewToggleIndex: 0,
            }
        }

        case 'Navigate to all projects tasks': {
            const { options } = action
            return {
                ...state,
                currentUser: state.loggedUser,
                selectedTypeOfProject: PROJECT_TYPE_ACTIVE,
                selectedProjectIndex: ALL_PROJECTS_INDEX,
                shortcutSelectedProjectIndex: null,
                selectedSidebarTab: DV_TAB_ROOT_TASKS,
                taskViewToggleSection: options.taskViewToggleSection || 'Open',
                taskViewToggleIndex: options.taskViewToggleIndex || TOGGLE_INDEX_OPEN,
            }
        }

        case 'Navigate to all projects contacts': {
            const { options } = action
            return {
                ...state,
                currentUser: state.loggedUser,
                selectedTypeOfProject: PROJECT_TYPE_ACTIVE,
                selectedProjectIndex: ALL_PROJECTS_INDEX,
                shortcutSelectedProjectIndex: null,
                selectedSidebarTab: DV_TAB_ROOT_CONTACTS,
                contactsActiveTab: options.contactsActiveTab || FOLLOWED_TAB,
            }
        }

        case 'Navigate to all projects chats': {
            const { options } = action
            return {
                ...state,
                currentUser: state.loggedUser,
                selectedTypeOfProject: PROJECT_TYPE_ACTIVE,
                selectedProjectIndex: ALL_PROJECTS_INDEX,
                shortcutSelectedProjectIndex: null,
                selectedSidebarTab: DV_TAB_ROOT_CHATS,
                chatsActiveTab: options.chatsActiveTab || FOLLOWED_TAB,
            }
        }

        case 'Navigate to all projects notes': {
            const { options } = action
            return {
                ...state,
                currentUser: state.loggedUser,
                selectedTypeOfProject: PROJECT_TYPE_ACTIVE,
                selectedProjectIndex: ALL_PROJECTS_INDEX,
                shortcutSelectedProjectIndex: null,
                selectedSidebarTab: DV_TAB_ROOT_NOTES,
                notesActiveTab: options.notesActiveTab || FOLLOWED_TAB,
            }
        }

        case 'Navigate to goals': {
            const { options } = action
            return {
                ...state,
                currentUser: state.loggedUser,
                selectedTypeOfProject: options.selectedTypeOfProject || PROJECT_TYPE_ACTIVE,
                selectedProjectIndex:
                    options.selectedProjectIndex === undefined || options.selectedProjectIndex === null
                        ? ALL_PROJECTS_INDEX
                        : options.selectedProjectIndex,
                shortcutSelectedProjectIndex: options.shortcutSelectedProjectIndex || null,
                selectedSidebarTab: DV_TAB_ROOT_GOALS,
                taskViewToggleIndex: options.taskViewToggleIndex || GOALS_OPEN_TAB_INDEX,
                backlinkSection: options.backlinkSection || { index: 0, section: 'Notes' },
                route: DV_TAB_ROOT_GOALS,
            }
        }

        case 'Navigate to goal': {
            const { options } = action

            const projectType = ProjectHelper.getTypeOfProject(
                state.loggedUser,
                state.loggedUserProjects[options.selectedProjectIndex].id
            )

            return {
                ...state,
                currentUser: state.loggedUser,
                selectedTypeOfProject: projectType,
                selectedProjectIndex: options.selectedProjectIndex,
                shortcutSelectedProjectIndex: options.shortcutSelectedProjectIndex || null,
                selectedNavItem: options.selectedNavItem || DV_TAB_GOAL_PROPERTIES,
                taskViewToggleIndex: options.taskViewToggleIndex || 0,
                selectedSidebarTab: DV_TAB_ROOT_GOALS,
                route: 'GoalDetailedView',
            }
        }

        case 'Navigate to updates': {
            const { options } = action
            return {
                ...state,
                currentUser: state.loggedUser,
                selectedTypeOfProject: options.selectedTypeOfProject || PROJECT_TYPE_ACTIVE,
                selectedProjectIndex:
                    options.selectedProjectIndex === undefined || options.selectedProjectIndex === null
                        ? ALL_PROJECTS_INDEX
                        : options.selectedProjectIndex,
                shortcutSelectedProjectIndex: options.shortcutSelectedProjectIndex || null,
                selectedSidebarTab: DV_TAB_ROOT_UPDATES,
                feedActiveTab: options.feedActiveTab || FOLLOWED_TAB,
                route: DV_TAB_ROOT_UPDATES,
            }
        }

        case 'Navigate to settigns': {
            const { options } = action
            return {
                ...state,
                currentUser: state.loggedUser,
                selectedTypeOfProject: PROJECT_TYPE_ACTIVE,
                selectedProjectIndex: ALL_PROJECTS_INDEX,
                shortcutSelectedProjectIndex: null,
                selectedNavItem: options.selectedNavItem || DV_TAB_SETTINGS_PROFILE,
                projectTypeSectionIndex: options.projectTypeSectionIndex || 0,
                route: 'SettingsView',
            }
        }

        case 'Navigate to admin': {
            const { options } = action
            return {
                ...state,
                currentUser: state.loggedUser,
                selectedTypeOfProject: PROJECT_TYPE_ACTIVE,
                selectedProjectIndex: ALL_PROJECTS_INDEX,
                shortcutSelectedProjectIndex: null,
                selectedNavItem: options.selectedNavItem || DV_TAB_ADMIN_PANEL_USER,
                route: 'AdminPanelView',
            }
        }

        case 'Set my day all today tasks': {
            const { projectId, tasksType, workstreamId, tasks, subtasksMap } = action

            let myDayAllTodayTasks = addProjectDataToMyDayData(
                projectId,
                tasksType,
                workstreamId,
                tasks,
                subtasksMap,
                state.myDayAllTodayTasks
            )

            const {
                myDaySelectedTasks,
                myDayOtherTasks,
                myDayOpenSubtasksMap,
                myDaySortingSubtasksMap,
                myDaySortingSelectedTasks,
                myDaySortingOtherTasks,
            } = processMyDayData(
                state.loggedUser,
                state.loggedUserProjectsMap,
                myDayAllTodayTasks,
                state.administratorUser.uid,
                state.projectUsers
            )

            if (!myDayAllTodayTasks.loaded)
                myDayAllTodayTasks = updateDataLoadedState(
                    myDayAllTodayTasks,
                    state.loggedUser,
                    state.loggedUserProjectsMap
                )

            if (myDayAllTodayTasks.loaded) {
                resetActiveTaskDatesIfTaskChanges(
                    state.loggedUser.activeTaskId,
                    myDaySelectedTasks[0],
                    state.loggedUser.uid
                )
            }

            const myDayShowAllTasks =
                (state.activeDragTaskModeInMyDay ? myDaySortingOtherTasks.length : myDayOtherTasks.length) === 0
                    ? false
                    : state.myDayShowAllTasks

            return {
                ...state,
                myDayAllTodayTasks,
                myDaySelectedTasks,
                myDayOtherTasks,
                myDayOpenSubtasksMap,
                myDayShowAllTasks,
                myDaySortingSubtasksMap,
                myDaySortingSelectedTasks,
                myDaySortingOtherTasks,
            }
        }

        case 'Clear my day all today tasks in workstream': {
            const { projectId, workstreamId } = action

            const myDayAllTodayTasks = { ...state.myDayAllTodayTasks }
            if (myDayAllTodayTasks[projectId]?.[WORKSTREAM_TASKS_MY_DAY_TYPE][workstreamId]) {
                delete myDayAllTodayTasks[projectId][WORKSTREAM_TASKS_MY_DAY_TYPE][workstreamId]
            }

            const {
                myDaySelectedTasks,
                myDayOtherTasks,
                myDayOpenSubtasksMap,
                myDaySortingSubtasksMap,
                myDaySortingSelectedTasks,
                myDaySortingOtherTasks,
            } = processMyDayData(
                state.loggedUser,
                state.loggedUserProjectsMap,
                myDayAllTodayTasks,
                state.administratorUser.uid,
                state.projectUsers
            )

            if (myDayAllTodayTasks.loaded) {
                resetActiveTaskDatesIfTaskChanges(
                    state.loggedUser.activeTaskId,
                    myDaySelectedTasks[0],
                    state.loggedUser.uid
                )
            }

            const myDayShowAllTasks =
                (state.activeDragTaskModeInMyDay ? myDaySortingOtherTasks.length : myDayOtherTasks.length) === 0
                    ? false
                    : state.myDayShowAllTasks

            return {
                ...state,
                myDayAllTodayTasks,
                myDaySelectedTasks,
                myDayOtherTasks,
                myDayOpenSubtasksMap,
                myDayShowAllTasks,
                myDaySortingSubtasksMap,
                myDaySortingSelectedTasks,
                myDaySortingOtherTasks,
            }
        }

        case 'Clear my day all today tasks in project': {
            const { projectId } = action

            const myDayAllTodayTasks = { ...state.myDayAllTodayTasks }
            if (myDayAllTodayTasks[projectId]) delete myDayAllTodayTasks[projectId]

            const {
                myDaySelectedTasks,
                myDayOtherTasks,
                myDayOpenSubtasksMap,
                myDaySortingSubtasksMap,
                myDaySortingSelectedTasks,
                myDaySortingOtherTasks,
            } = processMyDayData(
                state.loggedUser,
                state.loggedUserProjectsMap,
                myDayAllTodayTasks,
                state.administratorUser.uid,
                state.projectUsers
            )

            if (myDayAllTodayTasks.loaded) {
                resetActiveTaskDatesIfTaskChanges(
                    state.loggedUser.activeTaskId,
                    myDaySelectedTasks[0],
                    state.loggedUser.uid
                )
            }

            const myDayShowAllTasks =
                (state.activeDragTaskModeInMyDay ? myDaySortingOtherTasks.length : myDayOtherTasks.length) === 0
                    ? false
                    : state.myDayShowAllTasks

            return {
                ...state,
                myDayAllTodayTasks,
                myDaySelectedTasks,
                myDayOtherTasks,
                myDayOpenSubtasksMap,
                myDayShowAllTasks,
                myDaySortingSubtasksMap,
                myDaySortingSelectedTasks,
                myDaySortingOtherTasks,
            }
        }

        case 'Clear my day all today tasks': {
            return {
                ...state,
                myDayAllTodayTasks: {},
                myDaySelectedTasks: [],
                myDayOtherTasks: [],
                myDayOpenSubtasksMap: {},
                myDaySortingSubtasksMap: {},
                myDaySortingSelectedTasks: [],
                myDaySortingOtherTasks: [],
                myDayShowAllTasks: false,
            }
        }

        case 'Toogle my day show all tasks': {
            return {
                ...state,
                myDayShowAllTasks: !state.myDayShowAllTasks,
            }
        }

        case 'Set my day subtasks in task': {
            const { subtasks, projectId, taskId } = action

            const myDaySortingSubtasksMap = { ...state.myDaySortingSubtasksMap }
            subtasks.forEach(subtask => {
                myDaySortingSubtasksMap[subtask.id] = subtask
            })

            const myDayOpenSubtasksMap = { ...state.myDayOpenSubtasksMap }
            if (!myDayOpenSubtasksMap[projectId]) myDayOpenSubtasksMap[projectId] = {}
            myDayOpenSubtasksMap[projectId] = { ...myDayOpenSubtasksMap[projectId], [taskId]: subtasks }

            return {
                ...state,
                myDayOpenSubtasksMap,
                myDaySortingSubtasksMap,
            }
        }

        case 'Set my day selected and other tasks': {
            const myDayShowAllTasks =
                (state.activeDragTaskModeInMyDay
                    ? action.otherTasksForSortingMode.length
                    : action.otherTasks.length) === 0
                    ? false
                    : state.myDayShowAllTasks
            return {
                ...state,
                myDaySelectedTasks: action.selectedTasks,
                myDayOtherTasks: action.otherTasks,
                myDaySortingSelectedTasks: action.selectedTasksForSortingMode,
                myDaySortingOtherTasks: action.otherTasksForSortingMode,
                myDayShowAllTasks,
            }
        }

        case 'Set my day workflow tasks': {
            const { projectId, tasks, subtasksMap } = action
            const { loggedUser, loggedUserProjects, loggedUserProjectsMap } = state

            let myDayWorkflowTasksByProject = { ...state.myDayWorkflowTasksByProject, [projectId]: tasks }
            const myDayWorkflowSubtasksMap = { ...state.myDayWorkflowSubtasksMap, [projectId]: subtasksMap }

            const myDayWorkflowTasks = generateMyDayWorkflowTasks(
                myDayWorkflowTasksByProject,
                loggedUserProjects,
                loggedUser
            )

            if (!myDayWorkflowTasksByProject.loaded)
                myDayWorkflowTasksByProject = updateMyDayWorkflowDataLoadedState(
                    myDayWorkflowTasksByProject,
                    loggedUser,
                    loggedUserProjectsMap
                )

            return {
                ...state,
                myDayWorkflowTasksByProject,
                myDayWorkflowTasks,
                myDayWorkflowSubtasksMap,
            }
        }

        case 'Clear my day workflow tasks in project': {
            const { projectId } = action
            const { loggedUser, loggedUserProjects } = state

            const myDayWorkflowTasksByProject = { ...state.myDayWorkflowTasksByProject }
            const myDayWorkflowSubtasksMap = { ...state.myDayWorkflowSubtasksMap }

            delete myDayWorkflowTasksByProject[projectId]
            delete myDayWorkflowSubtasksMap[projectId]

            const myDayWorkflowTasks = generateMyDayWorkflowTasks(
                myDayWorkflowTasksByProject,
                loggedUserProjects,
                loggedUser
            )

            return {
                ...state,
                myDayWorkflowTasksByProject,
                myDayWorkflowTasks,
                myDayWorkflowSubtasksMap,
            }
        }

        case 'Clear my day all workflow tasks': {
            return {
                ...state,
                myDayWorkflowTasksByProject: {},
                myDayWorkflowTasks: [],
                myDayWorkflowSubtasksMap: {},
            }
        }

        case 'Set my day done tasks': {
            const { projectId, tasks, subtasksMap } = action
            const { loggedUser, loggedUserProjects, loggedUserProjectsMap } = state

            let myDayDoneTasksByProject = { ...state.myDayDoneTasksByProject, [projectId]: tasks }
            const myDayDoneSubtasksMap = { ...state.myDayDoneSubtasksMap, [projectId]: subtasksMap }

            const myDayDoneTasks = generateMyDayDoneTasks(myDayDoneTasksByProject, loggedUserProjects, loggedUser)

            if (!myDayDoneTasksByProject.loaded)
                myDayDoneTasksByProject = updateMyDayDoneDataLoadedState(
                    myDayDoneTasksByProject,
                    loggedUser,
                    loggedUserProjectsMap
                )

            return {
                ...state,
                myDayDoneTasksByProject,
                myDayDoneTasks,
                myDayDoneSubtasksMap,
            }
        }

        case 'Clear my day done tasks in project': {
            const { projectId } = action
            const { loggedUser, loggedUserProjects } = state

            const myDayDoneTasksByProject = { ...state.myDayDoneTasksByProject }
            const myDayDoneSubtasksMap = { ...state.myDayDoneSubtasksMap }

            delete myDayDoneTasksByProject[projectId]
            delete myDayDoneSubtasksMap[projectId]

            const myDayDoneTasks = generateMyDayDoneTasks(myDayDoneTasksByProject, loggedUserProjects, loggedUser)

            return {
                ...state,
                myDayDoneTasksByProject,
                myDayDoneTasks,
                myDayDoneSubtasksMap,
            }
        }

        case 'Clear my day all done tasks': {
            return {
                ...state,
                myDayDoneTasksByProject: {},
                myDayDoneTasks: [],
                myDayDoneSubtasksMap: {},
            }
        }

        case 'Set task in focus': {
            return {
                ...state,
                taskInFocus: action.taskInFocus,
            }
        }

        case 'Set projects sortIndex': {
            const projectsMap = action.projectsMap

            const loggedUserProjects = [...state.loggedUserProjects]
            const loggedUserProjectsMap = { ...state.loggedUserProjectsMap }

            loggedUserProjects.forEach((project, index) => {
                if (projectsMap[project.id]) {
                    loggedUserProjects[index] = projectsMap[project.id]
                    loggedUserProjectsMap[project.id] = projectsMap[project.id]
                }
            })

            return {
                ...state,
                loggedUserProjects,
                loggedUserProjectsMap,
            }
        }

        case 'Set active drag project mode type': {
            const { activeDragProjectModeType } = action
            return { ...state, activeDragProjectModeType }
        }

        case 'Set active drag task mode in my day': {
            const { activeDragTaskModeInMyDay } = action

            const myDayShowAllTasks =
                (activeDragTaskModeInMyDay ? state.myDaySortingOtherTasks.length : state.myDayOtherTasks.length) === 0
                    ? false
                    : state.myDayShowAllTasks

            return { ...state, activeDragTaskModeInMyDay, myDayShowAllTasks }
        }

        case 'Set last task added id': {
            const { lastTaskAddedId } = action
            return { ...state, lastTaskAddedId }
        }

        case 'Set open tasks show more data in project': {
            const { projectId, tasksType, workstreamId, inSomeday, hasTasks } = action

            const openTasksShowMoreData = addProjectDataToOpenTasksShowMoreData(
                projectId,
                tasksType,
                workstreamId,
                state.openTasksShowMoreData,
                inSomeday,
                hasTasks
            )
            return { ...state, openTasksShowMoreData }
        }

        case 'Clear open tasks show more data in workstream': {
            const { projectId, workstreamId } = action

            const openTasksShowMoreData = cloneDeep(state.openTasksShowMoreData)
            if (openTasksShowMoreData[projectId]?.[WORKSTREAM_TASKS_MY_DAY_TYPE][workstreamId]) {
                delete openTasksShowMoreData[projectId][WORKSTREAM_TASKS_MY_DAY_TYPE][workstreamId]
            }

            return { ...state, openTasksShowMoreData }
        }

        case 'Clear open tasks show more data in project': {
            const { projectId } = action

            const openTasksShowMoreData = { ...state.openTasksShowMoreData }
            if (openTasksShowMoreData[projectId]) delete openTasksShowMoreData[projectId]

            return { ...state, openTasksShowMoreData }
        }

        case 'Clear all open tasks show more data': {
            return { ...state, openTasksShowMoreData: {} }
        }

        case 'Set show all projects by time': {
            const loggedUser = { ...state.loggedUser, showAllProjectsByTime: action.showAllProjectsByTime }
            return { ...state, loggedUser }
        }

        case 'SET_NAVIGATION_SOURCE':
            return { ...state, navigationSource: action.payload }
        case 'RESET_NAVIGATION_SOURCE':
            return { ...state, navigationSource: null }

        case 'Show task completion animation':
            return {
                ...state,
                showTaskCompletionAnimation: true,
            }

        case 'Hide task completion animation':
            return {
                ...state,
                showTaskCompletionAnimation: false,
            }

        default:
            return state
    }
}

const theStore = createStore(theReducer, reduxBatch)

export default theStore
