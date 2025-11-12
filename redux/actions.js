export const LogOut = () => {
    const action = {
        type: 'Log out',
    }
    return action
}

export const updateLoadingStep = (step, message) => {
    const action = {
        type: 'Update loading step',
        step,
        message,
    }
    return action
}

export const setVersion = version => {
    const action = {
        type: 'Set Version',
        version: version,
    }
    return action
}

export const setNewVersion = version => {
    const action = {
        type: 'Set new version',
        version: version,
    }
    return action
}

export const setShowSideBarVersionRefresher = showSideBarVersionRefresher => {
    const action = {
        type: 'Set side bar version refresher button',
        showSideBarVersionRefresher: showSideBarVersionRefresher,
    }
    return action
}

export const setShowOptionalVersionNotification = showOptionalVersionNotification => {
    const action = {
        type: 'Set optional version notification',
        showOptionalVersionNotification,
    }
    return action
}

export const setSelectedNote = selectedNote => {
    const action = {
        type: 'Set selected Note',
        selectedNote,
    }
    return action
}

export const switchProject = index => {
    const action = {
        type: 'Switch project',
        index: index,
    }
    return action
}

export const updateUserProject = project => {
    const action = {
        type: 'Update user project',
        project,
    }
    return action
}

export const storeLoggedUser = loggedUser => {
    const action = {
        type: 'Store logged user',
        loggedUser,
    }
    return action
}

export const storeCurrentUser = currentUser => {
    const action = {
        type: 'Store current user',
        currentUser,
    }
    return action
}

export const setSelectedNavItem = navItem => {
    const action = {
        type: 'Set selected nav item',
        navItem: navItem,
    }
    return action
}

export const setSelectedSidebarTab = tab => {
    const action = {
        type: 'Set selected sidebar tab',
        tab: tab,
    }
    return action
}

export const toggleNavPicker = expanded => {
    const action = {
        type: 'Toggle nav picker',
        expanded: expanded,
    }
    return action
}

export const toggleMiddleScreen = isMiddleScreen => {
    const action = {
        type: 'Toggle middle screen',
        isMiddleScreen: isMiddleScreen,
    }
    return action
}

export const toggleMiddleScreenNoteDV = isMiddleScreenNoteDV => {
    const action = {
        type: 'Toggle middle screen Note DV',
        isMiddleScreenNoteDV: isMiddleScreenNoteDV,
    }
    return action
}

export const toggleSmallScreen = smallScreen => {
    const action = {
        type: 'Toggle small screen',
        smallScreen: smallScreen,
    }
    return action
}

export const toggleSmallScreenNavigation = smallScreenNavigation => {
    const action = {
        type: 'Toggle small screen navigation',
        smallScreenNavigation: smallScreenNavigation,
    }
    return action
}

export const toggleReallySmallScreenNavigation = reallySmallScreenNavigation => {
    const action = {
        type: 'Toggle really small screen navigation',
        reallySmallScreenNavigation: reallySmallScreenNavigation,
    }
    return action
}

export const toggleSmallScreenNavSidebarCollapsed = smallScreenNavSidebarCollapsed => {
    const action = {
        type: 'Toggle small screen navigation sidebar collapsed',
        smallScreenNavSidebarCollapsed: smallScreenNavSidebarCollapsed,
    }
    return action
}

export const showProjectColorPicker = () => {
    const action = {
        type: 'Show project color picker',
    }
    return action
}

export const hideProjectColorPicker = () => {
    const action = {
        type: 'Hide project color picker',
    }
    return action
}

export const setProjectColorPickerLayout = layout => {
    const action = {
        type: 'Set project color picker layout',
        layout: layout,
    }
    return action
}

export const showDueDateCalendar = () => {
    const action = {
        type: 'Show due date calendar',
    }
    return action
}

export const hideDueDateCalendar = () => {
    const action = {
        type: 'Hide due date calendar',
    }
    return action
}

export const setDueDateCalendarLayout = layout => {
    const action = {
        type: 'Set due date calendar layout',
        layout: layout,
    }
    return action
}

export const setCurrentProjectColor = newColor => {
    const action = {
        type: 'Set current project color',
        newColor: newColor,
    }
    return action
}

export const toggleDismissibleActive = dismissibleActive => {
    const action = {
        type: 'Toggle dismissible active',
        dismissibleActive: dismissibleActive,
    }
    return action
}

export const setDismissibleComponent = dismissibleComponent => {
    const action = {
        type: 'Set dismissible component',
        dismissibleComponent: dismissibleComponent,
    }
    return action
}

export const setShortcutFocusTasks = shortcutFocusTasks => {
    const action = {
        type: 'Set shortcut focus tasks',
        shortcutFocusTasks: shortcutFocusTasks,
    }
    return action
}

export const setFocusedTaskItem = (taskId, isObservedTask) => {
    const action = {
        type: 'Set focused task item',
        taskId,
        isObservedTask,
    }
    return action
}

export const setCheckTaskItem = (taskId, isObservedTask) => {
    const action = {
        type: 'Set check task item',
        taskId,
        isObservedTask,
    }
    return action
}

export const showAddProjectOptions = () => {
    const action = {
        type: 'Show add project options',
    }
    return action
}

export const hideAddProjectOptions = () => {
    const action = {
        type: 'Hide add project options',
    }
    return action
}

export const setAddProjectOptionsLayout = layout => {
    const action = {
        type: 'Set add project options layout',
        layout: layout,
    }
    return action
}

export const showInviteUserOptions = () => {
    const action = {
        type: 'Show add user options',
    }
    return action
}

export const hideInviteUserOptions = () => {
    const action = {
        type: 'Hide add user options',
    }
    return action
}

export const setInviteUserOptionsLayout = layout => {
    const action = {
        type: 'Set add user options layout',
        layout: layout,
    }
    return action
}

export const showConfirmPopup = data => {
    const action = {
        type: 'Show confirm popup',
        trigger: data.trigger,
        object: data.object,
    }
    return action
}

export const hideConfirmPopup = () => {
    const action = {
        type: 'Hide confirm popup',
    }
    return action
}

export const setShowNoteMaxLengthModal = showNoteMaxLengthModal => {
    const action = {
        type: 'Set show note max length modal',
        showNoteMaxLengthModal,
    }
    return action
}

export const setShowProjectDontExistInInvitationModal = value => {
    const action = {
        type: 'Set show project dont exist in invitation modal',
        value,
    }
    return action
}

export const showProjectInvitation = () => {
    const action = {
        type: 'Show project invitation popup',
    }
    return action
}

export const hideProjectInvitation = () => {
    const action = {
        type: 'Hide project invitation popup',
    }
    return action
}

export const setProjectInvitationData = data => {
    const action = {
        type: 'Set project invitation data',
        data: data,
    }
    return action
}

export const showSwipeDueDatePopup = () => {
    const action = {
        type: 'Show swipe due date popup',
    }
    return action
}

export const hideSwipeDueDatePopup = () => {
    const action = {
        type: 'Hide swipe due date popup',
    }
    return action
}

export const setSwipeDueDatePopupData = data => {
    const rAction = {
        type: 'Set swipe due date data',
        data: data,
    }
    return rAction
}

