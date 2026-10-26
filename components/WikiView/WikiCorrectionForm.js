import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Button from '../UIControls/Button'
import CustomScrollView from '../UIControls/CustomScrollView'
import ModalHeader from '../UIComponents/FloatModals/ModalHeader'
import useModalSizing from '../../hooks/useModalSizing'
import { useModalShellPresentation } from '../UIComponents/ModalShell/ModalShellContext'
import { translate } from '../../i18n/TranslationService'
import { useProjectAssistantLine } from '../MyDayView/AssistantLine/useAssistantLineSwitch'
import { getAssistantFromState } from '../AdminPanel/Assistants/assistantStateLookup'
import { createBotQuickTopic } from '../../utils/assistantHelper'

const CORRECTION_MAX_CHARS = 2000

// A correction goes through the project's assistant rather than an edit box: it reads the page,
// applies exactly what the member said with correct_knowledge_page and keeps the correction as a
// source, so the next wiki update cannot undo it. This only starts that conversation.
//
// Rendered as the app's standard float modal (AT-2874): dark card, ModalHeader with title and ×
// (which also owns Escape), and one primary action. WikiFeedbackButton opens it through
// AppPopover, so it is centred on desktop and becomes a bottom sheet on mobile.
export default function WikiCorrectionForm({ projectId, page, onClose }) {
    const project = useSelector(state => state.loggedUserProjectsMap?.[projectId])
    const gold = useSelector(state => state.loggedUser.gold)
    const { assistantLineProps } = useProjectAssistantLine(project)
    const assistantId = assistantLineProps.preferAssistantIdOverride
        ? assistantLineProps.assistantIdOverride
        : project?.assistantId || assistantLineProps.assistantIdOverride
    const assistant = useSelector(state => getAssistantFromState(state, assistantId))
    const { width, maxHeight } = useModalSizing()
    const inSheet = useModalShellPresentation() === 'sheet'
    const [text, setText] = useState('')
    const [state, setState] = useState(null)
    const mountedRef = useRef(true)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    const correction = text.trim()
    const sending = state === 'sending'

    const send = async () => {
        if (!correction || sending || !assistant?.uid) return
        if (!(gold > 0)) {
            setState('noGold')
            return
        }
        setState('sending')
        try {
            const topic = await createBotQuickTopic(
                assistant,
                translate('Wiki correction prompt', { title: page.title, slug: page.slug, correction }),
                { projectId, enableAssistant: true }
            )
            if (!topic) throw new Error('The correction chat could not be created')
            if (mountedRef.current) onClose()
        } catch (error) {
            console.error('Could not start the wiki correction chat:', error)
            if (mountedRef.current) setState('failed')
        }
    }

    const close = () => {
        if (!sending) onClose()
    }

    return (
        <View
            testID="wiki-correction-form"
            style={[localStyles.container, inSheet ? localStyles.containerInSheet : { width }, { maxHeight }]}
        >
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader
                    closeModal={close}
                    title={translate('Give feedback')}
                    description={translate('Wiki correction hint')}
                />
                <TextInput
                    testID="wiki-correction-input"
                    style={localStyles.input}
                    value={text}
                    onChangeText={setText}
                    multiline
                    autoFocus
                    maxLength={CORRECTION_MAX_CHARS}
                    placeholder={translate('Wiki correction placeholder')}
                    placeholderTextColor={colors.Text03}
                    textAlignVertical={'top'}
                    editable={!sending}
                    accessible={false}
                />
                {state === 'noGold' && <Text style={localStyles.error}>{translate('Not enough Gold')}</Text>}
                {state === 'failed' && (
                    <Text style={localStyles.error}>{translate('Could not start the correction chat')}</Text>
                )}
                {!assistant?.uid && <Text style={localStyles.error}>{translate('This project has no assistant')}</Text>}
                <View style={localStyles.actions}>
                    <Button
                        type={'primary'}
                        title={translate(sending ? 'Starting' : 'Send to assistant')}
                        icon={'send'}
                        onPress={send}
                        disabled={!correction || sending || !assistant?.uid}
                    />
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    containerInSheet: {
        width: '100%',
        boxShadow: 'none',
        elevation: 0,
    },
    scroll: {
        padding: 16,
    },
    input: {
        ...styles.body1,
        minHeight: 96,
        color: '#ffffff',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
    },
    error: {
        ...styles.caption2,
        color: colors.UtilityRed200,
        marginTop: 6,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
})
