import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'

import { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import CheckBox from '../../../CheckBox'

export default function TaskIcon({
    editing,
    task,
    inEditionMode,
    onPress,
    onLongPress,
    checkBoxMarked,
    isSubtask,
    disabled,
}) {
    const renderIco = () => {
        const { done, userIds } = task
        if (done) {
            return (
                <CheckBox
                    checked={done}
                    externalContainerStyle={inEditionMode && localStyles.plusIcon}
                    isSubtask={isSubtask}
                />
            )
        }
        if (userIds.length > 1) {
            return inEditionMode || isSubtask ? (
                <CheckBox
                    iconColor={colors.Text03}
                    externalContainerStyle={[
                        !checkBoxMarked && { backgroundColor: 'transparent' },
                        inEditionMode && localStyles.plusIcon,
                    ]}
                    checked={checkBoxMarked}
                    isSubtask={isSubtask}
                />
            ) : (
                <Icon name="clock" size={24} color="#ffffff" />
            )
        }
        return (
            <CheckBox
                iconColor={colors.Text03}
                externalContainerStyle={[
                    !checkBoxMarked && { backgroundColor: 'transparent' },
                    inEditionMode && localStyles.plusIcon,
                ]}
                checked={checkBoxMarked}
                isSubtask={isSubtask}
            />
        )
    }

    const icon = renderIco()
    return editing ? (
        <TouchableOpacity
            onPress={onPress}
            onLongPress={onLongPress}
            style={isSubtask && localStyles.subtaskContainer}
            disabled={disabled}
        >
            {icon}
        </TouchableOpacity>
    ) : (
        <Icon name="plus-square" size={24} color={colors.Primary100} style={localStyles.plusIcon} />
    )
}

const localStyles = StyleSheet.create({
    subtaskContainer: {
        padding: 2,
    },
    plusIcon: { marginRight: 12 },
})
