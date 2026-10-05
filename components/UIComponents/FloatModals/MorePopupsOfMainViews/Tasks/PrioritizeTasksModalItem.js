import React, { useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import { useProjectAssistantLine } from '../../../../MyDayView/AssistantLine/useAssistantLineSwitch'
import { getAssistantFromState } from '../../../../AdminPanel/Assistants/assistantStateLookup'
import { createBotQuickTopic } from '../../../../../utils/assistantHelper'
import SharedHelper from '../../../../../utils/SharedHelper'
import { translate } from '../../../../../i18n/TranslationService'
import styles, { colors } from '../../../../styles/global'

export default function PrioritizeTasksModalItem({ projectId, shortcut, onPress, onRunOutOfGold }) {
    const project = useSelector(state => state.loggedUserProjectsMap?.[projectId])
    const loggedUser = useSelector(state => state.loggedUser)
    const defaultAssistant = useSelector(state => state.defaultAssistant)
    const { assistantLineProps } = useProjectAssistantLine(project)
    const assistantId = assistantLineProps.preferAssistantIdOverride
        ? assistantLineProps.assistantIdOverride
        : project?.assistantId || assistantLineProps.assistantIdOverride
    const projectAssistant = useSelector(state => getAssistantFromState(state, assistantId))
    const assistant = projectId ? projectAssistant : defaultAssistant
    // Explicitly keep the conversation in the clicked project even when its assistant belongs
    // to the default project. All Projects speaks from the default project's conversation.
    const conversationProjectId = projectId || loggedUser.defaultProjectId
    const accessGranted = SharedHelper.accessGranted(loggedUser, conversationProjectId)
    const [starting, setStarting] = useState(false)
    const [failed, setFailed] = useState(false)
    const startingRef = useRef(false)
    const mountedRef = useRef(true)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    const disabled = starting || !assistant?.uid || !accessGranted || (!!projectId && !project)

    const prioritize = async event => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        if (disabled || startingRef.current) return
        if (loggedUser.gold <= 0) {
            onRunOutOfGold()
            return
        }

        startingRef.current = true
        setStarting(true)
        setFailed(false)
        const prompt = projectId
            ? translate('Prioritize tasks project prompt', { projectName: project.name })
            : translate('Prioritize tasks all projects prompt')
        try {
            const topic = await createBotQuickTopic(assistant, prompt, {
                projectId: conversationProjectId,
                enableAssistant: true,
            })
            if (!topic) throw new Error('The prioritization chat could not be created')
            onPress()
        } catch (error) {
            console.error('Could not start task prioritization chat:', error)
            if (mountedRef.current) setFailed(true)
        } finally {
            startingRef.current = false
            if (mountedRef.current) setStarting(false)
        }
    }

    return (
        <View>
            <ModalItem
                icon="flag"
                text={starting ? 'Starting' : 'Prioritize tasks'}
                shortcut={shortcut}
                onPress={prioritize}
                disabled={disabled}
            />
            {failed && (
                <Text accessibilityRole="alert" style={[styles.body2, { color: colors.Text03 }]}>
                    {translate('Could not start task prioritization chat. Please try again.')}
                </Text>
            )}
        </View>
    )
}