export const setQuillTextInputProjectIdsByEditorId = (editorId, projectId) => {
    const action = {
        type: 'Set quill textinput project ids by editor id',
        editorId,
        projectId,
    }
    return action
}

export const showFloatPopup = () => {
    const action = {
        type: 'Show float popup',
    }
    return action
}

export const hideFloatPopup = () => {
    const action = {
        type: 'Hide float popup',
    }
    return action
}

export const resetFloatPopup = () => {
    const action = {
        type: 'Reset float popup',
    }
    return action
}

export const overrideStore = store => {
    const action = {
        type: 'Override store',
        store: store,
    }
    return action
}

export const setShowWebSideBar = () => {
    const action = {
        type: 'Set show web side bar',
    }
    return action
}

export const setWebSideBarLayout = layout => {
    const action = {
        type: 'Set web side bar layout',
        layout: layout,
    }
    return action
}

export const hideWebSideBar = () => {
    const action = {
        type: 'Hide web side bar',
    }
    return action
}

export const setWebBeingResponsive = status => {
    const action = {
        type: 'Set web being responsive',
        webBeingResponsive: status,
    }
    return action
}

export const setInitialUrl = url => {
    const action = {
        type: 'Set initial url',
        url: url,
    }
    return action
}

export const setTaskInDetailView = task => {
    const action = {
        type: 'Set task in detail view',
        task: task,
    }
    return action
}

export const setNavigationRoute = route => {
    const action = {
        type: 'Set navigation route',
        route: route,
    }
    return action
}

export const setAssigneePickerLayout = layout => {
    const action = {
        type: 'Set assignee picker layout',
        layout: layout,
    }
    return action
}

export const showAssigneePicker = () => {
    const action = {
        type: 'Show assignee picker',
    }
    return action
}

export const hideAssigneePicker = () => {
    const action = {
        type: 'Hide assignee picker',
    }
    return action
}

export const setAssignee = assignee => {
    const action = {
        type: 'Set assignee',
        assignee: assignee,
    }
    return action
}

export const setProjectPickerLayout = layout => {
    const action = {
        type: 'Set project picker layout',
        layout: layout,
    }
    return action
}

export const showProjectPicker = () => {
    const action = {
        type: 'Show project picker',
    }
    return action
}

export const hideProjectPicker = () => {
    const action = {
        type: 'Hide project picker',
    }
    return action
}

export const setSubTaskSection = subTaskSection => {
    const action = {
        type: 'Set sub task section',
        subTaskSection: subTaskSection,
    }
    return action
}

export const setUsersInProject = (projectId, users) => {
    const action = {
        type: 'Set users in project',
        projectId,
        users,
    }
    return action
}

export const setContactsInProject = (projectId, contacts) => {
    const action = {
        type: 'Set contacts in project',
        projectId,
        contacts,
    }
    return action
}

export const setMeetingsInProject = (projectId, meetings) => {
    const action = {
        type: 'Set meetings in project',
        projectId,
        meetings,
    }
    return action
}

export const setWorkstreamsInProject = (projectId, workstreams) => {
    const action = {
        type: 'Set workstreams in project',
        projectId,
        workstreams,
    }
    return action
}

export const setAssistantsInProject = (projectId, assistants) => {
    const action = {
        type: 'Set assistants in project',
        projectId,
        assistants,
    }
    return action
}

export const setGlobalAssistants = globalAssistants => {
    const action = {
        type: 'Set global assistants',
        globalAssistants,
    }
    return action
}

export const setSelectedTypeOfProject = selectedTypeOfProject => {
    const action = {
        type: 'Set selected type of project',
        selectedTypeOfProject: selectedTypeOfProject,
    }
    return action
}

export const setInvitationsInProject = (projectId, invitations) => {
    const action = {
        type: 'Set invitations in projects',
        projectId,
        invitations,
    }
    return action
}

export const setChatNotificationsInProject = (projectId, notifications) => {
    const action = {
        type: 'Set chat notifications in projects',
        projectId,
        notifications,
    }
    return action
}

export const setTaskTitleInEditMode = isInEditMode => {
    const action = {
        type: 'Set task title in edit mode',
        isInEditMode: isInEditMode,
    }
    return action
}

export const setTaskViewToggleIndex = taskViewToggleIndex => {
    const action = {
        type: 'Set task view toggle index',
        taskViewToggleIndex: taskViewToggleIndex,
    }
    return action
}

export const setTaskViewToggleSection = taskViewToggleSection => {
    const action = {
        type: 'Set task view toggle section',
        taskViewToggleSection,
    }
    return action
}

export const setWorkflowStep = step => {
    const action = {
        type: 'Set workflow step',
        step: step,
    }
    return action
}

export const setUserWorkflow = workflow => {
    const action = {
        type: 'Set user workflow',
        workflow: workflow,
    }
    return action
}

export const setAmountTasksByProjects = amountTasksByProjects => {
    const action = {
        type: 'Set amount tasks by projects',
        amountTasksByProjects: amountTasksByProjects,
    }
    return action
}

export const activateSearchForm = () => {
    const action = {
        type: 'Activate search form',
    }
    return action
}

export const deactivateSearchForm = () => {
    const action = {
        type: 'Deactivate search form',
    }
    return action
}

export const setSearchText = searchText => {
    const action = {
        type: 'Set search text',
        searchText: searchText,
    }
    return action
}

export const setNewFeedCount = (projectIndex, feedCount) => {
    const action = {
        type: 'Set new feed count',
        projectIndex,
        feedCount,
    }
    return action
}

export const setAllNewFeedCount = allNewFeedCount => {
    const action = {
        type: 'Set all new feed count',
        allNewFeedCount,
    }
    return action
}

export const setAllFeedCount = (projectIndex, projectFeedCount) => {
    const action = {
        type: 'Set all feed count',
        projectIndex,
        projectFeedCount,
    }
    return action
}

export const storeFeedListByProjects = feedListByProjects => {
    const action = {
        type: 'Store feed list by projects',
        feedListByProjects: feedListByProjects,
    }
    return action
}

export const setNewFeedCountPause = newFeedCountPause => {
    const action = {
        type: 'Set new feed count pause',
        newFeedCountPause,
    }
    return action
}

export const setLastVisitedScreen = lastVisitedScreen => {
    const action = {
        type: 'Set last visited screen',
        lastVisitedScreen,
    }
    return action
}

export const setTaskTitleElementsWidths = taskTitleElementsWidths => {
    const action = {
        type: 'Set task title elements widths',
        taskTitleElementsWidths,
    }
    return action
}

export const startLoadingData = processes => {
    const action = {
        type: 'Start loading data',
        processes,
    }
    return action
}

export const stopLoadingData = () => {
    const action = {
        type: 'Stop loading data',
    }
    return action
}

export const resetLoadingData = () => {
    const action = {
        type: 'Reset loading data',
    }
    return action
}

export const setRegisteredNewUser = registeredNewUser => {
    const action = {
        type: 'Set registered new user',
        registeredNewUser,
    }
    return action
}

export const setGlobalSearchResults = results => {
    const action = {
        type: 'Set global search results',
        results,
    }
    return action
}

