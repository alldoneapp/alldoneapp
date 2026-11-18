import React from 'react'
import { StyleSheet, View } from 'react-native'

import Button from '../UIControls/Button'
import { OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import { translate } from '../../i18n/TranslationService'
import { WORKFLOW_BACKWARD, WORKFLOW_FORWARD } from './workflowDirections'

export const getWorkflowBarActionLabels = ({ currentStep, backwardStepName, forwardStepName }) => {
    const forwardAction = translate(currentStep === OPEN_STEP ? 'Go to next step' : 'Send forward')
    const backwardAction = translate('Send back')
    const withTarget = (action, step) =>
        step ? translate('Workflow action with target step', { action, step }) : action

    return {
        forwardAction,
        backwardAction,
        forwardLabel: withTarget(forwardAction, forwardStepName),
        backwardLabel: withTarget(backwardAction, backwardStepName),
    }
}

/**
 * The one-row Back / Forward pair of the task view's slim workflow bar (AT-3081).
 *
 * Same moves and the same visibility rules as `MainButtons` (no Back on Open, no Forward on Done),
 * but 32px tall and on the same row as the current-step selector instead of a 52px two-line pair
 * under it. On desktop both buttons name their destination ("Send forward: Check what AI did");
 * on narrow screens Back shrinks to an arrow and Forward keeps its action text, so the main next
 * action stays readable. The full "action: destination" text is always the accessible name.
 */
export default function WorkflowBarButtons({
    currentStep,
    onDonePress,
    disabled,
    narrow = false,
    backwardStepName,
    forwardStepName,
    hideForwardButton = false,
}) {
    const { forwardAction, backwardLabel, forwardLabel } = getWorkflowBarActionLabels({
        currentStep,
        backwardStepName,
        forwardStepName,
    })
    const showBackward = currentStep !== OPEN_STEP

    return (
        <View testID="workflow-bar-buttons" style={localStyles.container}>
            {showBackward && (
                <Button
                    testID="workflow-bar-backward"
                    type={'secondary'}
                    icon={'arrow-left'}
                    iconSize={16}
                    iconGap={6}
                    title={narrow ? null : backwardLabel}
                    disabled={disabled}
                    onPress={() => onDonePress(WORKFLOW_BACKWARD)}
                    buttonStyle={[localStyles.button, !narrow && localStyles.labelledButton]}
                    titleStyle={localStyles.title}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={backwardLabel}
                    accessibilityState={{ disabled: !!disabled }}
                />
            )}
            {!hideForwardButton && (
                <Button
                    testID="workflow-bar-forward"
                    type={'primary'}
                    icon={'arrow-right'}
                    iconSize={16}
                    iconGap={6}
                    title={narrow ? forwardAction : forwardLabel}
                    disabled={disabled}
                    onPress={() => onDonePress(WORKFLOW_FORWARD)}
                    buttonStyle={[localStyles.button, localStyles.labelledButton]}
                    titleStyle={localStyles.title}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={forwardLabel}
                    accessibilityState={{ disabled: !!disabled }}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        minWidth: 0,
        // Leave the selector at least half of a wide row; long step names truncate instead.
        maxWidth: '60%',
    },
    button: {
        alignSelf: 'center',
        height: 32,
        maxHeight: 32,
        minHeight: 32,
        marginLeft: 8,
        paddingVertical: 0,
        flexShrink: 1,
        minWidth: 0,
    },
    labelledButton: {
        paddingLeft: 8,
        paddingRight: 12,
    },
    title: {
        flexShrink: 1,
        minWidth: 0,
    },
})
