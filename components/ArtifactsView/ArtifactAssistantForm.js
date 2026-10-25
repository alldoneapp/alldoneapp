import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Button from '../UIControls/Button'
import { translate } from '../../i18n/TranslationService'
import { useProjectAssistantLine } from '../MyDayView/AssistantLine/useAssistantLineSwitch'
import { getAssistantFromState } from '../AdminPanel/Assistants/assistantStateLookup'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import { setTriggerBotSpinner } from '../../redux/actions'
import { buildBotSpinnerTrigger } from '../ChatsView/Utils/botSpinnerTrigger'
import { ARTIFACT_TOOL_KEY } from '../../functions/Artifacts/artifactToolSchemas'

const REQUEST_MAX_CHARS = 2000

// An artifact changes by being rewritten, and the assistant is the one that rewrites it: it reads the
// artifact and saves the change as a new version with update_artifact. The request is posted into
// the artifact's own chat, so the conversation stays with the artifact and the assistant gets it as
// context; the caller then shows that chat.
export function canAssistantEditArtifacts(assistant) {
    // Unknown means "let the chat try": only a known tool list that lacks the key is a definite no.
    return !Array.isArray(assistant?.allowedTools) || assistant.allowedTools.includes(ARTIFACT_TOOL_KEY)
}

export default function ArtifactAssistantForm({ projectId, artifact, onClose, onSent }) {
    const dispatch = useDispatch()
    const project = useSelector(state => state.loggedUserProjectsMap?.[projectId])
    const gold = useSelector(state => state.loggedUser.gold)
    const { assistantLineProps } = useProjectAssistantLine(project)
    const projectAssistantId = assistantLineProps.preferAssistantIdOverride
        ? assistantLineProps.assistantIdOverride
        : project?.assistantId || assistantLineProps.assistantIdOverride
    // The assistant chosen for the artifact's chat answers there; otherwise the project's.
    const chatAssistant = useSelector(state =>
        artifact.assistantId ? getAssistantFromState(state, artifact.assistantId) : null
    )
    const projectAssistant = useSelector(state => getAssistantFromState(state, projectAssistantId))
    const assistant = chatAssistant?.uid ? chatAssistant : projectAssistant
    const [text, setText] = useState('')
    const [state, setState] = useState(null)
    const mountedRef = useRef(true)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    const request = text.trim()
    const sending = state === 'sending'
    const hasAssistant = !!assistant?.uid
    const canEdit = hasAssistant && canAssistantEditArtifacts(assistant)

    const send = async () => {
        if (!request || sending || !canEdit) return
        if (!(gold > 0)) {
            setState('noGold')
            return
        }
        setState('sending')
        try {
            dispatch(setTriggerBotSpinner(buildBotSpinnerTrigger(projectId, artifact.id)))
            // Resolves once the comment is saved locally; delivery and the assistant run follow.
            await createObjectMessage(
                projectId,
                artifact.id,
                request,
                'artifacts',
                null,
                null,
                null,
                false,
                true,
                assistant.uid
            )
            if (mountedRef.current) (onSent || onClose)()
        } catch (error) {
            dispatch(setTriggerBotSpinner(null))
            console.error('Could not start the artifact chat:', error)
            if (mountedRef.current) setState('failed')
        }
    }

    return (
        <View testID="artifact-assistant-form" style={localStyles.container}>
            <Text style={localStyles.hint}>{translate('Artifact change hint')}</Text>
            <TextInput
                testID="artifact-assistant-input"
                style={localStyles.input}
                value={text}
                onChangeText={setText}
                multiline
                autoFocus
                maxLength={REQUEST_MAX_CHARS}
                placeholder={translate('Artifact change placeholder')}
                placeholderTextColor={colors.Text03}
                editable={!sending}
                accessible={false}
            />
            {state === 'noGold' && <Text style={localStyles.error}>{translate('Not enough Gold')}</Text>}
            {state === 'failed' && (
                <Text style={localStyles.error}>{translate('Could not start the artifact chat')}</Text>
            )}
            {!hasAssistant && <Text style={localStyles.error}>{translate('This project has no assistant')}</Text>}
            {hasAssistant && !canEdit && (
                <Text testID="artifact-assistant-missing-tool" style={localStyles.error}>
                    {translate('Assistant cannot edit artifacts', { name: assistant.displayName || '' })}
                </Text>
            )}
            <View style={localStyles.actions}>
                <Button type={'ghost'} title={translate('Cancel')} onPress={onClose} disabled={sending} />
                <Button
                    title={translate('Send to assistant')}
                    icon={'send'}
                    onPress={send}
                    disabled={!request || sending || !canEdit}
                    buttonStyle={localStyles.sendButton}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 4,
        marginBottom: 8,
        padding: 12,
        borderRadius: 4,
        backgroundColor: colors.Grey100,
        maxWidth: 720,
    },
    hint: {
        ...styles.body2,
        color: colors.Text02,
        marginBottom: 8,
    },
    input: {
        ...styles.body1,
        minHeight: 72,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        padding: 8,
        color: colors.Text01,
        backgroundColor: 'white',
    },
    error: {
        ...styles.caption2,
        color: colors.UtilityRed200,
        marginTop: 6,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        marginTop: 8,
    },
    sendButton: {
        marginLeft: 8,
    },
})
