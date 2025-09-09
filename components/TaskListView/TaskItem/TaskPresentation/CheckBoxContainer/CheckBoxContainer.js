import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'

import CheckBox from '../../../../CheckBox'
import { colors } from '../../../../styles/global'
import Icon from '../../../../Icon'
import ActionPopupIndicator from './ActionPopupIndicator'

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
    onCheckboxPress,
    checkBoxIdRef,
    checked,
    loggedUserCanUpdateObject,
}) {
    const neeToShowAnInteractionModal =
        !isSubtask && (pending || isToReviewTask || isSuggested || isObservedTask || showWorkflowIndicator)

    return (
        <TouchableOpacity
            style={[localStyles.checkBox, isSubtask && subTaskStyles.checkBox]}
            accessible={false}
            activeOpacity={0.35}
            onPress={() => onCheckboxPress(neeToShowAnInteractionModal)}
            onLongPress={() => onCheckboxPress(true)}
            disabled={!accessGranted || !loggedUserCanUpdateObject}
        >
            {pending ? (
                <Icon name={'clock'} size={24} color={colors.Text03} />
            ) : (
                <CheckBox
                    checked={checked}
                    checkOnDrag={checkOnDrag}
                    isSubtask={isSubtask}
                    dragMode={isActiveOrganizeMode}
                    checkBoxId={checkBoxIdRef.current}
                />
            )}
            <ActionPopupIndicator visible={neeToShowAnInteractionModal} borderColor={highlightColor} />
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