export const showGlobalSearchPopup = globalSearchPopupOpenUsingShortcuts => {
    const action = { type: 'Show global search popup', globalSearchPopupOpenUsingShortcuts }
    return action
}

export const hideGlobalSearchPopup = () => {
    const action = { type: 'Hide global search popup' }
    return action
}

export const setRealTimeSearchResults = results => {
    const action = {
        type: 'Set real time search results',
        results,
    }
    return action
}

export const setSidebarNumbers = numbers => {
    const action = {
        type: 'Set sidebar numbers',
        numbers,
    }
    return action
}

export const setAddTaskRepeatMode = () => {
    const action = {
        type: 'Set add task repeat mode',
    }
    return action
}

export const unsetAddTaskRepeatMode = () => {
    const action = {
        type: 'Unset add task repeat mode',
    }
    return action
}

export const setActiveEditMode = () => {
    const action = {
        type: 'Set active edit mode',
    }
    return action
}

export const unsetActiveEditMode = () => {
    const action = {
        type: 'Unset active edit mode',
    }
    return action
}

export const updateFeedsCount = feedsCount => {
    const action = {
        type: 'Update feeds count',
        feedsCount,
    }
    return action
}

export const setUploadedNewSubtask = () => {
    const action = {
        type: 'Set uploaded new subtask',
    }
    return action
}

export const unsetUploadedNewSubtask = () => {
    const action = {
        type: 'Unset uploaded new subtask',
    }
    return action
}

export const updateFeedActiveTab = feedActiveTab => {
    const action = {
        type: 'Update feed active tab',
        feedActiveTab: feedActiveTab,
    }
    return action
}

export const updateNotesActiveTab = notesActiveTab => {
    const action = {
        type: 'Update notes active tab',
        notesActiveTab: notesActiveTab,
    }
    return action
}

export const setGoalsActiveTab = goalsActiveTab => {
    const action = {
        type: 'Set goals active tab',
        goalsActiveTab: goalsActiveTab,
    }
    return action
}

export const setChatsActiveTab = chatsActiveTab => {
    const action = {
        type: 'Set chats active tab',
        chatsActiveTab: chatsActiveTab,
    }
    return action
}

export const updateContactsActiveTab = contactsActiveTab => {
    const action = {
        type: 'Update contacts active tab',
        contactsActiveTab: contactsActiveTab,
    }
    return action
}

export const setScreenDimensions = screenDimensions => {
    const action = {
        type: 'Set screen dimensions',
        screenDimensions: screenDimensions,
    }
    return action
}

export const setActiveChatData = (projectId, chatId, chatType) => {
    const action = {
        type: 'Set active chat data',
        activeChatData: { projectId, chatId, chatType },
    }
    return action
}

export const setShowNewDayNotification = show => {
    const action = {
        type: 'Set show new day notification',
        show,
    }
    return action
}

export const showNoteChangedNotification = notification => {
    const action = {
        type: 'Show note changed notification',
        notification,
    }
    return action
}

export const setLastAddNewTaskDate = lastAddNewTaskDate => {
    const action = {
        type: 'Set last add new task date',
        lastAddNewTaskDate: lastAddNewTaskDate,
    }
    return action
}

export const setLastAddNewNoteDate = lastAddNewNoteDate => {
    const action = {
        type: 'Set last add new note date',
        lastAddNewNoteDate: lastAddNewNoteDate,
    }
    return action
}

export const setLastAddNewContact = lastAddNewContact => {
    const action = {
        type: 'Set last add new contact',
        lastAddNewContact: lastAddNewContact,
    }
    return action
}

export const addThereAreLaterOpenTasks = (projectId, thereAreLaterOpenTasks) => {
    const action = {
        type: 'Add there are later open tasks',
        projectId,
        thereAreLaterOpenTasks,
    }
    return action
}

export const removeThereAreLaterOpenTasks = projectId => {
    const action = {
        type: 'Remove there are later open tasks',
        projectId,
    }
    return action
}

export const setUserInfoModalWhenUserJoinsToGuide = showUserInfoModalWhenUserJoinsToGuide => {
    const action = {
        type: 'Set user info modal when user joins to community',
        showUserInfoModalWhenUserJoinsToGuide,
    }
    return action
}

export const addThereAreSomedayOpenTasks = (projectId, thereAreSomedayOpenTasks) => {
    const action = {
        type: 'Add there are someday open tasks',
        projectId,
        thereAreSomedayOpenTasks,
    }
    return action
}

export const removeThereAreSomedayOpenTasks = projectId => {
    const action = {
        type: 'Remove there are someday open tasks',
        projectId,
    }
    return action
}

export const addThereAreLaterEmptyGoals = (projectId, thereAreLaterEmptyGoals) => {
    const action = {
        type: 'Add there are later empty goals',
        projectId,
        thereAreLaterEmptyGoals,
    }
    return action
}

export const removeThereAreLaterEmptyGoals = projectId => {
    const action = {
        type: 'Remove there are later empty goals',
        projectId,
    }
    return action
}

export const addThereAreSomedayEmptyGoals = (projectId, thereAreSomedayEmptyGoals) => {
    const action = {
        type: 'Add there are someday empty goals',
        projectId,
        thereAreSomedayEmptyGoals,
    }
    return action
}

export const removeThereAreSomedayEmptyGoals = projectId => {
    const action = {
        type: 'Remove there are someday empty goals',
        projectId,
    }
    return action
}

export const setShowMoreInMainSection = showMoreInMainSection => {
    const action = {
        type: 'Set show more in main section',
        showMoreInMainSection,
    }
    return action
}

export const setActiveModalInFeed = activeModalInFeed => {
    const action = {
        type: 'Set active modal in feed',
        activeModalInFeed,
    }
    return action
}

export const setActiveDragGoalMode = activeDragGoalMode => {
    const action = {
        type: 'Set active drag goal mode',
        activeDragGoalMode,
    }
    return action
}

export const setActiveDragTaskModeInDate = (projectId, dateIndex) => {
    const action = {
        type: 'Set active drag task mode in date',
        projectId,
        dateIndex,
    }
    return action
}

export const removeActiveDragTaskModeInDate = () => {
    const action = {
        type: 'Remove active drag task mode in date',
    }
    return action
}

export const updateRecordVideoModalData = (visible, projectId) => {
    const action = {
        type: 'Update record video modal data',
        recordVideoModalData: { visible, projectId },
    }
    return action
}

export const updateScreenRecordingModalData = (visible, projectId) => {
    const action = {
        type: 'Update screen recording modal data',
        screenRecordingModalData: { visible, projectId },
    }
    return action
}

export const updateChatGoogleMeetModalData = (visible, projectId, userId, userIds, title) => {
    const action = {
        type: 'Update chat google meet modal data',
        chatGoogleMeetModalData: { visible, projectId, userId, userIds, title },
    }
    return action
}

export const updateGoogleMeetModalData = (visible, projectId, userId) => {
    const action = {
        type: 'Update google meet modal data',
        googleMeetModalData: { visible, projectId, userId },
    }
    return action
}

export const updateGoogleMeetNotificationModalData = (visible, projectId, email, meeting) => {
    const action = {
        type: 'Update google meet notification modal data',
        googleMeetNotificationModalData: { visible, projectId, email, meeting },
    }
    return action
}

