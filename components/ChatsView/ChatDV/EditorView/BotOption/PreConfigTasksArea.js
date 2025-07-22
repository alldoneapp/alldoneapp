import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import PreConfigTaskOption from './PreConfigTaskOption'
import { watchAssistantTasks } from '../../../../../utils/backends/Assistants/assistantsFirestore'
import { unwatch } from '../../../../../utils/backends/firestore'
import { stopLoadingData } from '../../../../../redux/actions'
import { GLOBAL_PROJECT_ID } from '../../../../AdminPanel/Assistants/assistantsHelper'

export default function PreConfigTasksArea({
    selectTask,
    closeModal,
    assistantId,
    projectId,
    onSelectBotOption,
    inMyDay,
}) {
    const dispatch = useDispatch()
    const globalAssistants = useSelector(state => state.globalAssistants)
    const [tasks, setTasks] = useState([])

    const isGlobalAssistant = globalAssistants.find(item => item.uid === assistantId)
    const tasksProjectId = isGlobalAssistant ? GLOBAL_PROJECT_ID : projectId

    useEffect(() => {
        const watcherKey = v4()
        watchAssistantTasks(tasksProjectId, assistantId, watcherKey, setTasks)
        return () => {
            unwatch(watcherKey)
            dispatch(stopLoadingData())
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
                        closeModal={closeModal}
                        inMyDay={inMyDay}
                    />
                )
            })}
        </View>
    )
}
