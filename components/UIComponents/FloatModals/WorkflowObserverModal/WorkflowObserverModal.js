import React, { useState, useEffect } from 'react'
import EstimationModal from '../EstimationModal/EstimationModal'
import Backend from '../../../../utils/BackendBridge'
import WorkflowSelection from '../../../WorkflowModal/WorkflowSelection'
import TasksHelper, {
    DONE_STEP,
    getTaskAutoEstimation,
    OPEN_STEP,
    TASK_ASSIGNEE_ASSISTANT_TYPE,
} from '../../../TaskListView/Utils/TasksHelper'
import RichCommentModal from '../RichCommentModal/RichCommentModal'
import { MENTION_MODAL_ID, removeModal, storeModal, WORKFLOW_MODAL_ID } from '../../../ModalsManager/modalsManager'
import MainModal from './MainModal'
import { useSelector } from 'react-redux'
import { setTaskAutoEstimation, stopObservingTask } from '../../../../utils/backends/Tasks/tasksFirestore'

export default function WorkflowObserverModal({
    projectId,
    task,
    workflow,
    cancelPopover,
    ownerIsWorkstream,
    checkBoxId,
    isNonTeamMember,
}) {
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUser = useSelector(state => state.currentUser)
    const [inComments, setInComments] = useState(false)
    const [inEstimation, setInEstimation] = useState(false)
    const [inWorkflowSelection, setInWorkflowSelection] = useState(false)
    const [comment, setComment] = useState('')
    const [commentIsPrivate, setCommentIsPrivate] = useState(false)
    const [commentHasKarma, setCommentHasKarma] = useState(false)
    const [estimation, setEstimation] = useState(task.estimations[OPEN_STEP])
    const [steps, setSteps] = useState({ ...workflow })
    const [selectedNextStepIndex, setSelectedNextStepIndex] = useState(OPEN_STEP)
    const [currentStep, setCurrentStep] = useState(OPEN_STEP)
    const [wasSelectedACustomStep, setWasSelectedACustomStep] = useState(false)

    const onPressClose = () => {
        cancelPopover()
    }

    const openCommentModal = e => {
        e.preventDefault()
        e.stopPropagation()
        setInComments(true)
    }

    const getCommentAndFiles = (comment, mentions, commentIsPrivate, commentHasKarma) => {
        setComment(comment)
        setCommentIsPrivate(commentIsPrivate)
        setCommentHasKarma(commentHasKarma)
        setInComments(false)
    }

    const closeCommentsPopover = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            setInComments(false)
        }
    }

    const removeComment = () => {
        setComment('')
    }

    const openEstimationModal = () => {
        setInEstimation(true)
    }

    const closeEstimationModal = () => {
        setInEstimation(false)
    }

    const openNextWorkflowStepModal = () => {
        setInWorkflowSelection(true)
    }

    const closeWorkFlowSelection = () => {
        setInWorkflowSelection(false)
    }

    const selectStep = stepIndex => {
        setSelectedNextStepIndex(stepIndex)
        setInWorkflowSelection(false)
        setWasSelectedACustomStep(true)
    }

    const triggerStopObservingTask = (userIdStopingObserving, selectedNextStepIndex) => {
        stopObservingTask(
            projectId,
            task,
            userIdStopingObserving,
            comment,
            estimation,
            steps,
            selectedNextStepIndex,
            checkBoxId
        )
        cancelPopover()
    }

    const stopObserving = () => {
        triggerStopObservingTask(currentUser.uid, wasSelectedACustomStep ? selectedNextStepIndex : null)
    }

    const moveNextOrSelectedStep = () => {
        const userIdStopingObserving =
            ownerIsWorkstream && task.observersIds.includes(loggedUser.uid) ? loggedUser.uid : null
        triggerStopObservingTask(userIdStopingObserving, selectedNextStepIndex)
    }

    const setAutoEstimation = autoEstimation => {
        setTaskAutoEstimation(projectId, task, autoEstimation)
    }

    const onKeyDown = event => {
        if (event.key === 'Enter' && !inComments) {
            if (inEstimation) {
                setInComments(false)
            } else if (inWorkflowSelection) {
                setInWorkflowSelection(false)
            } else {
                const isAssistant = task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE
                isNonTeamMember || isAssistant ? moveNextOrSelectedStep() : stopObserving()
            }
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    useEffect(() => {
        storeModal(WORKFLOW_MODAL_ID)

        return () => {
            removeModal(WORKFLOW_MODAL_ID)
        }
    }, [])

    useEffect(() => {
        const stepsIds = Object.keys(workflow).sort((a, b) => {
            return a < b ? -1 : 1
        })

        const currentStepIndex = stepsIds.indexOf(task.stepHistory[task.stepHistory.length - 1])
        const currentStep = currentStepIndex === -1 ? OPEN_STEP : currentStepIndex
        setCurrentStep(currentStep)

        const taskNextStepIsInDone = stepsIds.length - 1 === currentStep
        setSelectedNextStepIndex(taskNextStepIsInDone ? DONE_STEP : currentStepIndex + 1)
    }, [])

    const assignee = TasksHelper.getTaskOwner(task.userId, projectId)
    const estimations = { ...task.estimations, [OPEN_STEP]: estimation }

    return inComments ? (
        <RichCommentModal
            projectId={projectId}
            objectType={'tasks'}
            objectId={task.id}
            closeModal={closeCommentsPopover}
            processDone={getCommentAndFiles}
            currentComment={comment}
            currentPrivacy={commentIsPrivate}
            currentKarma={commentHasKarma}
            inTaskModal={true}
            userGettingKarmaId={task.userId}
            externalAssistantId={task.assistantId}
            objectName={task.name}
        />
    ) : inEstimation ? (
        <EstimationModal
            projectId={projectId}
            estimation={estimation}
            setEstimationFn={setEstimation}
            closePopover={closeEstimationModal}
            showBackButton={true}
            autoEstimation={getTaskAutoEstimation(projectId, estimation, task.autoEstimation)}
            setAutoEstimation={setAutoEstimation}
            showAutoEstimation={!task.isSubtask}
        />
    ) : inWorkflowSelection ? (
        <WorkflowSelection
            closePopover={closeWorkFlowSelection}
            steps={steps}
            task={task}
            assignee={assignee}
            selectedNextStep={selectedNextStepIndex}
            selectStep={selectStep}
            estimations={estimations}
            currentStep={currentStep}
        />
    ) : (
        <MainModal
            projectId={projectId}
            onPressClose={onPressClose}
            openCommentModal={openCommentModal}
            comment={comment}
            removeComment={removeComment}
            openEstimationModal={openEstimationModal}
            estimations={estimations}
            openNextWorkflowStepModal={openNextWorkflowStepModal}
            wasSelectedACustomStep={wasSelectedACustomStep}
            stopObserving={stopObserving}
            moveNextOrSelectedStep={moveNextOrSelectedStep}
            steps={steps}
            selectedNextStep={selectedNextStepIndex}
            task={task}
            isNonTeamMember={isNonTeamMember}
        />
    )
}