export const updateTaskSuggestedCommentModalData = (visible, projectId, task, taskName) => {
    const action = {
        type: 'Update task suggested comment modal data',
        taskSuggestedCommentModalData: { visible, projectId, task, taskName },
    }
    return action
}

export const addTaskIdWithSubtasksExpandedWhenActiveDragTaskMode = taskId => {
    const action = {
        type: 'Add task id with subtasks expanded when active drag task mode',
        taskId,
    }
    return action
}

export const removeTaskIdWithSubtasksExpandedWhenActiveDragTaskMode = taskId => {
    const action = {
        type: 'Remove task id with subtasks expanded when active drag task mode',
        taskId,
    }
    return action
}

export const clearTasksIdsWithSubtasksExpandedWhenActiveDragTaskMode = () => {
    const action = {
        type: 'Clear tasks ids with subtasks expanded when active drag task mode',
    }
    return action
}

export const setNotesAmounts = (amount, projectIndex) => {
    const action = {
        type: 'Set notes amounts',
        projectIndex,
        amount,
    }
    return action
}

export const resetNotesAmounts = () => {
    const action = {
        type: 'Reset notes amounts',
    }
    return action
}

export const setUpdatesAmounts = (amount, projectIndex) => {
    const action = {
        type: 'Set updates amounts',
        projectIndex,
        amount,
    }
    return action
}

export const resetUpdatesAmounts = () => {
    const action = {
        type: 'Reset updates amounts',
    }
    return action
}

// SEE WITH YULIO
export const setPrevScreen = prevScreen => {
    const action = {
        type: 'Set previous screen',
        prevScreen,
    }
    return action
}
//

export const setReloadGlobalFeeds = needReloadGlobalFeeds => {
    const action = {
        type: 'Set reload global feeds',
        needReloadGlobalFeeds,
    }
    return action
}

export const showShortcuts = () => {
    const action = {
        type: 'Show shortcuts',
    }
    return action
}

export const hideShortcuts = () => {
    const action = {
        type: 'Hide shortcuts',
    }
    return action
}

export const showNoteCtrlShortcuts = () => {
    const action = {
        type: 'Show note ctrl shortcuts',
    }
    return action
}

export const hideNoteCtrlShortcuts = () => {
    const action = {
        type: 'Hide note ctrl shortcuts',
    }
    return action
}

export const showNoteAltShortcuts = () => {
    const action = {
        type: 'Show note alt shortcuts',
    }
    return action
}

export const hideNoteAltShortcuts = () => {
    const action = {
        type: 'Hide note alt shortcuts',
    }
    return action
}

export const setFollowedFeeds = (projectId, followedFeeds) => {
    const action = {
        type: 'Set followed feeds',
        projectId,
        followedFeeds,
    }
    return action
}

export const setAllFeeds = (projectId, allFeeds) => {
    const action = {
        type: 'Set all feeds',
        projectId,
        allFeeds,
    }
    return action
}

export const setNewLocalFeedData = (projectId, object, feed, params) => {
    const action = {
        type: 'Set new local feeed data',
        newLocalFeedData: { projectId, object, feed, params },
    }
    return action
}

export const setShowCheatSheet = showCheatSheet => {
    const action = {
        type: 'Set show cheat sheet',
        showCheatSheet,
    }
    return action
}

export const setLoadedNewFeeds = () => {
    const action = {
        type: 'Set loaded new feeds',
    }
    return action
}

export const setInPartnerFeeds = value => {
    const action = {
        type: 'Set in partner feeds',
        inPartnerFeeds: value,
    }
    return action
}

export const setLastSelectedDueDate = lastSelectedDueDate => {
    const action = {
        type: 'Set last selected due date',
        lastSelectedDueDate: lastSelectedDueDate,
    }
    return action
}

export const setProjectNotes = projectNotes => {
    const action = {
        type: 'Set project notes',
        projectNotes,
    }
    return action
}

export const triggerWatchTasks = () => {
    const action = {
        type: 'Trigger watch tasks',
    }
    return action
}

export const setDraggingParentTaskId = draggingParentTaskId => {
    const action = {
        type: 'Set dragging parent task id',
        draggingParentTaskId,
    }
    return action
}

export const setOpenTasksMap = (projectId, openTasksMap) => {
    const action = {
        type: 'Set open tasks map',
        projectId,
        openTasksMap,
    }
    return action
}

export const clearOpenTasksMap = projectId => {
    const action = {
        type: 'Clear open tasks map',
        projectId,
    }
    return action
}

export const setOpenSubtasksMap = (projectId, openSubtasksMap) => {
    const action = {
        type: 'Set open subtasks map',
        projectId,
        openSubtasksMap,
    }
    return action
}

export const clearOpenSubtasksMap = projectId => {
    const action = {
        type: 'Clear open subtasks map',
        projectId,
    }
    return action
}

export const setTaskListWatchersVars = taskListWatchersVars => {
    const action = {
        type: 'Set task list watchers vars',
        taskListWatchersVars,
    }
    return action
}

export const setGlobalDataByProject = globalDataByProject => {
    const action = {
        type: 'Set global data by project',
        globalDataByProject,
    }
    return action
}

export const setSharedMode = () => {
    const action = {
        type: 'Set shared mode',
    }
    return action
}

export const unsetSharedMode = () => {
    const action = {
        type: 'Unset shared mode',
    }
    return action
}

export const setShowAccessDeniedPopup = showAccessDeniedPopup => {
    const action = {
        type: 'Set show access denied popup',
        showAccessDeniedPopup,
    }
    return action
}

export const setShowEndCopyProjectPopup = (visible, name, color) => {
    const action = {
        type: 'Set show end copy project popup',
        endCopyProjectPopupData: { visible, name, color },
    }
    return action
}

export const setQuillEditorProjectId = quillEditorProjectId => {
    const action = {
        type: 'Set quill editor project id',
        quillEditorProjectId,
    }
    return action
}

export const setIsQuillTagEditorOpen = isQuillTagEditorOpen => {
    const action = {
        type: 'Set is quill tag editor open',
        isQuillTagEditorOpen,
    }
    return action
}

export const setInBacklinksView = inBacklinksView => {
    const action = {
        type: 'Set in backlinks view',
        inBacklinksView,
    }
    return action
}

export const setBacklinkSection = backlinkSection => {
    const action = {
        type: 'Set backlink section',
        backlinkSection,
    }
    return action
}

export const setProjectTypeSectionIndex = projectTypeSectionIndex => {
    const action = {
        type: 'Set project type section index',
        projectTypeSectionIndex,
    }
    return action
}

export const setSelectedTasks = (selectedTasks, reset) => {
    const action = {
        type: 'Set Select tasks',
        selectedTasks,
        reset,
    }
    return action
}

export const updateAllSelectedTasks = selectedTasks => {
    const action = {
        type: 'Update all selected tasks',
        selectedTasks,
    }
    return action
}

export const isDragging = isDragging => {
    const action = {
        type: 'Is Dragging',
        isDragging,
    }
    return action
}

export const storeOpenModal = (modalId, params) => {
    const action = {
        type: 'Store open modal',
        modalId,
        params,
    }
    return action
}

