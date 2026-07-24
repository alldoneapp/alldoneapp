import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'

import CheckBox from '../../../../CheckBox'
import { colors } from '../../../../styles/global'
import Icon from '../../../../Icon'
import ActionPopupIndicator from './ActionPopupIndicator'
import AiStepCheckBox from './AiStepCheckBox'
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
}) {
    const needToShowAnInteractionModal =
        !isSubtask &&
        (pending ||
            isToReviewTask ||
            isSuggested ||
            isObservedTask ||
            showWorkflowIndicator ||
            showEmailCompletionIndicator)

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
            ) : (
                <CheckBox
                    checked={checked}
                    checkOnDrag={checkOnDrag}
                    isSubtask={isSubtask}
                    dragMode={isActiveOrganizeMode}
                    checkBoxId={checkBoxIdRef.current}
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
