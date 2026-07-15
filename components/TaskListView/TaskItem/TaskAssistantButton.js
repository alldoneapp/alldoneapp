import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import { CONFIRM_POPUP_TRIGGER_INFO } from '../../UIComponents/ConfirmPopup'
import { setAssistantEnabled, setSelectedNavItem, setTriggerChatDraft, showConfirmPopup } from '../../../redux/actions'
import { setTaskAssistant } from '../../../utils/backends/Tasks/tasksFirestore'
import { setObjectAssistantEnabled } from '../../../utils/assistantHelper'
import { resolveDefaultAssistantForProject } from '../../AdminPanel/Assistants/assistantsHelper'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_TASK_CHAT } from '../../../utils/TabNavigationConstants'

const TASK_START_PROMPT = 'Start working on this task. Feel free to ask questions is anything is unclear'
const EMAIL_REPLY_PROMPT = 'Draft a reply to this email in the same language as the email with the following content: '

export default function TaskAssistantButton({ projectId, task, disabled, dismissEditMode }) {
    const dispatch = useDispatch()
    const defaultAssistantId = useSelector(state => state.defaultAssistant?.uid || '')
    const isEmailTask = !!task?.gmailData

    // Resolve the assistant that should work on this task without asking the user to pick one.
    // Preference order: an assistant already assigned to the task, then the task project's
    // default assistant, and finally the overall/global default assistant as a fallback.
    const resolveAssistantId = () => {
        if (task?.assistantId) return task.assistantId

        const projectDefaultAssistant = resolveDefaultAssistantForProject(projectId)
        if (projectDefaultAssistant?.uid) return projectDefaultAssistant.uid

        return defaultAssistantId || ''
    }

    const showNoAssistantError = () => {
        dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_INFO,
                object: {
                    headerText: 'No assistant available',
                    headerQuestion:
                        'This project has no default assistant yet, and no global default is set. Add an assistant before letting it work on your tasks.',
                },
            })
        )
    }

    const startAssistant = async promptText => {
        const assistantId = resolveAssistantId()
        dismissEditMode?.()

        if (!assistantId) {
            showNoAssistantError()
            return
        }

        const updatedTask = { ...task, assistantId, isAssistantEnabled: true }

        try {
            await Promise.all([
                task.assistantId !== assistantId
                    ? setTaskAssistant(projectId, task.id, assistantId, !!task.assistantId)
                    : Promise.resolve(),
                setObjectAssistantEnabled(projectId, task.id, 'tasks', true),
            ])
        } catch (error) {
            console.error('Error activating assistant for task:', error)
        }

        NavigationService.navigate('TaskDetailedView', {
            task: updatedTask,
            projectId,
            assistantId,
        })
        dispatch([
            setSelectedNavItem(DV_TAB_TASK_CHAT),
            setAssistantEnabled(true),
            setTriggerChatDraft({ text: promptText, chatId: task.id }),
        ])
    }

    // Pressing the bot button no longer opens an assistant picker: it immediately starts the
    // resolved default assistant on the task. The explicit assistant picker still lives in the
    // task chat / other flows for users who want to switch the assistant on purpose.
    const onPressBotButton = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        if (disabled) return
        startAssistant(isEmailTask ? EMAIL_REPLY_PROMPT : TASK_START_PROMPT)
    }

    return (
        <View style={localStyles.container}>
            <Hotkeys keyName={'alt+a'} onKeyDown={onPressBotButton} filter={e => true}>
                <TouchableOpacity
                    style={localStyles.button}
                    activeOpacity={0.7}
                    onPress={onPressBotButton}
                    disabled={disabled}
                    accessibilityLabel={
                        isEmailTask ? 'Draft an email reply for this task' : 'Start the default assistant on this task'
                    }
                >
                    <Icon name="cpu" size={20} color={disabled ? colors.Text03 : colors.Primary100} />
                </TouchableOpacity>
            </Hotkeys>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        zIndex: 10,
    },
    button: {
        width: 24,
        height: 24,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Primary050,
    },
})