export const removeOpenModal = modalId => {
    const action = {
        type: 'Remove open modal',
        modalId,
    }
    return action
}

export const resetOpenModal = () => {
    const action = {
        type: 'Reset open modal',
    }
    return action
}

export const storeInMentionModalStack = modalId => {
    const action = {
        type: 'Store in mention modal stack',
        modalId,
    }
    return action
}

export const removeFromMentionModalStack = modalId => {
    const action = {
        type: 'Remove from mention modal stack',
        modalId,
    }
    return action
}

export const setMentionModalNewFormOpen = mentionModalNewFormOpen => {
    const action = {
        type: 'Set mention modal new form open',
        mentionModalNewFormOpen,
    }
    return action
}

export const blockBackgroundTabShortcut = () => {
    const action = {
        type: 'Block background tab shortcut',
    }
    return action
}

export const unblockBackgroundTabShortcut = () => {
    const action = {
        type: 'Unblock background tab shortcut',
    }
    return action
}

export const switchShortcutProject = projectIndex => {
    const action = {
        type: 'Switch shortcut project',
        projectIndex,
    }
    return action
}

export const storeCurrentShortcutUser = currentUserUid => {
    const action = {
        type: 'Store current shortcut user',
        currentUserUid,
    }
    return action
}

export const setMilestoneInEditionId = milestoneInEditionId => {
    const action = {
        type: 'Set milestone in edition id',
        milestoneInEditionId,
    }
    return action
}

export const setGoalInEditionMilestoneId = goalInEditionMilestoneId => {
    const action = {
        type: 'Set goal in edition milestone id',
        goalInEditionMilestoneId,
    }
    return action
}

export const setGoalSwipeMilestoneModalOpen = goalSwipeMilestoneModalOpen => {
    const action = {
        type: 'Set goal swipe milestone modal open',
        goalSwipeMilestoneModalOpen,
    }
    return action
}

export const setForceCloseGoalEditionId = forceCloseGoalEditionId => {
    const action = {
        type: 'Set force close goal edition id',
        forceCloseGoalEditionId,
    }
    return action
}

export const setForceCloseSkillEditionId = forceCloseSkillEditionId => {
    const action = {
        type: 'Set force close skill edition id',
        forceCloseSkillEditionId,
    }
    return action
}

export const setShowLimitedFeatureModal = showLimitedFeatureModal => {
    const action = {
        type: 'Set show limited feature modal',
        showLimitedFeatureModal,
    }
    return action
}

export const setShowLimitPremiumQuotaModal = showLimitPremiumQuotaModal => {
    const action = {
        type: 'Set show limit premium quota modal',
        showLimitPremiumQuotaModal,
    }
    return action
}

export const setLimitQuotaModalData = (visible, quotaType, projectName, monthlyXp, monthlyTraffic) => {
    const action = {
        type: 'Set limit quota modal data',
        visible,
        quotaType,
        projectName,
        monthlyXp,
        monthlyTraffic,
    }
    return action
}

export const showNewVersionMandtoryNotifcation = () => {
    const action = {
        type: 'Show new version mandtory notifcation',
    }
    return action
}

export const setActiveNoteId = activeNoteId => {
    const action = {
        type: 'Set active note id',
        activeNoteId,
    }
    return action
}

export const setActiveNoteIsReadOnly = activeNoteIsReadOnly => {
    const action = {
        type: 'Set active note is read only',
        activeNoteIsReadOnly,
    }
    return action
}

export const setTopBarWidth = topBarWidth => {
    const action = {
        type: 'Set top bar width',
        topBarWidth,
    }
    return action
}

export const setHashtagsColors = (projectId, text, colorKey) => {
    const action = {
        type: 'Set hashtags colors',
        projectId,
        text,
        colorKey,
    }
    return action
}

export const setVirtualQuillLoaded = virtualQuillLoaded => {
    const action = {
        type: 'Set virtual quill loaded',
        virtualQuillLoaded,
    }
    return action
}

export const setBlockShortcuts = blockShortcuts => {
    const action = {
        type: 'Set block shortcuts',
        blockShortcuts,
    }
    return action
}

export const setIsLoadingNoteData = isLoadingNoteData => {
    const action = {
        type: 'Set is loading note data',
        isLoadingNoteData,
    }
    return action
}

export const setNoteEditorScrollDimensions = (width, height) => {
    const action = {
        type: 'Set note editor scroll dimensions',
        noteEditorScrollDimensions: { width, height },
    }
    return action
}

export const setTmpInputTextTask = text => {
    const action = {
        type: 'Set tmp input text task',
        text,
    }
    return action
}

export const setTmpInputTextGoal = text => {
    const action = {
        type: 'Set tmp input text goal',
        text,
    }
    return action
}

export const setTmpInputTextNote = text => {
    const action = {
        type: 'Set tmp input text note',
        text,
    }
    return action
}

export const setTmpInputTextContact = text => {
    const action = {
        type: 'Set tmp input text contact',
        text,
    }
    return action
}

export const setTodayEmptyGoalsTotalAmountInOpenTasksView = (projectId, amount) => {
    const action = {
        type: 'Set today empty goals total amount in open tasks view',
        projectId,
        amount,
    }
    return action
}

export const setGoalsShowMoreExpanded = goalsShowMoreExpanded => {
    const action = {
        type: 'Set goals show more expanded',
        goalsShowMoreExpanded,
    }
    return action
}

export const clearHashtagFilters = () => {
    const action = { type: 'Clear hashtag filters' }
    return action
}

export const addHashtagFilters = (hashtag, colorKey) => {
    const action = {
        type: 'Add hashtag filters',
        hashtag,
        colorKey,
    }
    return action
}

export const removeHashtagFilters = hashtag => {
    const action = {
        type: 'Remove hashtag filters',
        hashtag,
    }
    return action
}

export const setTriggerGoldAnimation = (goldEarned, checkBoxId) => {
    const action = {
        type: 'Set gold earned',
        goldEarned,
        checkBoxId,
    }
    return action
}

export const hideGoldChain = () => {
    const action = {
        type: 'Hide gold chain',
    }
    return action
}

export const hideGoldCoin = () => {
    const action = {
        type: 'Hide gold coin',
    }
    return action
}

export const setShowNotificationAboutTheBotBehavior = showNotificationAboutTheBotBehavior => {
    const action = {
        type: 'Set show notification about the bot behavior',
        showNotificationAboutTheBotBehavior,
    }
    return action
}

export const setNoteInnerTasks = (noteId, innerTasks) => {
    const action = {
        type: 'Set note inner tasks',
        noteId,
        innerTasks,
    }
    return action
}

export const removeNoteInnerTasks = noteId => {
    const action = {
        type: 'Remove note inner tasks',
        noteId,
    }
    return action
}

export const setLaterTasksExpandedForNavigateFromAllProjects = laterTasksExpandedForNavigateFromAllProjects => {
    const action = {
        type: 'Set later tasks expanded for navigate from all projects',
        laterTasksExpandedForNavigateFromAllProjects,
    }
    return action
}

