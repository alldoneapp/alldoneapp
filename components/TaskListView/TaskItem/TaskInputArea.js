import React from 'react'
import { StyleSheet, View } from 'react-native'

import TaskInput from './TaskInput'
import { colors } from '../../styles/global'

export default function TaskInputArea({
    leftAccessory,
    rightAccessory,
    isSubtask,
    adding,
    newTaskInFocus,
    ...taskInputProps
}) {
    const inlineTask = adding && !isSubtask

    return (
        <View
            style={[
                localStyles.container,
                isSubtask && localStyles.subtaskContainer,
                inlineTask && localStyles.inlineTaskContainer,
                inlineTask && newTaskInFocus && localStyles.focusedInlineTaskContainer,
            ]}
        >
            {leftAccessory}
            <TaskInput isSubtask={isSubtask} adding={adding} {...taskInputProps} />
            {rightAccessory}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        minHeight: 59,
        overflow: 'hidden',
    },
    subtaskContainer: {
        minHeight: 55,
    },
    inlineTaskContainer: {
        marginHorizontal: 8,
        backgroundColor: '#ffffff',
        borderRadius: 4,
    },
    focusedInlineTaskContainer: {
        borderColor: colors.Primary100,
        borderWidth: 2,
    },
})
