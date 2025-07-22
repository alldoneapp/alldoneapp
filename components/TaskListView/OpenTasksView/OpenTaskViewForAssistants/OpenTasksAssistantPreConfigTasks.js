import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { watchAssistantTasks } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { unwatch } from '../../../../utils/backends/firestore'
import PreConfigTaskGeneratorWrapper from './PreConfigTaskGeneratorWrapper'
import ChatWith from './ChatWith'
import { GLOBAL_PROJECT_ID } from '../../../AdminPanel/Assistants/assistantsHelper'

export default function OpenTasksAssistantPreConfigTasks({ projectId }) {
    const currentUser = useSelector(state => state.currentUser)
    const globalAssistants = useSelector(state => state.globalAssistants)
    const [tasks, setTasks] = useState([])

    const isGlobalAssistant = globalAssistants.find(item => item.uid === currentUser.uid)
    const tasksProjectId = isGlobalAssistant ? GLOBAL_PROJECT_ID : projectId

    useEffect(() => {
        const watcherKey = v4()
        watchAssistantTasks(tasksProjectId, currentUser.uid, watcherKey, setTasks)
        return () => {
            unwatch(watcherKey)
        }
    }, [currentUser.uid, tasksProjectId])

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.header}>{translate('Assistant tasks')}</Text>
            <ChatWith assistant={currentUser} />
            {tasks.map(task => (
                <PreConfigTaskGeneratorWrapper
                    projectId={projectId}
                    key={task.id}
                    task={task}
                    assistant={currentUser}
                />
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 21,
        marginBottom: 44,
    },
    header: {
        ...styles.title6,
        color: colors.Text01,
    },
})
