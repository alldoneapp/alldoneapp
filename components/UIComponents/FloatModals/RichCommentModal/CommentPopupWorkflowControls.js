import React, { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import v4 from 'uuid/v4'

import store from '../../../../redux/store'
import { showTaskCompletionAnimation, startLoadingData } from '../../../../redux/actions'
import { getWorkflowStepsIdsSorted } from '../../../../utils/HelperFunctions'
import { moveTasksFromMiddleOfWorkflow, moveTasksFromOpen } from '../../../../utils/backends/Tasks/tasksFirestore'
import { DONE_STEP, OPEN_STEP } from '../../../TaskListView/Utils/TasksHelper'
import MainButtons from '../../../WorkflowModal/MainButtons'
import { WORKFLOW_BACKWARD } from '../../../WorkflowModal/workflowDirections'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export const getCommentPopupWorkflowTargets = (task, workflow) => {
    const stepIds = getWorkflowStepsIdsSorted(workflow)
    const stepHistory = Array.isArray(task?.stepHistory) ? task.stepHistory : []
    const currentStepId = stepHistory[stepHistory.length - 1]
    const currentStep = stepIds.indexOf(currentStepId)

    if (task?.done || currentStep < 0) return null

    return {
        currentStep,
        currentStepId,
        stepIds,
        backwardStepId: currentStep > 0 ? stepIds[currentStep - 1] : OPEN_STEP,
        forwardStepId: currentStep + 1 < stepIds.length ? stepIds[currentStep + 1] : DONE_STEP,
    }
}

export const getCommentPopupSelectableSteps = (task, workflow) => {
    const targets = getCommentPopupWorkflowTargets(task, workflow)
    if (!targets) return []

    return [
        { id: OPEN_STEP, label: translate('Open') },
        ...targets.stepIds.map(id => ({ id, label: workflow[id].description })),
        { id: DONE_STEP, label: translate('Done') },
    ].filter(step => step.id !== targets.currentStepId)
}

export default function CommentPopupWorkflowControls({ projectId, task, workflow, disabled }) {
    const [submitting, setSubmitting] = useState(false)
    const [selectorOpen, setSelectorOpen] = useState(false)
    const submittingRef = useRef(false)
    const checkBoxIdRef = useRef(v4())
    const targets = getCommentPopupWorkflowTargets(task, workflow)
    const selectableSteps = getCommentPopupSelectableSteps(task, workflow)
    const currentStepId = task?.stepHistory?.[task.stepHistory.length - 1]

    useEffect(() => {
        submittingRef.current = false
        setSubmitting(false)
        setSelectorOpen(false)
    }, [currentStepId, task?.done])

    if (!targets) return null

    const moveTaskToStep = async (stepToMoveId, source) => {
        if (disabled || submittingRef.current) return

        submittingRef.current = true
        setSubmitting(true)
        setSelectorOpen(false)

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
                source,
                stepToMoveId,
                error,
            })
            submittingRef.current = false
            setSubmitting(false)
        }
    }

    const moveTask = direction =>
        moveTaskToStep(direction === WORKFLOW_BACKWARD ? targets.backwardStepId : targets.forwardStepId, direction)

    const controlsDisabled = disabled || submitting

    return (
        <View testID="comment-popup-workflow-controls" style={localStyles.container}>
            <TouchableOpacity
                testID="comment-popup-workflow-selector"
                style={[localStyles.selectorButton, controlsDisabled && localStyles.disabled]}
                onPress={() => setSelectorOpen(open => !open)}
                disabled={controlsDisabled}
                accessibilityRole="button"
                accessibilityLabel={translate('Select workflow step')}
                accessibilityState={{ expanded: selectorOpen, disabled: controlsDisabled }}
            >
                <Icon name="list" size={18} color={colors.Text03} />
                <Text style={[styles.subtitle2, localStyles.selectorButtonText]} numberOfLines={1}>
                    {translate('Select workflow step')}
                </Text>
                <Icon name={selectorOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.Text03} />
            </TouchableOpacity>
            {selectorOpen && (
                <ScrollView
                    testID="comment-popup-workflow-step-list"
                    style={localStyles.stepList}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                >
                    {selectableSteps.map(step => (
                        <TouchableOpacity
                            key={step.id}
                            style={localStyles.stepOption}
                            onPress={() => moveTaskToStep(step.id, 'selector')}
                            disabled={controlsDisabled}
                            accessibilityRole="button"
                            accessibilityLabel={`${translate('Select workflow step')}: ${step.label}`}
                        >
                            <Text style={[styles.subtitle1, localStyles.stepOptionText]} numberOfLines={2}>
                                {step.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            )}
            <MainButtons
                onDonePress={moveTask}
                selectedCustomStep={false}
                currentStep={targets.currentStep}
                disabled={controlsDisabled}
                shortcutsEnabled={false}
                compact
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingHorizontal: 16,
        paddingTop: 8,
        width: '100%',
    },
    selectorButton: {
        alignItems: 'center',
        backgroundColor: colors.Secondary250,
        borderRadius: 4,
        flexDirection: 'row',
        height: 36,
        marginBottom: 8,
        paddingHorizontal: 10,
        width: '100%',
    },
    selectorButtonText: {
        color: 'white',
        flex: 1,
        marginHorizontal: 8,
    },
    disabled: {
        opacity: 0.5,
    },
    stepList: {
        backgroundColor: colors.Secondary250,
        borderRadius: 4,
        marginBottom: 8,
        maxHeight: 168,
        paddingHorizontal: 8,
    },
    stepOption: {
        borderBottomColor: colors.Secondary200,
        borderBottomWidth: 1,
        justifyContent: 'center',
        minHeight: 40,
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
    stepOptionText: {
        color: 'white',
    },
})