export const setSomedayTasksExpandedForNavigateFromAllProjects = somedayTasksExpandedForNavigateFromAllProjects => {
    const action = {
        type: 'Set someday tasks expanded for navigate from all projects',
        somedayTasksExpandedForNavigateFromAllProjects,
    }
    return action
}

export const setTasksArrowButtonIsExpanded = tasksArrowButtonIsExpanded => {
    const action = {
        type: 'Tasks arrow button is expanded',
        tasksArrowButtonIsExpanded,
    }
    return action
}

export const setHoverSidebar = hover => {
    const action = {
        type: 'Set hover sidebar',
        hover: hover,
    }
    return action
}

export const setAddProjectStatus = status => {
    const action = {
        type: 'Set add project status',
        status: status,
    }
    return action
}

export const setSidebarInputOpenType = sidebarInputOpenType => {
    const action = {
        type: 'Set sidebar input open type',
        sidebarInputOpenType,
    }
    return action
}

export const setAddContactStatus = status => {
    const action = {
        type: 'Set add contact status',
        status: status,
    }
    return action
}

export const setFollowedFeedsAmount = followedFeedsAmount => {
    const action = {
        type: 'Set followed feeds amount',
        followedFeedsAmount: followedFeedsAmount,
    }
    return action
}

export const setAllFeedsAmount = allFeedsAmount => {
    const action = {
        type: 'Set all feeds amount',
        allFeedsAmount: allFeedsAmount,
    }
    return action
}

export const setFollowedFeedsData = followedFeedsData => {
    const action = {
        type: 'Set followed feeds data',
        followedFeedsData: followedFeedsData,
    }
    return action
}

export const setAllFeedsData = allFeedsData => {
    const action = {
        type: 'Set all feeds data',
        allFeedsData: allFeedsData,
    }
    return action
}

export const setAmountTasksExpanded = amountDoneTasksExpanded => {
    const action = {
        type: 'Set amount done tasks expanded',
        amountDoneTasksExpanded,
    }
    return action
}

export const setLaterTasksExpanded = laterTasksExpanded => {
    const action = {
        type: 'Set later tasks expanded',
        laterTasksExpanded,
    }
    return action
}

export const setSomedayTasksExpanded = somedayTasksExpanded => {
    const action = {
        type: 'Set someday tasks expanded',
        somedayTasksExpanded,
    }
    return action
}

export const setLaterTasksExpandState = laterTasksExpandState => {
    const action = {
        type: 'Set later tasks expand state',
        laterTasksExpandState,
    }
    return action
}

export const setOpenTasksAmount = openTasksAmount => {
    const action = {
        type: 'Set open tasks amount',
        openTasksAmount,
    }
    return action
}

export const setDoneTasksAmount = doneTasksAmount => {
    const action = {
        type: 'Set done tasks amount',
        doneTasksAmount,
    }
    return action
}

export const setEarlierDoneTasksAmount = earlierDoneTasksAmount => {
    const action = {
        type: 'Set earlier done tasks amount',
        earlierDoneTasksAmount,
    }
    return action
}

export const setWorkflowTasksAmount = workflowTasksAmount => {
    const action = {
        type: 'Set workflow tasks amount',
        workflowTasksAmount,
    }
    return action
}

export const updateOpenTasks = (instanceKey, openTasksStore) => {
    const action = {
        type: 'Update open tasks',
        instanceKey,
        openTasksStore,
    }
    return action
}

export const updateThereAreHiddenNotMainTasks = (instanceKey, thereAreHiddenNotMainTasks) => {
    const action = {
        type: 'Update there are hidden not main tasks',
        instanceKey,
        thereAreHiddenNotMainTasks,
    }
    return action
}

export const updateFilteredOpenTasks = (instanceKey, filteredOpenTasksStore) => {
    const action = {
        type: 'Update filtered open tasks',
        instanceKey,
        filteredOpenTasksStore,
    }
    return action
}

export const updateSubtaskByTask = (instanceKey, subtaskByTaskStore) => {
    const action = {
        type: 'Update subtask by task',
        instanceKey,
        subtaskByTaskStore,
    }
    return action
}

export const updateThereAreNotTasksInFirstDay = (instanceKey, thereAreNotTasksInFirstDay) => {
    const action = {
        type: 'Update thre are not tasks in first day',
        instanceKey,
        thereAreNotTasksInFirstDay,
    }
    return action
}

export const updateInitialLoadingEndOpenTasks = (instanceKey, initialLoadingEndOpenTasks) => {
    const action = {
        type: 'Update initial loading end open tasks',
        instanceKey,
        initialLoadingEndOpenTasks,
    }
    return action
}

export const updateInitialLoadingEndObservedTasks = (instanceKey, initialLoadingEndObservedTasks) => {
    const action = {
        type: 'Update initial loading end observed tasks',
        instanceKey,
        initialLoadingEndObservedTasks,
    }
    return action
}

//////////////TASKS SORTING ACTIONS
export const setOpenMilestonesInProjectInTasks = (projectId, milestones) => {
    const action = {
        type: 'Set open milestones in project in tasks',
        projectId,
        milestones,
    }
    return action
}

export const setDoneMilestonesInProjectInTasks = (projectId, milestones) => {
    const action = {
        type: 'Set done milestones in project in tasks',
        projectId,
        milestones,
    }
    return action
}

export const setGoalsInProjectInTasks = (projectId, goals) => {
    const action = {
        type: 'Set goals in project in tasks',
        projectId,
        goals,
    }
    return action
}
//////////////ENDDDDDDDD

export const setSkillsByProject = (projectId, skills) => {
    const action = {
        type: 'Set skills by project',
        projectId,
        skills,
    }
    return action
}

export const setActiveDragSkillModeId = activeDragSkillModeId => {
    const action = {
        type: 'Set active drag skill mode id',
        activeDragSkillModeId,
    }
    return action
}

export const setSkillsDefaultPrivacy = (projectId, skillsDefaultPrivacy) => {
    const action = {
        type: 'Set skills default privacy',
        projectId,
        skillsDefaultPrivacy,
    }
    return action
}

export const setSkillInDv = skillInDv => {
    const action = {
        type: 'Set skill in dv',
        skillInDv,
    }
    return action
}

export const setDvIsFullScreen = dvIsFullScreen => {
    const action = {
        type: 'Set dv is full screen',
        dvIsFullScreen,
    }
    return action
}

export const setQuotedNoteText = quotedNoteText => {
    const action = {
        type: 'Set quoted note text',
        quotedNoteText,
    }
    return action
}

export const setQuotedText = quotedText => {
    const action = {
        type: 'Set quoted text',
        quotedText,
    }
    return action
}

export const setActiveChatMessageId = activeChatMessageId => {
    const action = {
        type: 'Set active chat message id',
        activeChatMessageId,
    }
    return action
}

export const setChatPagesAmount = chatPagesAmount => {
    const action = {
        type: 'Set chat pages amount',
        chatPagesAmount,
    }
    return action
}

export const setOpenMilestonesInProject = (projectId, milestones) => {
    const action = {
        type: 'Set open milestones in project',
        projectId,
        milestones,
    }
    return action
}

export const setDoneMilestonesInProject = (projectId, milestones) => {
    const action = {
        type: 'Set done milestones in project',
        projectId,
        milestones,
    }
    return action
}

