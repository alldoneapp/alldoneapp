import React, { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import moment from 'moment'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import TasksHelper, { OPEN_STEP, objectIsPublicForLoggedUser } from '../../../TaskListView/Utils/TasksHelper'
import store from '../../../../redux/store'
import Backend from '../../../../utils/BackendBridge'
import {
    hideFloatPopup,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTasksArrowButtonIsExpanded,
    showFloatPopup,
    switchProject,
    updateTaskSuggestedCommentModalData,
    hideWebSideBar,
} from '../../../../redux/actions'
import RecurrenceModal from '../RecurrenceModal'
import DueDateModal from '../DueDateModal/DueDateModal'
import {
    FEED_ASSISTANT_OBJECT_TYPE,
    FEED_CHAT_OBJECT_TYPE,
    FEED_CONTACT_OBJECT_TYPE,
    FEED_GOAL_OBJECT_TYPE,
    FEED_NOTE_OBJECT_TYPE,
    FEED_OBJECT_NOTE_OBJECT_TYPE,
    FEED_PROJECT_OBJECT_TYPE,
    FEED_SKILL_OBJECT_TYPE,
    FEED_TASK_OBJECT_TYPE,
    FEED_USER_OBJECT_TYPE,
} from '../../../Feeds/Utils/FeedsConstants'
import ProjectHelper, { checkIfSelectedProject } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import PrivacyModal from '../PrivacyModal/PrivacyModal'
import AssigneeAndObserversModal from '../AssigneeAndObserversModal/AssigneeAndObserversModal'
import {
    DV_TAB_CHAT_BOARD,
    DV_TAB_CONTACT_CHAT,
    DV_TAB_GOAL_CHAT,
    DV_TAB_NOTE_CHAT,
    DV_TAB_TASK_CHAT,
    DV_TAB_USER_CHAT,
    DV_TAB_SKILL_CHAT,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ASSISTANT_CHAT,
} from '../../../../utils/TabNavigationConstants'
import {
    DATE_TASK_INDEX,
    EMPTY_SECTION_INDEX,
    MAIN_TASK_INDEX,
    NOT_PARENT_GOAL_INDEX,
    TODAY_DATE,
} from '../../../../utils/backends/openTasks'
import MainModal from './MainModal'
import useCreateTaskPopupWidth from './createTaskPopupWidth'
import TaskParentGoalModal from '../TaskParentGoalModal/TaskParentGoalModal'
import TaskMoreOptionModal from '../TaskMoreOptionsModal/TaskMoreOptionModal'
import { isWorkstream, WORKSTREAM_ID_PREFIX } from '../../../Workstreams/WorkstreamHelper'
import { getDvTabLink } from '../../../../utils/LinkingHelper'
import { createTaskWithService } from '../../../../utils/backends/Tasks/TaskServiceFrontendHelper'
import SelectProjectModalInSearch from '../SelectProjectModal/SelectProjectModalInSearch'
import { AUTOMATIC_PROJECT_OPTION, isAutomaticProjectOption } from '../SelectProjectModal/projectPickerConstants'
import { buildPendingProjectRouting, resolveAutomaticHostProjectId } from '../../../../utils/automaticProjectRouting'
import {
    addProjectDataToMyDayData,
    processMyDayData,
} from '../../../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'
import { TO_ATTEND_TASKS_MY_DAY_TYPE, WORKSTREAM_TASKS_MY_DAY_TYPE } from '../../../../utils/backends/Tasks/myDayTasks'
import useSingleFlightSubmit from '../../../../hooks/useSingleFlightSubmit'

const buildLinkBack = (projectId, sourceType, sourceId, objectNoteType) => {
    const { selectedNavItem } = store.getState()

    const inChatTab =
        selectedNavItem === DV_TAB_TASK_CHAT ||
        selectedNavItem === DV_TAB_CONTACT_CHAT ||
        selectedNavItem === DV_TAB_USER_CHAT ||
        selectedNavItem === DV_TAB_CHAT_BOARD ||
        selectedNavItem === DV_TAB_NOTE_CHAT ||
        selectedNavItem === DV_TAB_SKILL_CHAT ||
        selectedNavItem === DV_TAB_GOAL_CHAT ||
        selectedNavItem === DV_TAB_ASSISTANT_CHAT

    let url = ''
    const tab = inChatTab
        ? 'chat'
        : sourceType === FEED_NOTE_OBJECT_TYPE
          ? 'editor'
          : sourceType === FEED_ASSISTANT_OBJECT_TYPE
            ? 'customizations'
            : 'properties'

    switch (sourceType) {
        case FEED_TASK_OBJECT_TYPE: {
            url = getDvTabLink(projectId, sourceId, 'tasks', tab)
            break
        }
        case FEED_PROJECT_OBJECT_TYPE: {
            url = getDvTabLink(projectId, sourceId, 'projects', 'properties')
            break
        }
        case FEED_CONTACT_OBJECT_TYPE: {
            url = getDvTabLink(projectId, sourceId, 'contacts', tab)
            break
        }
        case FEED_USER_OBJECT_TYPE: {
            url = getDvTabLink(projectId, sourceId, 'users', tab)
            break
        }
        case FEED_NOTE_OBJECT_TYPE: {
            url = getDvTabLink(projectId, sourceId, 'notes', tab)
            break
        }
        case FEED_OBJECT_NOTE_OBJECT_TYPE: {
            url = getDvTabLink(projectId, sourceId, objectNoteType, tab)
            break
        }
        case FEED_GOAL_OBJECT_TYPE: {
            url = getDvTabLink(projectId, sourceId, 'goals', tab)
            break
        }
        case FEED_CHAT_OBJECT_TYPE: {
            url = getDvTabLink(projectId, sourceId, 'chats', tab)
            break
        }
        case FEED_SKILL_OBJECT_TYPE: {
            url = getDvTabLink(projectId, sourceId, 'skills', tab)
            break
        }
        case FEED_ASSISTANT_OBJECT_TYPE: {
            url = getDvTabLink(projectId, sourceId, 'assistants', tab)
            break
        }
    }

    return url
}

const getNewInitialDefaultTask = (
    fromTaskList,
    projectId,
    sourceType,
    sourceId,
    sourceIsPublicFor,
    objectNoteType,
    lockKey,
    useLoggedUser
) => {
    const { loggedUser, currentUser } = store.getState()
    const user = fromTaskList && !useLoggedUser ? currentUser : loggedUser
    const uid = user.uid
    const newTask = TasksHelper.getNewDefaultTask()
    const taskName = fromTaskList
        ? ''
        : `${window.location.origin}${buildLinkBack(projectId, sourceType, sourceId, objectNoteType)} `
    newTask.name = taskName
    newTask.extendedName = taskName
    newTask.userId = uid
    newTask.currentReviewerId = uid
    newTask.userIds = [uid]
    if (sourceType === FEED_GOAL_OBJECT_TYPE && sourceIsPublicFor) {
        newTask.parentGoalId = sourceId
        newTask.parentGoalIsPublicFor = sourceIsPublicFor
        newTask.lockKey = lockKey ? lockKey : ''
    }
    if (loggedUser.uid !== uid && !user.recorderUserId && !uid.startsWith(WORKSTREAM_ID_PREFIX)) {
        newTask.suggestedBy = loggedUser.uid
    }
    return newTask
}

// The real project an "Automatic" task is created in while the server-side
// router decides where it belongs (AT-2306). Read from the store rather than
// from the modal's own `projects` state because that list is only built when the
// project selector is opened, while the host project is needed at mount.
const getAutomaticHostProjectId = () => {
    const { loggedUser, loggedUserProjects } = store.getState()
    const activeProjects = ProjectHelper.getActiveProjects2(loggedUserProjects, loggedUser)
    return resolveAutomaticHostProjectId({ defaultProjectId: loggedUser.defaultProjectId, projects: activeProjects })
}

export default function RichCreateTaskModal({
    initialProjectId,
    initialTask,
    setShowInteractionBar,
    triggerWhenCreateTask,
    sourceId,
    objectNoteType,
    sourceType,
    sourceIsPublicFor,
    lockKey,
    fromTaskList,
    closeModal,
    setPressedShowMoreMainSection,
    modalTitle,
    tryExpandTasksListInGoalWhenAddTask,
    useLoggedUser,
    showProjectSelector,
    expandTaskListIfNeeded,
    // AT-2364: opt in to the wide card (used by the big, centered All Projects
    // "Add task" call to action). Every other entry point keeps its width.
    wide,
}) {
    const dispatch = useDispatch()
    // One measurement shared by the form and the in-place project picker, so
    // the popup never changes width between the two steps.
    const widthStyle = useCreateTaskPopupWidth(wide)
    // "Automatic" is a picker option, not a project: the task still needs a real
    // project to be written to, so the sentinel is split here into the flag that
    // asks the server to route it and the host project it is created in.
    const [automaticProject, setAutomaticProject] = useState(() => isAutomaticProjectOption(initialProjectId))
    const [projectId, setProjectId] = useState(() =>
        isAutomaticProjectOption(initialProjectId) ? getAutomaticHostProjectId() : initialProjectId
    )
    const [activeGoal, setActiveGoal] = useState(null)
    const [showDueDateModal, setShowDueDateModal] = useState(false)
    const [showRecurrenceModal, setShowRecurrenceModal] = useState(false)
    const [showPrivacyModal, setShowPrivacyModal] = useState(false)
    const [showAssigneeModal, setShowAssigneeModal] = useState(false)
    const [showParentGoalModal, setShowParentGoalModal] = useState(false)
    const [showMoreOptionsModal, setShowMoreOptionsModal] = useState(false)
    const [showSelectProjectModal, setShowSelectProjectModal] = useState(false)
    const [selectedProject, setSelectedProject] = useState(null)
    const [projects, setProjects] = useState([])

    // Enter can reach the creation handlers through several independent
    // listeners at once (see TaskEditForm/ButtonsArea/DoneButton and Quill's
    // newline callback), and closing this popup is asynchronous. Route every
    // creation path of this popup instance through one guard so a double
    // Return, a held Return, or a rapid click can only ever create one task.
    const submitOnce = useSingleFlightSubmit(submission => submission())

    const [task, setTask] = useState(
        initialTask
            ? initialTask
            : getNewInitialDefaultTask(
                  fromTaskList,
                  projectId,
                  sourceType,
                  sourceId,
                  sourceIsPublicFor,
                  objectNoteType,
                  lockKey,
                  useLoggedUser
              )
    )

    const showDueDate = () => {
        if (!showDueDateModal) {
            setShowDueDateModal(true)
            dispatch(showFloatPopup())
        }
    }

    const showRecurring = () => {
        if (!showRecurrenceModal) {
            setShowRecurrenceModal(true)
            dispatch(showFloatPopup())
        }
    }

    const showParentGoal = () => {
        if (!showParentGoalModal) {
            setShowParentGoalModal(true)
        }
    }

    const showMoreOptions = () => {
        if (!showMoreOptionsModal) {
            setShowMoreOptionsModal(true)
        }
    }

    const showSelectProject = () => {
        setShowSelectProjectModal(true)
    }

    const showPrivacy = () => {
        if (!showPrivacyModal) {
            setShowPrivacyModal(true)
            dispatch(showFloatPopup())
        }
    }

    const showAssignee = () => {
        if (!showAssigneeModal) {
            setShowAssigneeModal(true)
            store.dispatch(showFloatPopup())
        }
    }

    const saveDescription = description => {
        setTask({ ...task, description })
        setShowMoreOptionsModal(false)
    }

    const saveRecurrence = recurrence => {
        setTask({ ...task, recurrence })
        setShowRecurrenceModal(false)
        dispatch(hideFloatPopup())
    }

    const saveEstimation = value => {
        setTask({ ...task, estimations: { ...task.estimations, [OPEN_STEP]: value } })
        setShowMoreOptionsModal(false)
    }

    const setAutoEstimation = autoEstimation => {
        setTask({ ...task, autoEstimation })
    }

    const saveHighlight = (e, data) => {
        e?.preventDefault()
        e?.stopPropagation()
        setTask({ ...task, hasStar: data.color })
        setShowMoreOptionsModal(false)
    }

    const saveParentGoal = goal => {
        const parentGoalId = goal ? goal.id : null
        const parentGoalIsPublicFor = goal ? goal.isPublicFor : null
        const lockKey = goal && goal.lockKey ? goal.lockKey : ''
        setTask({ ...task, parentGoalId, parentGoalIsPublicFor, lockKey })
        setActiveGoal(goal)
        setShowParentGoalModal(false)
    }

    const savePrivacy = (isPrivate, isPublicFor) => {
        setTask({ ...task, isPrivate, isPublicFor })
        setShowPrivacyModal(false)
        dispatch(hideFloatPopup())
    }

    // DueDateModal invokes saveDueDateBeforeSaveTask as (task, date, isObserved) —
    // reading the first argument as the date stored the whole draft task object
    // under dueDate (found via the Typesense backfill's schema rejections).
    const saveDueDate = (taskFromModal, dueDate) => {
        if (dueDate !== undefined) setTask({ ...task, dueDate })
        setShowDueDateModal(false)
        dispatch(hideFloatPopup())
    }

    const setToBacklog = () => {
        setTask({ ...task, dueDate: Number.MAX_SAFE_INTEGER })
        setShowDueDateModal(false)
        dispatch(hideFloatPopup())
    }

    const saveAssignee = (user, observers) => {
        const { uid } = user
        const { loggedUser } = store.getState()

        const updatedTask = { ...task }
        if (uid) {
            updatedTask.userId = uid
            updatedTask.userIds = [uid]
            updatedTask.currentReviewerId = uid
            updatedTask.observersIds = observers.map(user => user.uid)
            updatedTask.creatorId = uid
        }
        updatedTask.suggestedBy =
            loggedUser.uid !== uid && !user.recorderUserId && !uid.startsWith(WORKSTREAM_ID_PREFIX)
                ? loggedUser.uid
                : null
        setTask(updatedTask)
        setShowAssigneeModal(false)
        dispatch(hideFloatPopup())
    }

    // Spread into the create payload: `{}` for a normally picked project, so a
    // task that was not created with "Automatic" carries no routing field at all
    // and the Cloud Function skips it without a read.
    const automaticProjectRoutingFields = () =>
        automaticProject ? { projectRouting: buildPendingProjectRouting({ hostProjectId: projectId }) } : {}

    const assignAndComment = (user, observers) =>
        submitOnce(() => {
            const { uid } = user
            const { loggedUser } = store.getState()
            closeModal(task)

            const updatedTask = { ...task }
            if (uid) {
                updatedTask.userId = uid
                updatedTask.userIds = [uid]
                updatedTask.currentReviewerId = uid
                updatedTask.observersIds = observers.map(user => user.uid)
                updatedTask.creatorId = uid
                updatedTask.suggestedBy =
                    loggedUser.uid !== uid && !user.recorderUserId && !uid.startsWith(WORKSTREAM_ID_PREFIX)
                        ? loggedUser.uid
                        : null
            }

            setTask(updatedTask)
            setShowAssigneeModal(false)
            dispatch(hideFloatPopup())

            if (expandTaskListIfNeeded) tryExpandTasksList(updatedTask)
            if (tryExpandTasksListInGoalWhenAddTask) tryExpandTasksListInGoalWhenAddTask(updatedTask)
            return createTaskWithService(
                {
                    projectId,
                    ...updatedTask,
                    ...automaticProjectRoutingFields(),
                },
                {
                    awaitForTaskCreation: true,

                    notGenerateMentionTasks: false,
                    notGenerateUpdates: false,
                }
            ).then(task => {
                dispatch(updateTaskSuggestedCommentModalData(true, projectId, task, task.extendedName))
                return task
            })
        })

    const delayClosePopup = () => {
        setTimeout(async () => {
            setShowRecurrenceModal(false)
            setShowPrivacyModal(false)
            setShowDueDateModal(false)
            setShowAssigneeModal(false)
            setShowParentGoalModal(false)
            setShowMoreOptionsModal(false)
            dispatch(hideFloatPopup())
        })
    }

    const createTask = trySetLinkedObjects => {
        // The empty-name check stays outside the guard so that pressing Enter on
        // an empty popup does not consume the single allowed submission.
        if (task.name.trim().length === 0) return

        return submitOnce(() => {
            closeModal(task)
            if (triggerWhenCreateTask) triggerWhenCreateTask()

            setShowInteractionBar && setShowInteractionBar(false)
            if (expandTaskListIfNeeded) tryExpandTasksList(task)
            if (tryExpandTasksListInGoalWhenAddTask) tryExpandTasksListInGoalWhenAddTask(task)

            // Use unified TaskService instead of old uploadNewTask
            return createTaskWithService(
                {
                    projectId,
                    name: task.name,
                    description: task.description || '',
                    userId: task.userId,
                    dueDate: task.dueDate,
                    isPrivate: task.isPrivate,
                    observersIds: task.observersIds || [],
                    estimations: task.estimations,
                    recurrence: task.recurrence,
                    parentId: task.parentId,
                    linkBack: task.linkBack || '',
                    genericData: task.genericData,
                    parentGoalId: task.parentGoalId,
                    // Pass through all other task properties
                    ...task,
                    // Last on purpose: the draft task never carries a routing
                    // stamp, and only the picker's current state decides it.
                    ...automaticProjectRoutingFields(),
                },
                {
                    awaitForTaskCreation: true,

                    notGenerateMentionTasks: false,
                    notGenerateUpdates: false,
                }
            ).then(taskResult => {
                trySetLinkedObjects(taskResult)
                return {
                    ...taskResult,
                    id: taskResult.id,
                }
            })
        })
    }

    const expandTasks = () => {
        const { selectedProjectIndex, currentUser, smallScreenNavigation } = store.getState()

        const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
        if (inSelectedProject) {
            setPressedShowMoreMainSection(true)
        } else {
            const projectIndex = ProjectHelper.getProjectById(projectId)?.index
            const projectType = ProjectHelper.getTypeOfProject(currentUser, projectId)
            const actionsToDispatch = [
                setTasksArrowButtonIsExpanded(true),
                hideFloatPopup(),
                setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                switchProject(projectIndex),
                setSelectedTypeOfProject(projectType),
            ]

            if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())

            dispatch(actionsToDispatch)
        }
    }

    const isCreatedInMainDate = dueDate => {
        const endDateDueDate = moment(dueDate).endOf('day').valueOf()
        return endDateDueDate === moment().endOf('day').valueOf()
    }

    const isNextTaskIsHidden = () => {
        const { loggedUser, filteredOpenTasksStore, currentUser } = store.getState()

        const dateIndex = 0
        const instanceKey = projectId + currentUser.uid

        const projectDateData = filteredOpenTasksStore[instanceKey]?.[dateIndex]

        const emptyGoalsAmount = (projectDateData?.[EMPTY_SECTION_INDEX] || []).length

        let inGoalsItemsAmount = emptyGoalsAmount
        let allItemsAmount = emptyGoalsAmount

        const mainTasksList = projectDateData?.[MAIN_TASK_INDEX] || []
        mainTasksList.forEach(goalTasksData => {
            // Ensure goalTasksData and goalTasksData[1] are valid before accessing length
            const tasksArray = goalTasksData?.[1]
            if (tasksArray && Array.isArray(tasksArray)) {
                if (goalTasksData[0] !== NOT_PARENT_GOAL_INDEX) {
                    inGoalsItemsAmount += tasksArray.length
                }
                allItemsAmount += tasksArray.length
            }
        })

        const isTemplateProject = loggedUser.templateProjectIds.includes(projectId)
        const nextTaskIsHidden = isTemplateProject
            ? loggedUser.numberTodayTasks <= allItemsAmount
            : loggedUser.numberTodayTasks <= inGoalsItemsAmount

        return nextTaskIsHidden
    }

    const tryExpandTasksList = task => {
        const {
            loggedUser,
            currentUser,
            loggedUserProjectsMap,
            selectedProjectIndex,
            myDayAllTodayTasks,
            administratorUser,
            projectUsers,
        } = store.getState()

        const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
        if (!inSelectedProject && loggedUser.showAllProjectsByTime) {
            const isLoggedUserTask = task.userId === loggedUser.uid
            const isWorkstreamTask = isWorkstream(task.userId)
            const isTodayTask = (isLoggedUserTask || isWorkstreamTask) && isCreatedInMainDate(task.dueDate)

            if (isTodayTask) {
                const tasksType = isLoggedUserTask ? TO_ATTEND_TASKS_MY_DAY_TYPE : WORKSTREAM_TASKS_MY_DAY_TYPE

                const tasks = myDayAllTodayTasks?.[projectId]?.[tasksType]?.tasks ?? []
                tasks.push({ ...task, projectId })

                const newMyDayAllTodayTasks = addProjectDataToMyDayData(
                    projectId,
                    tasksType,
                    isWorkstreamTask ? task.userId : '',
                    tasks,
                    {},
                    myDayAllTodayTasks
                )

                const { myDayOtherTasks } = processMyDayData(
                    loggedUser,
                    loggedUserProjectsMap,
                    newMyDayAllTodayTasks,
                    administratorUser.uid,
                    projectUsers
                )

                if (myDayOtherTasks.some(t => t.id === task.id)) {
                    expandTasks()
                }
            }
        } else {
            const inLoggedUserBoard = loggedUser.uid === currentUser.uid
            const isLoggedUserTask = task.userId === loggedUser.uid
            const cannotShowAllTasks = !!loggedUser.numberTodayTasks

            const needToExpand =
                cannotShowAllTasks &&
                inLoggedUserBoard &&
                isLoggedUserTask &&
                isCreatedInMainDate(task.dueDate) &&
                isNextTaskIsHidden()

            if (needToExpand) expandTasks()
        }
    }

    const setActiveGoalData = goal => {
        const isPublic = objectIsPublicForLoggedUser(goal)
        setActiveGoal(isPublic ? goal : null)
    }

    useEffect(() => {
        const { parentGoalId } = task

        if (parentGoalId) {
            const watcherKey = v4()
            Backend.watchGoal(projectId, parentGoalId, watcherKey, setActiveGoalData)
            return () => {
                Backend.unwatch(projectId, watcherKey)
            }
        }
    }, [task.parentGoalId])

    useEffect(() => {
        if (showProjectSelector) {
            const { loggedUser, loggedUserProjectsMap, loggedUserProjects } = store.getState()

            const activeProjects = ProjectHelper.getActiveProjects2(loggedUserProjects, loggedUser)
            const guides = ProjectHelper.getGuideProjects(loggedUserProjects, loggedUser)

            const sortedProjects = [
                ...ProjectHelper.sortProjects(activeProjects, loggedUser.uid),
                ...ProjectHelper.sortProjects(guides, loggedUser.uid),
            ]

            setProjects(sortedProjects)
            setSelectedProject(automaticProject ? { id: AUTOMATIC_PROJECT_OPTION } : loggedUserProjectsMap[projectId])
        }
    }, [showProjectSelector])

    return (
        <CustomScrollView showsVerticalScrollIndicator={false}>
            {showSelectProjectModal ? (
                <SelectProjectModalInSearch
                    projectId={automaticProject ? AUTOMATIC_PROJECT_OPTION : projectId}
                    closePopover={() => {
                        setTimeout(() => {
                            setShowSelectProjectModal(false)
                        })
                    }}
                    projects={projects}
                    setSelectedProjectId={selectedProjectId => {
                        if (isAutomaticProjectOption(selectedProjectId)) {
                            setAutomaticProject(true)
                            setProjectId(getAutomaticHostProjectId())
                            setSelectedProject({ id: AUTOMATIC_PROJECT_OPTION })
                            return
                        }
                        setAutomaticProject(false)
                        setProjectId(selectedProjectId)
                        setSelectedProject(projects.find(project => project.id === selectedProjectId))
                    }}
                    showGuideTab={true}
                    showAutomaticProject={true}
                    positionInPlace={true}
                    widthStyle={widthStyle}
                />
            ) : showDueDateModal ? (
                <DueDateModal
                    task={task}
                    projectId={projectId}
                    closePopover={delayClosePopup}
                    delayClosePopover={delayClosePopup}
                    inEditTask={false}
                    saveDueDateBeforeSaveTask={saveDueDate}
                    setToBacklogBeforeSaveTask={setToBacklog}
                />
            ) : showRecurrenceModal ? (
                <RecurrenceModal
                    task={task}
                    projectId={projectId}
                    saveRecurrenceBeforeSaveTask={saveRecurrence}
                    closePopover={delayClosePopup}
                />
            ) : showPrivacyModal ? (
                <PrivacyModal
                    object={task}
                    objectType={FEED_TASK_OBJECT_TYPE}
                    projectId={projectId}
                    closePopover={delayClosePopup}
                    delayClosePopover={delayClosePopup}
                    savePrivacyBeforeSaveObject={savePrivacy}
                />
            ) : showParentGoalModal ? (
                <TaskParentGoalModal
                    activeGoal={activeGoal}
                    setActiveGoal={saveParentGoal}
                    projectId={projectId}
                    closeModal={delayClosePopup}
                    ownerId={task.userId}
                    fromAddTaskSection={true}
                />
            ) : showMoreOptionsModal ? (
                <TaskMoreOptionModal
                    saveDescription={saveDescription}
                    saveEstimation={saveEstimation}
                    setAutoEstimation={setAutoEstimation}
                    saveHighlight={saveHighlight}
                    task={task}
                    projectId={projectId}
                    closeModal={delayClosePopup}
                />
            ) : showAssigneeModal ? (
                <AssigneeAndObserversModal
                    projectIndex={ProjectHelper.getProjectById(projectId)?.index}
                    object={task}
                    onSaveData={saveAssignee}
                    closePopover={delayClosePopup}
                    delayClosePopover={delayClosePopup}
                    inEditTask
                    updateTask={assignAndComment}
                />
            ) : (
                <MainModal
                    projectId={projectId}
                    closeModal={closeModal}
                    modalTitle={modalTitle}
                    task={task}
                    showAssigneeModal={showAssigneeModal}
                    showDueDate={showDueDate}
                    showRecurring={showRecurring}
                    showParentGoal={showParentGoal}
                    showPrivacy={showPrivacy}
                    showAssignee={showAssignee}
                    showMoreOptions={showMoreOptions}
                    showSelectProject={showSelectProject}
                    createTask={createTask}
                    setTask={setTask}
                    selectedProject={selectedProject}
                    widthStyle={widthStyle}
                />
            )}
        </CustomScrollView>
    )
}
