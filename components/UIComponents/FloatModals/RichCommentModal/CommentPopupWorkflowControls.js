import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
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
import useOnHover from '../../../../hooks/UseOnHover'

const CHAT_APPEARANCE = 'chat'

function WorkflowStepOption({ step, controlsDisabled, moveTaskToStep, chatAppearance }) {
    const { hover, onHover, offHover } = useOnHover()
    const optionDisabled = controlsDisabled || step.current

    return (
        <TouchableOpacity
            testID={step.current ? 'comment-popup-current-workflow-step' : undefined}
            style={[
                localStyles.stepOption,
                chatAppearance && localStyles.chatStepOption,
                chatAppearance && hover && !optionDisabled && localStyles.chatStepOptionHover,
                step.current && localStyles.currentStepOption,
                step.current && chatAppearance && localStyles.chatCurrentStepOption,
            ]}
            onPress={() => moveTaskToStep(step.id, 'selector')}
            onMouseEnter={onHover}
            onMouseLeave={offHover}
            disabled={optionDisabled}
            accessibilityRole="button"
            accessibilityLabel={`${translate('Select workflow step')}: ${step.label}`}
            accessibilityState={{ selected: step.current, disabled: optionDisabled }}
        >
            <Text
                style={[styles.subtitle1, localStyles.stepOptionText, chatAppearance && localStyles.chatStepOptionText]}
                numberOfLines={2}
            >
                {step.label}
            </Text>
            {step.current && (
                <View style={localStyles.currentStepIndicator}>
                    <Icon name="check" size={14} color={colors.Primary100} />
                    <Text style={[styles.caption2, localStyles.currentStepText]}>{translate('Current')}</Text>
                </View>
            )}
        </TouchableOpacity>
    )
}

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
    ].map(step => ({ ...step, current: step.id === targets.currentStepId }))
}

export default function CommentPopupWorkflowControls({
    projectId,
    task,
    workflow,
    disabled,
    onDirectionalTransitionSuccess,
    appearance,
}) {
    const [submitting, setSubmitting] = useState(false)
    const [selectorOpen, setSelectorOpen] = useState(false)
    const { hover: selectorHovered, onHover: onSelectorHover, offHover: offSelectorHover } = useOnHover()
    const submittingRef = useRef(false)
    const checkBoxIdRef = useRef(v4())
    const targets = getCommentPopupWorkflowTargets(task, workflow)
    const selectableSteps = getCommentPopupSelectableSteps(task, workflow)
    const currentStepId = task?.stepHistory?.[task.stepHistory.length - 1]
    const chatAppearance = appearance === CHAT_APPEARANCE

    useEffect(() => {
        submittingRef.current = false
        setSubmitting(false)
        setSelectorOpen(false)
    }, [currentStepId, task?.done])

    if (!targets) return null

    const currentStepLabel = workflow[targets.currentStepId]?.description

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
            return true
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
            return false
        }
    }

    const moveTask = async direction => {
        const transitionSucceeded = await moveTaskToStep(
            direction === WORKFLOW_BACKWARD ? targets.backwardStepId : targets.forwardStepId,
            direction
        )
        if (transitionSucceeded) onDirectionalTransitionSuccess?.()
    }

    const controlsDisabled = disabled || submitting

    return (
        <View
            testID="comment-popup-workflow-controls"
            style={[localStyles.container, chatAppearance && localStyles.chatContainer]}
        >
            <TouchableOpacity
                testID="comment-popup-workflow-selector"
                style={[
                    localStyles.selectorButton,
                    chatAppearance && localStyles.chatSelectorButton,
                    chatAppearance && selectorHovered && !controlsDisabled && localStyles.chatSelectorButtonHover,
                    controlsDisabled && localStyles.disabled,
                ]}
                onPress={() => setSelectorOpen(open => !open)}
                onMouseEnter={onSelectorHover}
                onMouseLeave={offSelectorHover}
                disabled={controlsDisabled}
                accessibilityRole="button"
                accessibilityLabel={`${translate('Select workflow step')}: ${currentStepLabel}`}
                accessibilityState={{ expanded: selectorOpen, disabled: controlsDisabled }}
            >
                {submitting ? (
                    <ActivityIndicator
                        testID="workflow-transition-loading"
                        size="small"
                        color={chatAppearance ? colors.Primary100 : colors.Text03}
                    />
                ) : (
                    <Icon name="list" size={18} color={chatAppearance ? colors.Text02 : colors.Text03} />
                )}
                <Text
                    style={[
                        styles.subtitle2,
                        localStyles.selectorButtonText,
                        chatAppearance && localStyles.chatSelectorButtonText,
                    ]}
                    numberOfLines={1}
                >
                    {`${translate('Current workflow step')}: ${currentStepLabel}`}
                </Text>
                <Icon
                    name={selectorOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={chatAppearance ? colors.Text02 : colors.Text03}
                />
            </TouchableOpacity>
            {selectorOpen && (
                <ScrollView
                    testID="comment-popup-workflow-step-list"
                    style={[localStyles.stepList, chatAppearance && localStyles.chatStepList]}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                >
                    {selectableSteps.map(step => (
                        <WorkflowStepOption
                            key={step.id}
                            step={step}
                            controlsDisabled={controlsDisabled}
                            moveTaskToStep={moveTaskToStep}
                            chatAppearance={chatAppearance}
                        />
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
    chatContainer: {
        backgroundColor: colors.Grey100,
        borderBottomColor: colors.Gray300,
        borderBottomWidth: 1,
        paddingBottom: 8,
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
    chatSelectorButton: {
        backgroundColor: 'transparent',
        borderColor: colors.Gray300,
        borderWidth: 1,
    },
    chatSelectorButtonHover: {
        backgroundColor: colors.Grey200,
    },
    selectorButtonText: {
        color: 'white',
        flex: 1,
        marginHorizontal: 8,
    },
    chatSelectorButtonText: {
        color: colors.Text02,
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
    chatStepList: {
        backgroundColor: colors.Grey100,
        borderColor: colors.Gray300,
        borderWidth: 1,
    },
    stepOption: {
        alignItems: 'center',
        borderBottomColor: colors.Secondary200,
        borderBottomWidth: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        minHeight: 40,
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
    chatStepOption: {
        borderBottomColor: colors.Gray300,
    },
    chatStepOptionHover: {
        backgroundColor: colors.Grey200,
    },
    stepOptionText: {
        color: 'white',
        flex: 1,
    },
    chatStepOptionText: {
        color: colors.Text02,
    },
    currentStepOption: {
        backgroundColor: colors.Secondary200,
    },
    chatCurrentStepOption: {
        backgroundColor: colors.UtilityBlue100,
    },
    currentStepIndicator: {
        alignItems: 'center',
        flexDirection: 'row',
        marginLeft: 8,
    },
    currentStepText: {
        color: colors.Primary100,
        marginLeft: 4,
    },
})
