import React from 'react'
import { StyleSheet, View } from 'react-native'

import TaskInput from './TaskInput'

export default function TaskInputArea({ leftAccessory, rightAccessory, isSubtask, ...taskInputProps }) {
    return (
        <View style={[localStyles.container, isSubtask && localStyles.subtaskContainer]}>
            {leftAccessory}
            <TaskInput isSubtask={isSubtask} {...taskInputProps} />
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
})
