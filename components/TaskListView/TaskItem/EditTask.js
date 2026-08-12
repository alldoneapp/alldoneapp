import React, { useState, useRef, useEffect } from 'react'
import { Dimensions, Keyboard, StyleSheet, View } from 'react-native'
import { cloneDeep } from 'lodash'
import moment from 'moment'
import { useSelector, useDispatch } from 'react-redux'

import store from '../../../redux/store'
import { colors } from '../../styles/global'
import {
    hideFloatPopup,
    resetFloatPopup,
    setActiveEditMode,
    setFocusedTaskItem,
    setLastAddNewTaskDate,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setTmpInputTextTask,
    setUploadedNewSubtask,
    showConfirmPopup,
    showFloatPopup,
    unsetActiveEditMode,
    unsetAddTaskRepeatMode,
    updateTaskSuggestedCommentModalData,
} from '../../../redux/actions'
import NavigationService from '../../../utils/NavigationService'
import { CONFIRM_POPUP_TRIGGER_DELETE_TASK } from '../../UIComponents/ConfirmPopup'
import EditAssigneeWrapper from '../../UIControls/EditAssigneeWrapper/EditAssigneeWrapper'
import TasksHelper, {
    BACKLOG_DATE_NUMERIC,
    OPEN_STEP,
    TASK_ASSIGNEE_ASSISTANT_TYPE,
} from '../../TaskListView/Utils/TasksHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { dismissAllPopups } from '../../../utils/HelperFunctions'
import useRevealEditorOnOpen from '../../../hooks/useRevealEditorOnOpen'
import { getLinkedParentUrl } from '../../../utils/LinkingHelper'
import SharedHelper from '../../../utils/SharedHelper'
import { FEED_PUBLIC_FOR_ALL } from '../../Feeds/Utils/FeedsConstants'
import { DV_TAB_ROOT_TASKS, DV_TAB_TASK_PROPERTIES } from '../../../utils/TabNavigationConstants'

import { setLinkedParentObjects } from '../../../utils/backends/firestore'
import { TODAY_DATE } from '../../../utils/backends/openTasks'
import { ALL_GOALS_ID } from '../../AllSections/allSectionHelper'
import {
    createFollowUpTask,
    setTaskProjectWithGoal,
    updateTask,
    updateFocusedTask,
    uploadNewSubTask,
} from '../../../utils/backends/Tasks/tasksFirestore'
import { createTaskWithService } from '../../../utils/backends/Tasks/TaskServiceFrontendHelper'
import { updateNoteTitleWithoutFeed } from '../../../utils/backends/Notes/notesFirestore'
import { updateChatTitleWithoutFeeds } from '../../../utils/backends/Chats/chatsFirestore'
import MainButtonsArea from './MainButtonsArea'
import SecondaryButtonsArea from './SecondaryButtonsArea'
import TaskInputArea from './TaskInputArea'
import CheckboxAndIcon from './CheckboxAndIcon'
import { taskEditorLayout } from './TaskEditorLayout'
import useSingleFlightSubmit, { RELEASE_AFTER_SUBMISSION } from '../../../hooks/useSingleFlightSubmit'
import { mergeBackgroundTaskUpdates } from './mergeBackgroundTaskUpdates'

const generateNewTask = (useLoggedUser, inBacklog, activeGoal, parentTask, defaultDate) => {
    const task = TasksHelper.getNewDefaultTask(useLoggedUser)

    task.dueDate = inBacklog ? Number.MAX_SAFE_INTEGER : defaultDate

    if (activeGoal) {
        task.parentGoalId = activeGoal.id
        task.parentGoalIsPublicFor = activeGoal.isPublicFor
        task.lockKey = activeGoal.lockKey
    }

    if (parentTask) {
        task.parentId = parentTask.id
        task.isSubtask = true
        task.userId = parentTask.userId
        task.userIds = parentTask.userIds
        task.stepHistory = parentTask.stepHistory
        task.currentReviewerId = parentTask.currentReviewerId
        task.dueDate = parentTask.dueDate
        task.parentGoalId = parentTask.parentGoalId
        task.parentGoalIsPublicFor = parentTask.parentGoalIsPublicFor
        task.lockKey = parentTask.lockKey
        task.recurrence = parentTask.recurrence
    }

    return task
}

