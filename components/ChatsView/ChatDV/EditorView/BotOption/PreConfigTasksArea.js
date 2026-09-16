import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import v4 from 'uuid/v4'

import PreConfigTaskOption from './PreConfigTaskOption'
import { watchAssistantTasks } from '../../../../../utils/backends/Assistants/assistantsFirestore'
import { unwatch } from '../../../../../utils/backends/firestore'
import { getAssistantProjectId } from '../../../../AdminPanel/Assistants/assistantsHelper'

export default function PreConfigTasksArea({
    selectTask,
    closeModal,
    assistantId,
    projectId,
    onSelectBotOption,
    enableAssistantForObject,
    inMyDay,
}) {
    const [tasks, setTasks] = useState([])

    const tasksProjectId = getAssistantProjectId(assistantId, projectId)

    useEffect(() => {
        const watcherKey = v4()
        watchAssistantTasks(tasksProjectId, assistantId, watcherKey, setTasks)
        return () => {
            unwatch(watcherKey)
        }
    }, [assistantId, tasksProjectId])

    return (
        <View>
            {tasks.map(task => {
                return (
                    <PreConfigTaskOption
                        key={task.id}
                        task={task}
                        selectTask={selectTask}
                        onSelectBotOption={onSelectBotOption}
                        enableAssistantForObject={enableAssistantForObject}
                        closeModal={closeModal}
                        inMyDay={inMyDay}
                        projectId={projectId}
                        assistantId={assistantId}
                    />
                )
            })}
        </View>
    )
}
