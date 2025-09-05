import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import { watchAssistantTasks } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { unwatch } from '../../../../utils/backends/firestore'
import { stopLoadingData } from '../../../../redux/actions'
import { getAssistantLineData, getOptionsPresentationData } from './helper'
import OptionButtons from './OptionButtons/OptionButtons'
import MoreOptionsWrapper from './MoreOptions/MoreOptionsWrapper'
import AssistantAvatarButton from './AssistantAvatarButton'
import { GLOBAL_PROJECT_ID, isGlobalAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'

export default function AssistantOptions({ amountOfButtonOptions }) {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProject = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const defaultAssistantId = useSelector(state => state.defaultAssistant.uid)
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const [tasks, setTasks] = useState(null)

    const { assistant, assistantProject, assistantProjectId } = getAssistantLineData(
        selectedProject,
        defaultAssistantId,
        defaultProjectId
    )

    useEffect(() => {
        if (assistantProjectId && assistant && assistant.uid) {
            const watcherKey = v4()
            watchAssistantTasks(
                isGlobalAssistant(assistant.uid) ? GLOBAL_PROJECT_ID : assistantProjectId,
                assistant.uid,
                watcherKey,
                setTasks
            )
            return () => {
                unwatch(watcherKey)
                dispatch(stopLoadingData())
            }
        } else {
            setTasks(null)
        }
    }, [assistant?.uid, assistantProjectId])

    if (!tasks || !assistant || !assistant.uid) return null

    const { optionsLikeButtons, optionsInModal, showSubmenu } = getOptionsPresentationData(
        assistantProject,
        assistant.uid,
        tasks,
        amountOfButtonOptions
    )

    return (
        <View style={localStyles.container}>
            <AssistantAvatarButton projectIndex={assistantProject.index} assistant={assistant} />
            <OptionButtons projectId={assistantProject.id} options={optionsLikeButtons} assistant={assistant} />
            {showSubmenu && (
                <MoreOptionsWrapper projectId={assistantProject.id} options={optionsInModal} assistant={assistant} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        marginTop: 10,
        position: 'absolute',
        right: 16,
        bottom: 14,
        alignItems: 'center',
    },
})