export default function EditTask({
    adding,
    task,
    isSubtask,
    parentTask,
    activeGoal,
    defaultDate,
    useLoggedUser,
    inBacklog,
    projectId,
    isObservedTask,
    isToReviewTask,
    originalParentGoal,
    expandTasksList,
    tryExpandTasksListInGoalWhenAddTask,
    dateFormated,
    onCancelAction,
    linkedParentObject,
    editModeCheckOff,
    isPending,
    parentInTaskOutOfOpen,
    createSubtask,
}) {
    const dispatch = useDispatch()
    let currentUserId = useSelector(state => state.currentUser.uid)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const addTaskRepeatMode = useSelector(state => state.addTaskRepeatMode)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const addTaskSectionToOpenData = useSelector(state => state.addTaskSectionToOpenData)

    const [accessGranted, setAccessGranted] = useState(false)
    const [linkedParents, setLinkedParents] = useState({
        linkedParentNotesUrl: [],
        linkedParentTasksUrl: [],
        linkedParentContactsUrl: [],
        linkedParentProjectsUrl: [],
        linkedParentGoalsUrl: [],
        linkedParentSkillsUrl: [],
        linkedParentAssistantsUrl: [],
    })
    const [linkedObjects, setLinkedObjects] = useState({
        initialLinkedTasksUrl: [],
        initialLinkedNotesUrl: [],
        initialLinkedContactsUrl: [],
        initialLinkedProjectsUrl: [],
        initialLinkedGoalsUrl: [],
        initialLinkedSkillsUrl: [],
        initialLinkedAssistantsUrl: [],
    })
    const [mentionsModalActive, setMentionsModalActive] = useState(false)
    const [width, setWidth] = useState(Dimensions.get('window').width)
    const [tmpTask, setTmpTask] = useState(() =>
        adding ? generateNewTask(useLoggedUser, inBacklog, activeGoal, parentTask, defaultDate) : cloneDeep(task)
    )
    const [newTaskInFocus, setNewTaskInFocus] = useState(false)

    // The task exactly as it was when this editor opened. `tmpTask` starts as a copy of it and only
    // ever diverges through the user's own actions, so the two together say precisely which fields
    // this editing session owns - which is what lets a save keep the background updates that landed
    // meanwhile instead of reverting them. See mergeBackgroundTaskUpdates.js (AT-2267).
    const openedTaskRef = useRef(undefined)
    if (openedTaskRef.current === undefined) openedTaskRef.current = adding || !task ? null : cloneDeep(task)

    const inputTask = useRef(null)
    // Opening a task line replaces a one-line row with a much taller editor, so
    // one opened near the bottom edge would otherwise hang off the screen. See
    // useRevealEditorOnOpen (AT-2220).
    const editorContainerRef = useRef(null)
    useRevealEditorOnOpen(editorContainerRef)

    if (currentUserId === ALL_GOALS_ID) currentUserId = loggedUserId
    const isSuggestedTask = loggedUserId !== currentUserId

    const showArrowInAnonymous = !isAnonymous || (!isSubtask && tmpTask.subtaskIds.length > 0)

    const loggedUserIsTaskOwner = loggedUserId === tmpTask.userId
    const loggedUserCanUpdateObject =
        loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const isSubtaskInGuide = isSubtask && !!ProjectHelper.getProjectById(projectId)?.parentTemplateId

    const isAssistant = tmpTask.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

    const setEstimationBeforeSave = estimation => {
        let finalTask

        if (isPending) {
            const estimations = { ...tmpTask.estimations, [OPEN_STEP]: estimation }
            finalTask = { ...tmpTask, estimations }
        } else if (isObservedTask && !isToReviewTask) {
            const { estimationsByObserverIds } = tmpTask
            finalTask = {
                ...tmpTask,
                estimationsByObserverIds: { ...estimationsByObserverIds, [currentUserId]: estimation },
            }
        } else {
            const { stepHistory } = tmpTask
            const stepId = stepHistory ? stepHistory[stepHistory.length - 1] : OPEN_STEP
            const estimations = { ...tmpTask.estimations, [stepId]: estimation }

            finalTask = { ...tmpTask, estimations }
        }

        adding ? createTask(finalTask, false, false) : editTask(finalTask, true, false, null, '')
    }

    const setFollowUpBeforeSave = (dateText, date, inBacklog) => {
        const data = { dateText, date, inBacklog }
        editTask({ ...tmpTask }, true, false, data, '')
    }

    const setParentGoalBeforeSave = (goal, goalProjectId) => {
        // Use the goal's projectId if the second argument wasn't passed
        const effectiveGoalProjectId = goalProjectId || goal?.projectId

        // Check if the goal is from a different project
        if (goal && effectiveGoalProjectId && effectiveGoalProjectId !== projectId) {
            // Move the task to the goal's project and assign the goal
            const currentProject = ProjectHelper.getProjectById(projectId)
            const newProject = ProjectHelper.getProjectById(effectiveGoalProjectId)
            if (currentProject && newProject) {
                // For existing tasks, use setTaskProjectWithGoal
                // For adding tasks, we need to create in the new project
                if (adding) {
                    const goalData = {
                        parentGoalId: goal.id,
                        parentGoalIsPublicFor: goal.isPublicFor,
                        lockKey: goal.lockKey,
                    }
                    const finalTask = { ...tmpTask, ...goalData }
                    // Note: Creating task in different project requires changing projectId context
                    // For now, just create with goal data - the task will be in current project with new goal
                    createTask(finalTask, false, false)
                } else {
                    setTaskProjectWithGoal(currentProject, newProject, tmpTask, goal)
                    dismissEditMode(true)
                }
            }
        } else {
            // Same project or no goal, just update the parent goal
            const goalData = goal
                ? { parentGoalId: goal.id, parentGoalIsPublicFor: goal.isPublicFor, lockKey: goal.lockKey }
                : { parentGoalId: null, parentGoalIsPublicFor: null, lockKey: '' }

            const finalTask = { ...tmpTask, ...goalData }
            adding ? createTask(finalTask, false, false) : editTask(finalTask, true, false, null, '')
        }
    }

    const setDescriptionBeforeSave = description => {
        const cleanDescription = description.trim().replace(/\r?\n|\r/g, '')
        const finalTask = { ...tmpTask, description: cleanDescription }
        adding ? createTask(finalTask, false, false) : editTask(finalTask, true, false, null, '')
    }

    const setDueDateBeforeSave = (dueDate, updateObservedDueDate) => {
        const moveObservedDateAndDueDate = isObservedTask && isToReviewTask

        if (moveObservedDateAndDueDate) {
            const dueDateByObserversIds = { ...tmpTask.dueDateByObserversIds, [currentUserId]: dueDate }
            const finalTask = { ...tmpTask, dueDateByObserversIds, dueDate }
            editTask(finalTask, true, false, null, '')
        } else {
            if (updateObservedDueDate) {
                const dueDateByObserversIds = { ...tmpTask.dueDateByObserversIds, [currentUserId]: dueDate }
                const finalTask = { ...tmpTask, dueDateByObserversIds }
                editTask(finalTask, true, false, null, '')
            } else {
                const finalTask = { ...tmpTask, dueDate }
                adding ? createTask(finalTask, false, false) : editTask(finalTask, true, false, null, '')
            }
        }
    }

    const setToBacklogBeforeSave = updateObservedBacklog => {
        const moveObservedDateAndDueDate = isObservedTask && isToReviewTask

        if (moveObservedDateAndDueDate) {
            const dueDateByObserversIds = { ...tmpTask.dueDateByObserversIds, [currentUserId]: BACKLOG_DATE_NUMERIC }
            const finalTask = { ...tmpTask, dueDateByObserversIds, dueDate: BACKLOG_DATE_NUMERIC }
            editTask(finalTask, true, false, null, '')
        } else {
            if (updateObservedBacklog) {
                const dueDateByObserversIds = {
                    ...tmpTask.dueDateByObserversIds,
                    [currentUserId]: BACKLOG_DATE_NUMERIC,
                }
                const finalTask = { ...tmpTask, dueDateByObserversIds }
                editTask(finalTask, true, false, null)
            } else {
                const finalTask = { ...tmpTask, dueDate: BACKLOG_DATE_NUMERIC }
                adding ? createTask(finalTask, false, false) : editTask(finalTask, true, false, null, '')
            }
        }
    }

    const setPrivacyBeforeSave = (isPrivate, isPublicFor) => {
        const finalTask = { ...tmpTask, isPublicFor, isPrivate }
        adding ? createTask(finalTask, false, false) : editTask(finalTask, true, false, null, '')
    }

    const setHighlightBeforeSave = color => {
        const finalTask = { ...tmpTask, hasStar: color }
        adding ? createTask(finalTask, false, false) : editTask(finalTask, true, false, null, '')
    }

    const setRecurrenceBeforeSave = recurrence => {
        const finalTask = { ...tmpTask, recurrence }
        adding ? createTask(finalTask, false, false) : editTask(finalTask, true, false, null, '')
    }

    const setPriorityBeforeSave = priority => {
        const finalTask = { ...tmpTask, priority }
        editTask(finalTask, true, false, null, '')
    }

    const setTempAutoEstimation = autoEstimation => {
        setTmpTask(tmpTask => {
            return { ...tmpTask, autoEstimation }
        })
    }

    const setCommentBeforeSave = comment => {
        editTask({ ...tmpTask }, true, false, null, comment.trim())
    }

    const setAssigneeBeforeSave = (user, observers, assigneeComment) => {
        const observersIds = observers.map(user => user.uid)

        const isPrivateForNewAssignee = adding
            ? false
            : !task.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) && !task.isPublicFor.includes(user.uid)

        const updatedTmpTask = {
            ...tmpTask,
            userId: user.uid,
            observersIds,
            isPublicFor: isPrivateForNewAssignee ? [...task.isPublicFor, user.uid] : tmpTask.isPublicFor,
        }

        if (assigneeComment) {
            adding ? createTask(updatedTmpTask, false, true) : editTask(updatedTmpTask, true, true, null, '')
        } else {
            setTmpTask(updatedTmpTask)
            inputTask.current?.focus()
        }
    }

    const onChangeInputText = (
        text,
        linkedParentNotesUrl,
        linkedParentTasksUrl,
        linkedParentContactsUrl,
        linkedParentProjectsUrl,
        linkedParentGoalsUrl,
        linkedParentSkillsUrl,
        linkedParentAssistantsUrl
    ) => {
        const extendedName = text.replace(/\r?\n|\r/g, '')

        setLinkedParents({
            linkedParentNotesUrl,
            linkedParentTasksUrl,
            linkedParentContactsUrl,
            linkedParentProjectsUrl,
            linkedParentGoalsUrl,
            linkedParentSkillsUrl,
            linkedParentAssistantsUrl,
        })

        setTmpTask({ ...tmpTask, extendedName, name: TasksHelper.getTaskNameWithoutMeta(extendedName) })

        if (adding) dispatch(setTmpInputTextTask(text))
    }

    const runCreateTask = (newTask, actionBeforeSave, showSuggested) => {
        newTask.name = newTask.name.trim()
        newTask.extendedName = newTask.extendedName.trim()

        newTask.created = Date.now()
        if (!isSubtask && newTask.dueDate < newTask.created) newTask.dueDate = newTask.created

        if (loggedUserId !== newTask.userId) {
            const user = TasksHelper.getUserInProject(projectId, newTask.userId)
            newTask.suggestedBy = user ? loggedUserId : null
        }

        const assignee = TasksHelper.getTaskOwner(newTask.userId, projectId)

        const { workflow } = assignee
        if (workflow && workflow[projectId]) {
            Object.keys(workflow[projectId]).forEach(stepId => {
                newTask.estimations[stepId] = 0
            })
        }

        const needToPromoteSubtask =
            isSubtask &&
            (parentTask.userId !== newTask.userId ||
                parentTask.dueDate !== newTask.dueDate ||
                parentTask.parentGoalId !== newTask.parentGoalId ||
                parentTask.recurrence !== newTask.recurrence)

        let creation

        if (isSubtask && !needToPromoteSubtask) {
            creation = uploadNewSubTask(projectId, parentTask, newTask, false, true).then(uploadedTask =>
                onSuccessUploadNewTask(uploadedTask, actionBeforeSave, showSuggested)
            )
        } else {
            if (isSubtask) {
                newTask.parentId = null
                newTask.isSubtask = false
            }
            creation = createTaskWithService(
                {
                    projectId,
                    ...newTask,
                },
                {
                    awaitForTaskCreation: true,

                    notGenerateMentionTasks: false,
                }
            ).then(uploadedTask => onSuccessUploadNewTask(uploadedTask, actionBeforeSave, showSuggested))

            if (expandTasksList && newTask.userId === loggedUserId) {
                const endDateDueDate = moment(newTask.dueDate).endOf('day').valueOf()
                const isCreatedInToday =
                    dateFormated === TODAY_DATE && endDateDueDate === moment().endOf('day').valueOf()

                if (isCreatedInToday) {
                    if (selectedProjectIndex < 0 && addTaskRepeatMode) dispatch(unsetAddTaskRepeatMode())
                    expandTasksList()
                }
            }
            if (tryExpandTasksListInGoalWhenAddTask) tryExpandTasksListInGoalWhenAddTask(newTask)
        }

        if (!addTaskRepeatMode) {
            if (isSubtask && parentTask.subtaskIds.length === 0 && tmpTask.userId === currentUserId) {
                dispatch(setUploadedNewSubtask())
            }
            dismissEditMode(true)
        }

        dispatch(setTmpInputTextTask(''))

        // Returned so the single flight guard below knows when this creation is
        // finished and the editor may accept the next one.
        return creation
    }

    // Enter reaches this editor through both a global document listener and
    // Quill's newline callback, and each run mints a new task id, so a double or
    // held Return used to create several tasks. The guard only blocks while a
    // creation is in flight, which keeps the repeat mode ("add task" staying
    // open) able to create consecutive distinct tasks.
    const createTask = useSingleFlightSubmit(runCreateTask, RELEASE_AFTER_SUBMISSION)

    const editTask = (updatedTask, validDirectAction, showSuggested, followUpData, comment) => {
        updatedTask.name = updatedTask.name.trim()
        updatedTask.extendedName = updatedTask.extendedName.trim()

        // The editor now stays open across background updates (AT-2267), so by the time this runs
        // the live task may already carry a goal an assistant assigned, a due date a colleague
        // moved, and so on. `updatedTask` descends from the clone taken when the editor opened and
        // `updateTask` writes the whole document, so saving it verbatim would revert all of it.
        // Send only what this editing session actually changed, on top of the live task.
        updatedTask = mergeBackgroundTaskUpdates(openedTaskRef.current, updatedTask, task)

        if (followUpData) {
            const { inBacklog, date } = followUpData
            const followUpDueDate = inBacklog ? Number.MAX_SAFE_INTEGER : date.valueOf()
            createFollowUpTask(projectId, updatedTask, followUpDueDate, '', 0)
        }

        if (task.userId !== updatedTask.userId && loggedUserId !== updatedTask.userId) {
            const user = TasksHelper.getUserInProject(projectId, updatedTask.userId)
            updatedTask.suggestedBy = user ? loggedUserId : null
        }

        const oldAssignee = TasksHelper.getTaskOwner(task.userId, projectId)

        if (task.userId !== updatedTask.userId) {
            updatedTask.stepHistory = [OPEN_STEP]
            updatedTask.userIds = [updatedTask.userId]
            updatedTask.currentReviewerId = updatedTask.userId
        }

        const taskToUpdate = task.genericData || !accessGranted ? task : updatedTask

        if (updatedTask.extendedName !== task.extendedName) {
            updateChatTitleWithoutFeeds(projectId, updatedTask.id, updatedTask.extendedName)
            if (updatedTask.noteId) {
                updateNoteTitleWithoutFeed(projectId, updatedTask.noteId, TasksHelper.getNoteTitleForTask(updatedTask))
            }
        }

        const mentions = TasksHelper.getMentionUsersFromTitle(projectId, comment)
        updateTask(projectId, taskToUpdate, task, oldAssignee, comment, mentions, isObservedTask).then(() =>
            trySetLinkedObjects(taskToUpdate.id)
        )

        if (validDirectAction) dispatch(hideFloatPopup())

        dismissEditMode(true)

        if (
            (currentUserId !== loggedUserId || loggedUserId !== updatedTask.userId) &&
            updatedTask.userId !== task.userId &&
            showSuggested
        ) {
            setTimeout(() => {
                dispatch(updateTaskSuggestedCommentModalData(true, projectId, updatedTask, updatedTask.extendedName))
            })
        }
    }

    const setTask = (event, actionBeforeSave, validDirectAction, showSuggested) => {
        if (event) event.preventDefault()

        if (hasName) {
            adding
                ? createTask({ ...tmpTask }, actionBeforeSave, showSuggested)
                : editTask({ ...tmpTask }, false, showSuggested, null, '')
        } else if (adding) {
            dismissEditMode()
        } else {
            askToDeleteTask()
        }
    }

    const setInitialLinkedObject = (
        initialLinkedTasksUrl,
        initialLinkedNotesUrl,
        initialLinkedContactsUrl,
        initialLinkedProjectsUrl,
        initialLinkedGoalsUrl,
        initialLinkedSkillsUrl,
        initialLinkedAssistantsUrl
    ) => {
        setLinkedObjects({
            initialLinkedTasksUrl,
            initialLinkedNotesUrl,
            initialLinkedContactsUrl,
            initialLinkedProjectsUrl,
            initialLinkedGoalsUrl,
            initialLinkedSkillsUrl,
            initialLinkedAssistantsUrl,
        })
    }

    const trySetLinkedObjects = taskId => {
        setLinkedParentObjects(projectId, linkedParents, { type: 'task', id: taskId }, linkedObjects)
    }

    const askToDeleteTask = () => {
        Keyboard.dismiss()

        dispatch([
            showFloatPopup(),
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_TASK,
                object: { task, projectId, originalTaskName: task.name },
            }),
        ])
    }

    const onSuccessUploadNewTask = (uploadedTask, actionBeforeSave, showSuggested) => {
        trySetLinkedObjects(uploadedTask.id)

        if (newTaskInFocus) {
            updateFocusedTask(loggedUserId, projectId, uploadedTask, null, null)
        }

        if (actionBeforeSave) {
            NavigationService.navigate('TaskDetailedView', { task: uploadedTask, projectId })
            dispatch(setSelectedNavItem(DV_TAB_TASK_PROPERTIES))
        }

        if (addTaskRepeatMode) {
            setTmpTask(generateNewTask(useLoggedUser, inBacklog, activeGoal, parentTask, defaultDate))
            setNewTaskInFocus(false)
            inputTask.current?.clear()
            inputTask.current?.focus()
        }

        if ((currentUserId !== loggedUserId || loggedUserId !== tmpTask.userId) && showSuggested) {
            setTimeout(() => {
                dispatch(updateTaskSuggestedCommentModalData(true, projectId, uploadedTask, uploadedTask.extendedName))
            })
        }
    }

    const dismissEditMode = forceAction => {
        if (addTaskRepeatMode) dispatch(unsetAddTaskRepeatMode())
        onCancelAction(forceAction)
    }

    const onKeyEnterPressed = event => {
        const { showFloatPopup } = store.getState()

        if (addTaskRepeatMode) {
            event?.preventDefault()
            event?.stopPropagation()
        }

        if (!mentionsModalActive && showFloatPopup === 0) {
            if (hasName) {
                if (isSuggestedTask) event?.preventDefault()
                adding ? createTask({ ...tmpTask }, false, false) : editTask({ ...tmpTask }, false, false, null, '')
            } else if (adding) {
                dismissEditMode()
            } else {
                askToDeleteTask()
            }
        }
    }

    const onDismissPopup = () => {
        inputTask.current?.focus()
    }

    const onOpenDetailedView = () => {
        if (adding) {
            createTask({ ...tmpTask }, true, false)
        } else {
            dismissEditMode()
            if (selectedNavItem.startsWith('TASK_')) {
                dispatch(setSelectedSidebarTab(DV_TAB_ROOT_TASKS))
                NavigationService.navigate('Root')
            }
            NavigationService.navigate('TaskDetailedView', {
                task,
                projectId,
            })
            dispatch(setSelectedNavItem(DV_TAB_TASK_PROPERTIES))
        }
    }

    const getInitialText = () => {
        if (adding) {
            const { tmpInputTextTask } = store.getState()
            return linkedParentObject ? getLinkedParentUrl(projectId, linkedParentObject) : tmpInputTextTask
        } else {
            const mentionRegExp = /@\S*$/
            const parts = tmpTask.extendedName.split(' ')
            const mentionMatch = parts[parts.length - 1].match(mentionRegExp)
            return `${tmpTask.extendedName}${mentionMatch ? '  ' : ' '}`
        }
    }

    const onContainerLayout = event => {
        setWidth(event.nativeEvent.layout.width)
    }

    const hasValidName = () => {
        const cleanedName = tmpTask.extendedName.trim()
        return !!cleanedName
    }

    const onKeyDown = event => {
        const { key } = event
        if (key !== 'Enter') return
        // Holding Return down repeats the keydown event, and an IME commit
        // reports its own Enter. Neither is a second intended submission.
        if (event.repeat || event.isComposing || event.keyCode === 229) return
        onKeyEnterPressed(event)
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    const processAutoFocusOrCloseWhenSelectGoal = addTaskSectionToOpenData => {
        if (adding) {
            const { projectId: projectIdToOpen, goalId, dateFormated: dateFormatedToOpen } = addTaskSectionToOpenData

            if (projectId === projectIdToOpen && dateFormatedToOpen === dateFormated) {
                if (goalId) {
                    if (originalParentGoal && goalId === originalParentGoal.id) {
                        inputTask.current?.focus()
                        return
                    }
                } else {
                    if (!originalParentGoal) {
                        inputTask.current?.focus()
                        return
                    }
                }
            }
        }

        dismissEditMode(true)
    }

    useEffect(() => {
        if (addTaskSectionToOpenData) processAutoFocusOrCloseWhenSelectGoal(addTaskSectionToOpenData)
    }, [addTaskSectionToOpenData])

    useEffect(() => {
        const { loggedUser } = store.getState()
        setAccessGranted(SharedHelper.accessGranted(loggedUser, projectId))
    }, [])

    useEffect(() => {
        if (adding) {
            dispatch(setLastAddNewTaskDate({ projectId, date: defaultDate }))
        } else {
            dispatch(setFocusedTaskItem(tmpTask.id, isObservedTask))
        }
        dispatch([setActiveEditMode(), resetFloatPopup()])
        dismissAllPopups()
        return () => {
            dispatch([unsetActiveEditMode(), setFocusedTaskItem('', false)])
        }
    }, [])

    useEffect(() => {
        if (showGlobalSearchPopup) dismissEditMode()
    }, [showGlobalSearchPopup])

    const hasName = hasValidName()

    return (
        <View
            ref={editorContainerRef}
            onLayout={onContainerLayout}
            style={[
                localStyles.container,
                isSubtask ? localStyles.subtaskContainer : undefined,
                isMiddleScreen ? localStyles.containerUnderBreakpoint : undefined,
                adding && !isSubtask ? taskEditorLayout.inlineEditor : undefined,
            ]}
        >
            <TaskInputArea
                isSubtask={isSubtask}
                tmpTask={tmpTask}
                adding={adding}
                projectId={projectId}
                accessGranted={accessGranted}
                loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                isAssistant={isAssistant}
                inputTask={inputTask}
                onChangeInputText={onChangeInputText}
                setMentionsModalActive={setMentionsModalActive}
                getInitialText={getInitialText}
                setInitialLinkedObject={setInitialLinkedObject}
                onKeyEnterPressed={onKeyEnterPressed}
                newTaskInFocus={newTaskInFocus}
                leftAccessory={
                    <CheckboxAndIcon
                        tmpTask={tmpTask}
                        isSubtask={isSubtask}
                        adding={adding}
                        accessGranted={accessGranted}
                        showArrowInAnonymous={showArrowInAnonymous}
                        loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                        isAssistant={isAssistant}
                        projectId={projectId}
                        editModeCheckOff={editModeCheckOff}
                        dismissEditMode={dismissEditMode}
                    />
                }
                rightAccessory={
                    <EditAssigneeWrapper
                        tmpTask={tmpTask}
                        projectId={projectId}
                        disabled={!hasName || !accessGranted || isSubtaskInGuide}
                        saveAssigneeBeforeSaveTask={setAssigneeBeforeSave}
                        onDismissPopup={onDismissPopup}
                        isAssistant={isAssistant}
                    />
                }
            />
            <View
                style={[
                    taskEditorLayout.actionBar,
                    adding && !isSubtask ? taskEditorLayout.inlineActionBar : undefined,
                ]}
            >
                <SecondaryButtonsArea
                    tmpTask={tmpTask}
                    hasName={hasName}
                    showButtonSpace={width > 915}
                    isSuggestedTask={isSuggestedTask}
                    adding={adding}
                    projectId={projectId}
                    isObservedTask={isObservedTask}
                    isToReviewTask={isToReviewTask}
                    accessGranted={accessGranted}
                    loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                    isAssistant={isAssistant}
                    newTaskInFocus={newTaskInFocus}
                    setNewTaskInFocus={setNewTaskInFocus}
                    dismissEditMode={dismissEditMode}
                    onDismissPopup={() => {
                        setTimeout(() => {
                            Keyboard.dismiss()
                            document.activeElement.blur()
                        }, 1000)
                    }}
                    onOpenDetailedView={onOpenDetailedView}
                    setDueDateBeforeSave={setDueDateBeforeSave}
                    setToBacklogBeforeSave={setToBacklogBeforeSave}
                    setPrivacyBeforeSave={setPrivacyBeforeSave}
                    setCommentBeforeSave={setCommentBeforeSave}
                    setHighlightBeforeSave={setHighlightBeforeSave}
                    setEstimationBeforeSave={setEstimationBeforeSave}
                    setFollowUpBeforeSave={setFollowUpBeforeSave}
                    setDescriptionBeforeSave={setDescriptionBeforeSave}
                    setParentGoalBeforeSave={setParentGoalBeforeSave}
                    setRecurrenceBeforeSave={setRecurrenceBeforeSave}
                    setPriorityBeforeSave={setPriorityBeforeSave}
                    setTempAutoEstimation={setTempAutoEstimation}
                    isPending={isPending}
                    parentInTaskOutOfOpen={parentInTaskOutOfOpen}
                    createSubtask={createSubtask}
                />
                <MainButtonsArea
                    hasName={hasName}
                    isSuggestedTask={isSuggestedTask}
                    adding={adding}
                    accessGranted={accessGranted}
                    width={width}
                    dismissEditMode={dismissEditMode}
                    setTask={setTask}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: colors.Grey200,
        borderRadius: 4,
        boxShadow: '0px 4px 8px rgba(0,0,0,0.08)',
        elevation: 3,
        marginLeft: -16,
        marginRight: -16,
        marginBottom: 16,
    },
    containerUnderBreakpoint: {
        marginLeft: -8,
        marginRight: -8,
    },
    subtaskContainer: {
        backgroundColor: colors.Grey200,
    },
})
