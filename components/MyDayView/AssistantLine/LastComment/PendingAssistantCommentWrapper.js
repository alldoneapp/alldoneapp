import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import RichCommentModal from '../../../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { STAYWARD_COMMENT } from '../../../Feeds/Utils/HelperFunctions'
import { popoverToTop, popoverToTopContainerStyle } from '../../../../utils/HelperFunctions'
import { RECORD_SCREEN_MODAL_ID, RECORD_VIDEO_MODAL_ID } from '../../../Feeds/CommentsTextInput/textInputHelper'
import {
    BOT_OPTION_MODAL_ID,
    BOT_WARNING_MODAL_ID,
    MENTION_MODAL_ID,
    RUN_OUT_OF_GOLD_MODAL_ID,
} from '../../../ModalsManager/modalsManager'
import { createObjectMessage } from '../../../../utils/backends/Chats/chatsComments'
import PendingAssistantComment from './PendingAssistantComment'
import { PENDING_SEND_FAILED } from '../assistantLinePendingSend'

/**
 * AT-2523 — the pending Last comment card, made into a door.
 *
 * Until now the card that appears the instant you press Enter (AT-2504) was inert: it said a
 * message had gone off and gave you no way to follow it. It opens the same `RichCommentModal`
 * popover a real last comment opens, on the thread the message created — so "the newest thing in
 * this slot" behaves the same way whether the assistant has answered yet or not.
 *
 * ## The window where there is no thread to open
 *
 * `createBotQuickTopic` is two round trips — the `createBotQuickTopicSecondGen` callable, then the
 * `createObjectMessage` write — so for roughly a second after Enter the send has no `chatId` at
 * all. Three things could have been done with a tap in that window, and two of them are bad: doing
 * nothing makes the card look broken exactly when the user is most likely to press it, and
 * navigating optimistically asks the Chat DV to open a document that is not in Firestore yet.
 *
 * So the tap is ARMED. `openRequested` remembers it, the card switches to its "Opening the thread…"
 * state, and the effect below opens the popover the moment the id lands — which is usually before
 * the user has finished registering that they tapped. Nothing is queued behind a promise: the arm
 * is a boolean and the release is driven by the same `pending` prop the card already re-renders on,
 * so there is no callback to leak and nothing to clean up if the card goes away first.
 *
 * Bounded by the two things that end a send: a failure clears the arm (there is no thread to open,
 * and the card is already saying so), and the entry's own expiry unmounts this component. Neither
 * can leave a spinner nobody clears — the rule `assistantLinePendingSend.js` was written to.
 */
export default function PendingAssistantCommentWrapper({
    pending,
    assistantName,
    compact = false,
    scopeKey = null,
    setAModalIsOpen,
}) {
    const openModals = useSelector(state => state.openModals)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const [showModal, setShowModal] = useState(false)
    const [openRequested, setOpenRequested] = useState(false)
    const isUnmountedRef = useRef(false)
    const dispatch = useDispatch()

    const projectId = pending?.projectId || null
    const chatId = pending?.chatId || null
    const hasFailed = pending?.status === PENDING_SEND_FAILED

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
        }
    }, [])

    const openModal = useCallback(() => {
        if (isUnmountedRef.current) return
        setAModalIsOpen?.(true)
        setShowModal(true)
        dispatch(showFloatPopup())
    }, [dispatch, setAModalIsOpen])

    const handlePress = useCallback(() => {
        // A failed send has no thread behind it. The card is already explaining itself, so a tap is
        // deliberately inert rather than opening something misleading.
        if (hasFailed) return
        if (chatId && projectId) {
            openModal()
            return
        }
        // The topic is still being created. Remember the intent and say so.
        setOpenRequested(true)
    }, [chatId, projectId, hasFailed, openModal])

    // Release the armed tap. Runs on the `pending` change that carries the id rather than from a
    // promise chain in `handlePress`, so a tap made before the send resolves and a tap made after
    // it take exactly the same path.
    useEffect(() => {
        if (!openRequested) return
        if (hasFailed) {
            setOpenRequested(false)
            return
        }
        if (!chatId || !projectId) return
        setOpenRequested(false)
        openModal()
    }, [openRequested, chatId, projectId, hasFailed, openModal])

    const closeModal = useCallback(() => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[RECORD_VIDEO_MODAL_ID] &&
            !openModals[RECORD_SCREEN_MODAL_ID] &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID]
        ) {
            if (setAModalIsOpen) {
                setTimeout(() => {
                    if (!isUnmountedRef.current) setAModalIsOpen(false)
                }, 400)
            }

            if (!isUnmountedRef.current) setShowModal(false)
            setTimeout(() => {
                if (!isUnmountedRef.current) dispatch(hideFloatPopup())
            })
        }
    }, [isQuillTagEditorOpen, openModals, setAModalIsOpen, dispatch])

    const addComment = async (comment, mentions, privacy, hasKarma, explicitAssistantEnabled) => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID] &&
            comment &&
            projectId &&
            chatId
        ) {
            await createObjectMessage(
                projectId,
                chatId,
                comment,
                'topics',
                STAYWARD_COMMENT,
                null,
                null,
                false,
                explicitAssistantEnabled
            )
            if (!assistantEnabled) closeModal()
        }
    }

    // Built once and rendered from both branches, the AT-2511 lesson: two hand-written copies of
    // the same element is how a prop came to reach one of them and not the other.
    const card = (
        <PendingAssistantComment
            pending={pending}
            assistantName={assistantName}
            compact={compact}
            scopeKey={scopeKey}
            onPress={hasFailed ? null : handlePress}
            opening={openRequested}
        />
    )

    return showModal ? (
        <AppPopover
            content={
                <RichCommentModal
                    projectId={projectId}
                    objectType={'topics'}
                    objectId={chatId}
                    closeModal={closeModal}
                    processDone={addComment}
                    showBotButton={true}
                    objectName={pending?.chatTitle || ''}
                    externalAssistantId={pending?.assistantId}
                />
            }
            onClickOutside={closeModal}
            isOpen={true}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            disableReposition={true}
            contentLocation={popoverToTop}
            containerStyle={popoverToTopContainerStyle}
        >
            {card}
        </AppPopover>
    ) : (
        card
    )
}
