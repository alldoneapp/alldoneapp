import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'

import AppPopover from '../UIComponents/ModalShell/AppPopover'
import RichCommentModal from '../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { popoverToTop, popoverToTopContainerStyle } from '../../utils/HelperFunctions'
import useFloatPopupLock from '../../hooks/useFloatPopupLock'
import { RECORD_SCREEN_MODAL_ID, RECORD_VIDEO_MODAL_ID } from '../Feeds/CommentsTextInput/textInputHelper'
import {
    BOT_OPTION_MODAL_ID,
    BOT_WARNING_MODAL_ID,
    MENTION_MODAL_ID,
    RUN_OUT_OF_GOLD_MODAL_ID,
} from '../ModalsManager/modalsManager'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'

// The artifact's chat in the comment popup every other object uses (AT-2888): the same
// RichCommentModal, placement and dismissal as a goal's or a task's comment button, on the
// artifact's own `artifacts` thread. `renderTrigger({ open, isOpen })` draws the button.
export default function ArtifactCommentsPopup({ projectId, artifact, renderTrigger }) {
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const [isOpen, setIsOpen] = useState(false)
    const popupLock = useFloatPopupLock()
    const mountedRef = useRef(true)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    useEffect(() => {
        setIsOpen(false)
        popupLock.release()
    }, [artifact.id])

    // A nested popup of the composer (mentions, assistant options, recording) owns the click.
    const nestedPopupIsOpen =
        isQuillTagEditorOpen ||
        !!openModals?.[RECORD_VIDEO_MODAL_ID] ||
        !!openModals?.[RECORD_SCREEN_MODAL_ID] ||
        !!openModals?.[MENTION_MODAL_ID] ||
        !!openModals?.[BOT_OPTION_MODAL_ID] ||
        !!openModals?.[RUN_OUT_OF_GOLD_MODAL_ID] ||
        !!openModals?.[BOT_WARNING_MODAL_ID]

    const open = () => {
        if (isOpen) return
        setIsOpen(true)
        popupLock.acquire()
    }

    const close = () => {
        if (!mountedRef.current || nestedPopupIsOpen) return
        setIsOpen(false)
        popupLock.release()
    }

    // RichCommentModal closes itself after a send that does not wait for the assistant.
    const addComment = async (comment, mentions, isPrivate, hasKarma, explicitAssistantEnabled) => {
        if (!comment || nestedPopupIsOpen) return
        await createObjectMessage(
            projectId,
            artifact.id,
            comment,
            'artifacts',
            null,
            null,
            null,
            false,
            explicitAssistantEnabled
        )
    }

    const trigger = renderTrigger({ open, isOpen })
    if (!isOpen) return trigger

    return (
        <AppPopover
            content={
                <RichCommentModal
                    projectId={projectId}
                    objectType="artifacts"
                    objectId={artifact.id}
                    closeModal={close}
                    processDone={addComment}
                    currentMentions={[]}
                    userGettingKarmaId=""
                    showBotButton={true}
                    objectName={artifact.title}
                    initialObject={artifact}
                    externalAssistantId={artifact.assistantId}
                />
            }
            onClickOutside={close}
            isOpen={isOpen}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            disableReposition={true}
            contentLocation={popoverToTop}
            containerStyle={popoverToTopContainerStyle}
        >
            {trigger}
        </AppPopover>
    )
}
