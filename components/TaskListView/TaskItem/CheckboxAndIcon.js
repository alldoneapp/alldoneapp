import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import TaskCheckbox from './TaskCheckbox'

export default function CheckboxAndIcon({
    tmpTask,
    isSubtask,
    adding,
    accessGranted,
    showArrowInAnonymous,
    loggedUserCanUpdateObject,
    isAssistant,
    projectId,
    editModeCheckOff,
}) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    const addingSubtask = isSubtask && adding
    const showCheckbox =
        (!loggedUserCanUpdateObject && tmpTask.subtaskIds.length === 0) ||
        isSubtask ||
        !isMiddleScreen ||
        !showArrowInAnonymous ||
        isAssistant

    return (
        <View
            style={[
                localStyles.icon,
                isSubtask && localStyles.subtaskIcon,
                isSubtask && isMiddleScreen && localStyles.subtaskIconMobile,
                adding && localStyles.iconNew,
                (adding || !showArrowInAnonymous) && isMiddleScreen && localStyles.iconNewMobile,
                addingSubtask && localStyles.subtaskIconNew,
                addingSubtask && isMiddleScreen && localStyles.subtaskIconNewMobile,
            ]}
        >
            {adding ? (
                <Icon name={'plus-square'} size={24} color={colors.Primary100} />
            ) : showCheckbox ? (
                <TaskCheckbox
                    tmpTask={tmpTask}
                    isSubtask={isSubtask}
                    accessGranted={accessGranted}
                    showArrowInAnonymous={showArrowInAnonymous}
                    loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                    isAssistant={isAssistant}
                    projectId={projectId}
                    editModeCheckOff={editModeCheckOff}
                />
            ) : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    icon: {
        position: 'absolute',
        padding: 0,
        margin: 0,
        left: 15,
        top: 7,
        zIndex: 100,
    },
    iconNew: {
        top: 7,
    },
    iconNewMobile: {
        top: 7,
        left: 7,
    },
    subtaskIcon: {
        left: 19,
        top: 9,
    },
    subtaskIconMobile: {
        left: 11,
        top: 9,
    },
    subtaskIconNew: {
        left: 17,
        top: 7,
    },
    subtaskIconNewMobile: {
        left: 9,
        top: 7,
    },
})
