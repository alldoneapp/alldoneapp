import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import { CONFIRM_POPUP_TRIGGER_INFO } from '../../UIComponents/ConfirmPopup'
import RichCommentModal from '../../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { hideFloatPopup, showConfirmPopup, showFloatPopup } from '../../../redux/actions'
import { setTaskAssistant } from '../../../utils/backends/Tasks/tasksFirestore'
import { setObjectAssistantEnabled } from '../../../utils/assistantHelper'
import { resolveAssistantForProjectObject } from '../../AdminPanel/Assistants/assistantsHelper'
import { createObjectMessage } from '../../../utils/backends/Chats/chatsComments'
import { STAYWARD_COMMENT } from '../../Feeds/Utils/HelperFunctions'
import { popoverToTop } from '../../../utils/HelperFunctions'
import {
    BOT_OPTION_MODAL_ID,
    BOT_WARNING_MODAL_ID,
    MENTION_MODAL_ID,
    RUN_OUT_OF_GOLD_MODAL_ID,
} from '../../ModalsManager/modalsManager'
import { RECORD_SCREEN_MODAL_ID, RECORD_VIDEO_MODAL_ID } from '../../Feeds/CommentsTextInput/textInputHelper'

const TASK_START_PROMPT = 'Start working on this task. Feel free to ask questions is anything is unclear'
const EMAIL_REPLY_PROMPT = 'Draft a reply to this email in the same language as the email with the following content: '

export default function TaskAssistantButton({ projectId, task, disabled }) {
    const dispatch = useDispatch()
    const openModals = useSelector(state => state.openModals)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const [isOpen, setIsOpen] = useState(false)
    const [activeAssistantId, setActiveAssistantId] = useState(task?.assistantId || '')
    const isOpenRef = useRef(false)
    const isEmailTask = !!task?.gmailData

    const resolveAssistantId = () => resolveAssistantForProjectObject(projectId, task?.assistantId)?.uid || ''

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

    const openCommentModal = assistantId => {
        setActiveAssistantId(assistantId)
        isOpenRef.current = true
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeCommentModal = () => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[RECORD_VIDEO_MODAL_ID] &&
            !openModals[RECORD_SCREEN_MODAL_ID] &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID]
        ) {
            isOpenRef.current = false
            setIsOpen(false)
            setTimeout(() => dispatch(hideFloatPopup()))
        }
    }

    const startAssistant = async () => {
        const assistantId = resolveAssistantId()

        if (!assistantId) {
            showNoAssistantError()
            return
        }

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

        // Keep the edit row mounted: it owns the popover anchor on both mobile and desktop.
        openCommentModal(assistantId)
    }

    const addComment = async (comment, mentions, isPrivate, hasKarma, explicitAssistantEnabled) => {
        if (!comment) return

        await createObjectMessage(
            projectId,
            task.id,
            comment,
            'tasks',
            STAYWARD_COMMENT,
            null,
            null,
            false,
            explicitAssistantEnabled
        )
    }

    useEffect(() => {
        return () => {
            if (isOpenRef.current) dispatch(hideFloatPopup())
        }
    }, [])

    // Pressing the bot button no longer opens an assistant picker: it immediately starts the
    // resolved default assistant on the task. The explicit assistant picker still lives in the
    // task chat / other flows for users who want to switch the assistant on purpose.
    const onPressBotButton = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        if (disabled) return
        startAssistant()
    }

    return (
        <View style={localStyles.container}>
            <Popover
                content={
                    <RichCommentModal
                        projectId={projectId}
                        objectType="tasks"
                        objectId={task.id}
                        closeModal={closeCommentModal}
                        processDone={addComment}
                        currentComment={isEmailTask ? EMAIL_REPLY_PROMPT : TASK_START_PROMPT}
                        currentMentions={[]}
                        userGettingKarmaId={task.userId}
                        showBotButton={true}
                        objectName={task.name}
                        externalAssistantId={activeAssistantId}
                        initialAssistantEnabled={true}
                    />
                }
                onClickOutside={closeCommentModal}
                isOpen={isOpen}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align="end"
                disableReposition={true}
                contentLocation={popoverToTop}
            >
                <Hotkeys keyName={'alt+a'} onKeyDown={onPressBotButton} filter={e => true}>
                    <TouchableOpacity
                        style={localStyles.button}
                        activeOpacity={0.7}
                        onPress={onPressBotButton}
                        disabled={disabled}
                        accessibilityLabel={
                            isEmailTask
                                ? 'Draft an email reply for this task'
                                : 'Start the default assistant on this task'
                        }
                    >
                        <Icon name="cpu" size={20} color={disabled ? colors.Text03 : colors.Primary100} />
                    </TouchableOpacity>
                </Hotkeys>
            </Popover>
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
