import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import v4 from 'uuid/v4'

import store from '../../../../redux/store'
import { showTaskCompletionAnimation, startLoadingData } from '../../../../redux/actions'
import { getWorkflowStepsIdsSorted } from '../../../../utils/HelperFunctions'
import { moveTasksFromMiddleOfWorkflow, moveTasksFromOpen } from '../../../../utils/backends/Tasks/tasksFirestore'
import { DONE_STEP, OPEN_STEP } from '../../../TaskListView/Utils/TasksHelper'
import MainButtons from '../../../WorkflowModal/MainButtons'
import { WORKFLOW_BACKWARD } from '../../../WorkflowModal/workflowDirections'

export const getCommentPopupWorkflowTargets = (task, workflow) => {
    const stepIds = getWorkflowStepsIdsSorted(workflow)
    const stepHistory = Array.isArray(task?.stepHistory) ? task.stepHistory : []
    const currentStepId = stepHistory[stepHistory.length - 1]
    const currentStep = stepIds.indexOf(currentStepId)

    if (task?.done || currentStep < 0) return null

    return {
        currentStep,
        backwardStepId: currentStep > 0 ? stepIds[currentStep - 1] : OPEN_STEP,
        forwardStepId: currentStep + 1 < stepIds.length ? stepIds[currentStep + 1] : DONE_STEP,
    }
}

export default function CommentPopupWorkflowControls({ projectId, task, workflow, disabled }) {
    const [submitting, setSubmitting] = useState(false)
    const submittingRef = useRef(false)
    const checkBoxIdRef = useRef(v4())
    const targets = getCommentPopupWorkflowTargets(task, workflow)
    const currentStepId = task?.stepHistory?.[task.stepHistory.length - 1]

    useEffect(() => {
        submittingRef.current = false
        setSubmitting(false)
    }, [currentStepId, task?.done])

    if (!targets) return null

    const moveTask = async direction => {
        if (disabled || submittingRef.current) return

        submittingRef.current = true
        setSubmitting(true)

        const stepToMoveId = direction === WORKFLOW_BACKWARD ? targets.backwardStepId : targets.forwardStepId

        store.dispatch(startLoadingData())
        if (stepToMoveId === DONE_STEP) store.dispatch(showTaskCompletionAnimation())

        try {
            if (task.userIds.length === 1) {
                await moveTasksFromOpen(
                    projectId,
                    task,
                    stepToMoveId,
                    null,
                    null,
                    task.estimations,
                    checkBoxIdRef.current
                )
            } else {
                await moveTasksFromMiddleOfWorkflow(
                    projectId,
                    task,
                    stepToMoveId,
                    null,
                    null,
                    task.estimations,
                    checkBoxIdRef.current
                )
            }
        } catch (error) {
            console.error('[CommentPopupWorkflowControls] Could not move task', {
                projectId,
                taskId: task.id,
                direction,
                error,
            })
            submittingRef.current = false
            setSubmitting(false)
        }
    }

    return (
        <View testID="comment-popup-workflow-controls">
            <MainButtons
                onDonePress={moveTask}
                selectedCustomStep={false}
                currentStep={targets.currentStep}
                disabled={disabled || submitting}
                shortcutsEnabled={false}
            />
        </View>
    )
}