export const setGoalsInProject = (projectId, goals) => {
    const action = {
        type: 'Set goals in project',
        projectId,
        goals,
    }
    return action
}

export const setBoardMilestonesInProject = (projectId, milestones) => {
    const action = {
        type: 'Set board milestones in project',
        projectId,
        milestones,
    }
    return action
}

export const setBoardGoalsByMilestoneInProject = (projectId, goalsByMilestone) => {
    const action = {
        type: 'Set board goals by milestone in project',
        projectId,
        goalsByMilestone,
    }
    return action
}

export const setBoardNeedShowMoreInProject = (projectId, needShowMore) => {
    const action = {
        type: 'Set board need show more in project',
        projectId,
        needShowMore,
    }
    return action
}

export const setOpenGoalsAmount = (projectId, amount) => {
    const action = {
        type: 'Set open goals amount',
        projectId,
        amount,
    }
    return action
}

export const setDoneGoalsAmount = (projectId, amount) => {
    const action = {
        type: 'Set done goals amount',
        projectId,
        amount,
    }
    return action
}

export const setAdministratorUser = administratorUser => {
    const action = {
        type: 'Set administrator user',
        administratorUser,
    }
    return action
}

export const setSelectedGoalDataInTasksListWhenAddTask = selectedGoalDataInTasksListWhenAddTask => {
    const action = {
        type: 'Set selected goal data in tasks list when add task',
        selectedGoalDataInTasksListWhenAddTask,
    }
    return action
}

export const setAddTaskSectionToOpenData = addTaskSectionToOpenData => {
    const action = {
        type: 'Set add task section to open data',
        addTaskSectionToOpenData,
    }
    return action
}

export const setAddingUserToGuide = addingUserToGuide => {
    const action = {
        type: 'Set adding user to community',
        addingUserToGuide,
    }
    return action
}

export const setActiveGuideId = activeGuideId => {
    const action = {
        type: 'Set active community id',
        activeGuideId,
    }
    return action
}

export const setActiveTemplateId = activeTemplateId => {
    const action = {
        type: 'Set active template id',
        activeTemplateId,
    }
    return action
}

export const setAreArchivedActive = areArchivedActive => {
    const action = {
        type: 'Set are archived actives',
        areArchivedActive,
    }
    return action
}

export const pressShowLaterTasksInAllProjects = (projectIndex, projectType, projectId, thereAreLaterObjects) => {
    const action = {
        type: 'Press show later tasks in all projects',
        projectIndex,
        projectType,
        projectId,
        thereAreLaterObjects,
    }
    return action
}

export const setNewUserNeedToJoinToProject = newUserNeedToJoinToProject => {
    const action = {
        type: 'Set new user need to join to project',
        newUserNeedToJoinToProject,
    }
    return action
}

export const setAssistantEnabled = assistantEnabled => {
    const action = {
        type: 'Set assistant enabled',
        assistantEnabled,
    }
    return action
}

export const setNotEnabledAssistantWhenLoadComments = notEnabledAssistantWhenLoadComments => {
    const action = {
        type: 'Set not enabled assistant when load comments',
        notEnabledAssistantWhenLoadComments,
    }
    return action
}

export const setTriggerBotSpinner = triggerBotSpinner => {
    const action = {
        type: 'Set trigger bot spinner',
        triggerBotSpinner,
    }
    return action
}

export const setPreConfigTaskExecuting = taskName => {
    const action = {
        type: 'Set pre-config task executing',
        taskName,
    }
    return action
}

export const setDisableAutoFocusInChat = disableAutoFocusInChat => {
    const action = {
        type: 'Set disable auto focus in chat',
        disableAutoFocusInChat,
    }
    return action
}

export const setMainChatEditor = mainChatEditor => {
    const action = {
        type: 'Set main chat editor',
        mainChatEditor,
    }
    return action
}

export const setGoalOpenTasksData = goalOpenTasksData => {
    const action = {
        type: 'Set goal open tasks data',
        goalOpenTasksData,
    }
    return action
}

export const setGoalOpenSubtasksByParent = goalOpenSubtasksByParent => {
    const action = {
        type: 'Set goal open subtasks data',
        goalOpenSubtasksByParent,
    }
    return action
}

export const setGoalWorkflowTasksData = goalWorkflowTasksData => {
    const action = {
        type: 'Set goal workflow tasks data',
        goalWorkflowTasksData,
    }
    return action
}

export const setGoalWorkflowSubtasksByParent = goalWorkflowSubtasksByParent => {
    const action = {
        type: 'Set goal workflow subtasks data',
        goalWorkflowSubtasksByParent,
    }
    return action
}

export const setGoalDoneTasksData = goalDoneTasksData => {
    const action = {
        type: 'Set goal done tasks data',
        goalDoneTasksData,
    }
    return action
}

export const setGoalDoneSubtasksByParent = goalDoneSubtasksByParent => {
    const action = {
        type: 'Set goal done subtasks data',
        goalDoneSubtasksByParent,
    }
    return action
}

export const setGoalOpenTasksExpandState = goalOpenTasksExpandState => {
    const action = {
        type: 'Set goal open tasks expand state',
        goalOpenTasksExpandState,
    }
    return action
}

export const setGoalOpenMainTasksExpanded = goalOpenMainTasksExpanded => {
    const action = {
        type: 'Set goal open main tasks expanded',
        goalOpenMainTasksExpanded,
    }
    return action
}

export const setGoalDoneTasksExpandedAmount = goalDoneTasksExpandedAmount => {
    const action = {
        type: 'Set goal done tasks expanded amount',
        goalDoneTasksExpandedAmount,
    }
    return action
}

////////////////NEW ACTIONS FROM REFACTOR THE LOAD LOGIC

export const initAnonymousSesion = (loggedUser, currentUser) => {
    const action = {
        type: 'Init anonymous sesion',
        loggedUser,
        currentUser,
    }
    return action
}

export const setAnonymousSesionData = (
    project,
    users,
    workstreams,
    contacts,
    assistants,
    globalAssistants,
    administratorUser
) => {
    const action = {
        type: 'Set anonymous sesion data',
        project,
        users,
        workstreams,
        contacts,
        assistants,
        globalAssistants,
        administratorUser,
    }
    return action
}

export const setInitialDataForNewUser = (
    user,
    projects,
    projectsMap,
    projectUsers,
    projectContacts,
    projectWorkstreams,
    projectAssistants
) => {
    const action = {
        type: 'Set initial data for new user',
        user,
        projects,
        projectsMap,
        projectUsers,
        projectContacts,
        projectWorkstreams,
        projectAssistants,
    }
    return action
}

export const setEndDataForNewUser = () => {
    const action = {
        type: 'Set end data for new user',
    }
    return action
}

export const initLogInForLoggedUser = loggedUser => {
    const action = {
        type: 'Init log in for logged user',
        loggedUser,
    }
    return action
}

export const setProjectsInitialData = (
    projectsArray,
    projectsMap,
    projectUsers,
    projectWorkstreams,
    projectContacts,
    projectAssistants
) => {
    const action = {
        type: 'Set projects initial data',
        projectsArray,
        projectsMap,
        projectUsers,
        projectWorkstreams,
        projectContacts,
        projectAssistants,
    }
    return action
}

