import React, { useState, useEffect } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import TaskEditionMode from './TaskEditionMode'
import TaskPresentationMode from './TaskPresentationMode'
import FollowUpModalWrapper from './FollowUpModalWrapper'
import WorkflowModalWrapper from './WorkflowModalWrapper'
import { chronoEntriesOrder } from '../../../../utils/HelperFunctions'
import TasksHelper, {
    DONE_STEP,
    OPEN_STEP,
    TASK_ASSIGNEE_ASSISTANT_TYPE,
} from '../../../TaskListView/Utils/TasksHelper'
import { stopLoadingData } from '../../../../redux/actions'
import { WORKSTREAM_ID_PREFIX } from '../../../Workstreams/WorkstreamHelper'
import { checkIsLimitedByXp } from '../../../Premium/PremiumHelper'
import { moveTasksFromDone, moveTasksFromOpen, setTaskStatus } from '../../../../utils/backends/Tasks/tasksFirestore'

export default function TaskArea({
    projectId,
    editing,
    closeModal,
    editorRef,
    noteId,
    task,
    tagId,
    unwatchTask,
    startInEditionMode,
    isSubtask,
    taskBeenEdited,
    setTaskBeenEdited,
    objectUrl,
}) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const [inEditionMode, setInEditionMode] = useState(startInEditionMode)
    const [followUpModalIsOpen, setFollowUpModalIsOpen] = useState(false)
    const [workflowModalIsOpen, setWorkflowModalIsOpen] = useState(false)

    const toggleEditionMode = () => {
        setTaskBeenEdited(inEditionMode ? '' : task.id)
        setInEditionMode(!inEditionMode)
    }

    useEffect(() => {
        if (task && taskBeenEdited !== task.id) {
            setInEditionMode('')
        }
    }, [taskBeenEdited])

    const closeFollowUpModal = () => {
        setFollowUpModalIsOpen(false)
    }

    const handleSubtaskWorkflowInteraction = () => {
        const { id, userId, name, estimations, done } = task
        setTaskStatus(projectId, id, !done, userId, task, '', true, estimations[OPEN_STEP], estimations[OPEN_STEP])
    }

    const handleFollowUpTaskWorkflowInteraction = longPress => {
        if (longPress) {
            setFollowUpModalIsOpen(true)
        } else {
            moveTasksFromOpen(projectId, task, DONE_STEP, null, null, task.estimations, '')
        }
    }

    const closeWorkflowModal = () => {
        setWorkflowModalIsOpen(false)
        dispatch(stopLoadingData())
    }

    const handleWorkflowTaskWorkflowInteraction = (longPress, workflow) => {
        if (task.userIds.length > 1 || longPress) {
            setWorkflowModalIsOpen(true)
        } else {
            const stepsEntries = Object.entries(workflow).sort(chronoEntriesOrder)
            moveTasksFromOpen(projectId, task, stepsEntries[0][0], null, null, task.estimations, '')
        }
    }

    const getWorkflow = task => {
        const taskOwner = task?.userId?.startsWith(WORKSTREAM_ID_PREFIX)
            ? loggedUser
            : TasksHelper.getTaskOwner(task.userId, projectId)
        if (taskOwner.recorderUserId) {
            return null
        } else {
            const { workflow } = taskOwner
            return workflow && workflow[projectId] && Object.keys(workflow[projectId]).length > 0
                ? workflow[projectId]
                : null
        }
    }

    const pressIcon = longPress => {
        if (checkIsLimitedByXp(projectId)) {
            closeModal()
        } else {
            if (inEditionMode) {
                toggleEditionMode()
            } else {
                setInEditionMode(true)
                setInEditionMode(false)
                setTaskBeenEdited(task.id)
                setTaskBeenEdited('')
            }

            const { done } = task
            if (isSubtask) {
                handleSubtaskWorkflowInteraction()
            } else if (done) {
                moveTasksFromDone(projectId, task, OPEN_STEP)
            } else {
                const workflow = getWorkflow(task)
                if (!task.isPrivate && workflow && !task.genericData) {
                    handleWorkflowTaskWorkflowInteraction(longPress, workflow)
                } else {
                    handleFollowUpTaskWorkflowInteraction(longPress)
                }
            }
        }
    }

    const isAssistant = task && task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

    return (
        <View>
            {inEditionMode ? (
                <TaskEditionMode
                    projectId={projectId}
                    closeModal={closeModal}
                    editorRef={editorRef}
                    noteId={noteId}
                    editing={editing}
                    task={task}
                    tagId={tagId}
                    unwatchTask={unwatchTask}
                    toggleEditionMode={toggleEditionMode}
                    pressIcon={pressIcon}
                    isSubtask={isSubtask}
                    objectUrl={objectUrl}
                />
            ) : (
                <TaskPresentationMode
                    task={task}
                    projectId={projectId}
                    toggleEditionMode={toggleEditionMode}
                    pressIcon={pressIcon}
                    disabled={followUpModalIsOpen || workflowModalIsOpen}
                    checkBoxMarked={followUpModalIsOpen || workflowModalIsOpen}
                    isSubtask={isSubtask}
                />
            )}
            {editing && !isSubtask && !isAssistant && (
                <FollowUpModalWrapper
                    task={task}
                    projectId={projectId}
                    followUpModalIsOpen={followUpModalIsOpen}
                    closeFollowUpModal={closeFollowUpModal}
                />
            )}

            {editing && !isSubtask && !isAssistant && (
                <WorkflowModalWrapper
                    task={task}
                    projectId={projectId}
                    workflowModalIsOpen={workflowModalIsOpen}
                    closeWorkflowModal={closeWorkflowModal}
                    workflow={getWorkflow(task)}
                    inReview={task.userIds.length > 1}
                />
            )}
        </View>
    )
}
