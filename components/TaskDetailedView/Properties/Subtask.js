import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import ObjectLinkTag from '../../Feeds/Utils/ObjectLinkTag'
import Backend from '../../../utils/BackendBridge'
import Button from '../../UIControls/Button'
import { promoteSubtask } from '../../../utils/backends/Tasks/tasksFirestore'

export default function Subtask({ projectId, task, disabled }) {
    const [parentName, setParentName] = useState('')

    const parentId = task.parentId

    const promote = () => {
        promoteSubtask(projectId, task)
    }

    useEffect(() => {
        Backend.getTaskData(projectId, parentId).then(parentTask => {
            const { name } = parentTask
            setParentName(name)
        })
    }, [])
    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="check-square-Sub" size={24} color={colors.Text03} />
            </View>
            <Text style={localStyles.text}>Subtask</Text>
            <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' }}>
                <ObjectLinkTag
                    containerStyle={{ marginRight: 8 }}
                    text={parentName}
                    inTaskDetailView={true}
                    projectId={projectId}
                    objectTypes="tasks"
                    objectId={parentId}
                />
                <View style={{ marginLeft: 'auto' }}>
                    <Button
                        type="ghost"
                        icon="promote-to-task"
                        title="Promote to task"
                        onPress={promote}
                        disabled={disabled}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 16,
        alignItems: 'center',
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
})