export const setSharedData = (project, users, workstreams, contacts, assistants) => {
    const action = {
        type: 'Set shared data',
        project,
        users,
        workstreams,
        contacts,
        assistants,
    }
    return action
}

export const setAdministratorAndGlobalAssistants = (administratorUser, globalAssistants) => {
    const action = {
        type: 'Set administrator and global assistants',
        administratorUser,
        globalAssistants,
    }
    return action
}

export const setProjectInitialData = (project, users, workstreams, contacts, assistants) => {
    const action = {
        type: 'Set project initial data',
        project,
        users,
        workstreams,
        contacts,
        assistants,
    }
    return action
}

export const removeSharedProjectsData = projectIds => {
    const action = {
        type: 'Remove shared projects data',
        projectIds,
    }
    return action
}

export const removeProjectData = projectId => {
    const action = {
        type: 'Remove project data',
        projectId,
    }
    return action
}

export const navigateToNewProject = (project, users, workstreams, contacts, assistants) => {
    const action = {
        type: 'Navigate to new project',
        project,
        users,
        workstreams,
        contacts,
        assistants,
    }
    return action
}

export const navigateToAllProjectsTasks = options => {
    const action = {
        type: 'Navigate to all projects tasks',
        options: options || {},
    }
    return action
}

export const navigateToAllProjectsContacts = options => {
    const action = {
        type: 'Navigate to all projects contacts',
        options: options || {},
    }
    return action
}

export const navigateToAllProjectsChats = options => {
    const action = {
        type: 'Navigate to all projects chats',
        options: options || {},
    }
    return action
}

export const navigateToAllProjectsNotes = options => {
    const action = {
        type: 'Navigate to all projects notes',
        options: options || {},
    }
    return action
}

export const navigateToGoals = options => {
    const action = {
        type: 'Navigate to goals',
        options: options || {},
    }
    return action
}

export const navigateToGoal = options => {
    const action = {
        type: 'Navigate to goal',
        options: options || {},
    }
    return action
}

export const navigateToUpdates = options => {
    const action = {
        type: 'Navigate to updates',
        options: options || {},
    }
    return action
}

export const navigateToSettings = options => {
    const action = {
        type: 'Navigate to settigns',
        options: options || {},
    }
    return action
}

export const navigateToAdmin = options => {
    const action = {
        type: 'Navigate to settigns',
        options: options || {},
    }
    return action
}

export const setMyDayAllTodayTasks = (projectId, tasksType, workstreamId, tasks, subtasksMap) => {
    const action = {
        type: 'Set my day all today tasks',
        projectId,
        tasksType,
        workstreamId,
        tasks,
        subtasksMap,
    }
    return action
}

export const clearMyDayAllTodayTasksInWorkstream = (projectId, workstreamId) => {
    const action = {
        type: 'Clear my day all today tasks in workstream',
        projectId,
        workstreamId,
    }
    return action
}

export const clearMyDayAllTodayTasksInProject = projectId => {
    const action = {
        type: 'Clear my day all today tasks in project',
        projectId,
    }
    return action
}

export const clearMyDayAllTodayTasks = () => {
    const action = {
        type: 'Clear my day all today tasks',
    }
    return action
}

export const toggleMyDayShowAllTasks = () => {
    const action = {
        type: 'Toogle my day show all tasks',
    }
    return action
}

export const setMyDaySubtasksInTask = (subtasks, projectId, taskId) => {
    const action = {
        type: 'Set my day subtasks in task',
        subtasks,
        projectId,
        taskId,
    }
    return action
}

export const setMyDaySelectedAndOtherTasks = (
    selectedTasks,
    otherTasks,
    selectedTasksForSortingMode,
    otherTasksForSortingMode
) => {
    const action = {
        type: 'Set my day selected and other tasks',
        selectedTasks,
        otherTasks,
        selectedTasksForSortingMode,
        otherTasksForSortingMode,
    }
    return action
}

export const setMyDayWorkflowTasks = (projectId, tasks, subtasksMap) => {
    const action = {
        type: 'Set my day workflow tasks',
        projectId,
        tasks,
        subtasksMap,
    }
    return action
}

export const clearMyDayWorkflowTasksInProject = projectId => {
    const action = {
        type: 'Clear my day workflow tasks in project',
        projectId,
    }
    return action
}

export const clearMyDayAllWorkflowTtasks = () => {
    const action = {
        type: 'Clear my day all workflow tasks',
    }
    return action
}

export const setMyDayDoneTasks = (projectId, tasks, subtasksMap) => {
    const action = {
        type: 'Set my day done tasks',
        projectId,
        tasks,
        subtasksMap,
    }
    return action
}

export const clearMyDayDoneTasksInProject = projectId => {
    const action = {
        type: 'Clear my day done tasks in project',
        projectId,
    }
    return action
}

export const clearMyDayAllDoneTtasks = () => {
    const action = {
        type: 'Clear my day all done tasks',
    }
    return action
}

export const setTaskInFocus = taskInFocus => {
    const action = {
        type: 'Set task in focus',
        taskInFocus,
    }
    return action
}

export const setProjectsSortIndex = projectsMap => {
    const action = {
        type: 'Set projects sortIndex',
        projectsMap,
    }
    return action
}

export const setActiveDragProjectModeType = activeDragProjectModeType => {
    const action = {
        type: 'Set active drag project mode type',
        activeDragProjectModeType,
    }
    return action
}

export const setActiveDragTaskModeInMyDay = activeDragTaskModeInMyDay => {
    const action = {
        type: 'Set active drag task mode in my day',
        activeDragTaskModeInMyDay,
    }
    return action
}

export const setLastTaskAddedId = lastTaskAddedId => {
    const action = {
        type: 'Set last task added id',
        lastTaskAddedId,
    }
    return action
}

export const setOpenTasksShowMoreDataInProject = (
    projectId,
    tasksType,
    workstreamId,
    inSomeday,
    hasTasks,
    inTomorrow
) => {
    const action = {
        type: 'Set open tasks show more data in project',
        projectId,
        tasksType,
        workstreamId,
        inSomeday,
        inTomorrow,
        hasTasks,
    }
    return action
}

export const clearOpenTasksShowMoreDataInWorkstream = (projectId, workstreamId) => {
    const action = {
        type: 'Clear open tasks show more data in workstream',
        projectId,
        workstreamId,
    }
    return action
}

export const clearOpenTasksShowMoreDataInProject = projectId => {
    const action = {
        type: 'Clear open tasks show more data in project',
        projectId,
    }
    return action
}

export const clearAllOpenTasksShowMoreData = () => {
    const action = {
        type: 'Clear all open tasks show more data',
    }
    return action
}

export const setShowAllProjectsByTime = showAllProjectsByTime => {
    const action = {
        type: 'Set show all projects by time',
        showAllProjectsByTime,
    }
    return action
}

export const showTaskCompletionAnimation = () => {
    const action = {
        type: 'Show task completion animation',
    }
    return action
}

export const hideTaskCompletionAnimation = () => {
    const action = {
        type: 'Hide task completion animation',
    }
    return action
}
