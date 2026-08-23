import React from 'react'
import { Animated, StyleSheet, TouchableOpacity } from 'react-native'

import CheckBox from '../../../../CheckBox'
import { colors } from '../../../../styles/global'
import Icon from '../../../../Icon'
import ActionPopupIndicator from './ActionPopupIndicator'
import AiStepCheckBox from './AiStepCheckBox'
import TaskCompletionCelebration from './TaskCompletionCelebration'
import { translate } from '../../../../../i18n/TranslationService'

export default function CheckBoxContainer({
    isSubtask,
    isObservedTask,
    isToReviewTask,
    isSuggested,
    isActiveOrganizeMode,
    checkOnDrag,
    highlightColor,
    accessGranted,
    pending,
    showWorkflowIndicator,
    showEmailCompletionIndicator,
    isNextStepAi,
    aiStepRunning,
    onCheckboxPress,
    checkBoxIdRef,
    checked,
    loggedUserCanUpdateObject,
    completionCelebration,
}) {
    const needToShowAnInteractionModal =
        !isSubtask &&
        (pending ||
            isToReviewTask ||
            isSuggested ||
            isObservedTask ||
            showWorkflowIndicator ||
            showEmailCompletionIndicator)

    const showsPlainCheckBox = !pending && !(isNextStepAi && (!checked || aiStepRunning))
    // AT-2404 — the celebration draws a green check over the checkbox, so it may only run when the
    // checkbox is what is actually rendered. The clock (a task waiting on someone else) and the AI
    // step control are different affordances with their own state; covering either with a "done"
    // tile would say something untrue about what just happened.
    const celebration = completionCelebration && showsPlainCheckBox ? completionCelebration : null

    return (
        <TouchableOpacity
            style={[localStyles.checkBox, isSubtask && subTaskStyles.checkBox]}
            accessible={!!isNextStepAi}
            accessibilityLabel={isNextStepAi ? translate('Run AI step') : undefined}
            title={isNextStepAi ? translate('Run AI step') : undefined}
            activeOpacity={0.35}
            onPress={() => onCheckboxPress(needToShowAnInteractionModal)}
            onLongPress={() => onCheckboxPress(true)}
            disabled={!accessGranted || !loggedUserCanUpdateObject}
        >
            {pending ? (
                <Icon name={'clock'} size={24} color={colors.Text03} />
            ) : isNextStepAi && (!checked || aiStepRunning) ? (
                <AiStepCheckBox running={aiStepRunning} />
            ) : celebration ? (
                // The punch is applied to the real checkbox rather than to the overlay, so what
                // squashes and springs back is the element the finger landed on.
                <Animated.View
                    testID="task-completion-checkbox-punch"
                    style={{ transform: [{ scale: celebration.punch }] }}
                >
                    <CheckBox
                        checked={checked}
                        checkOnDrag={checkOnDrag}
                        isSubtask={isSubtask}
                        dragMode={isActiveOrganizeMode}
                        checkBoxId={checkBoxIdRef.current}
                    />
                </Animated.View>
            ) : (
                <CheckBox
                    checked={checked}
                    checkOnDrag={checkOnDrag}
                    isSubtask={isSubtask}
                    dragMode={isActiveOrganizeMode}
                    checkBoxId={checkBoxIdRef.current}
                />
            )}
            {celebration && (
                <TaskCompletionCelebration
                    punch={celebration.punch}
                    burst={celebration.burst}
                    opacity={celebration.opacity}
                    animated={celebration.animated}
                    isSubtask={isSubtask}
                />
            )}
            <ActionPopupIndicator visible={needToShowAnInteractionModal} borderColor={highlightColor} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    checkBox: {
        marginTop: 8,
    },
})

const subTaskStyles = StyleSheet.create({
    checkBox: {
        marginTop: 10,
    },
})
