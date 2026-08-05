import React, { useEffect, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'

import TaskCommentsTag from './TaskCommentsTag'
import { useSelector } from 'react-redux'
import RichCommentModal from '../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { STAYWARD_COMMENT } from '../Feeds/Utils/HelperFunctions'
import { popoverToTop, popoverToTopContainerStyle } from '../../utils/HelperFunctions'
import { RECORD_SCREEN_MODAL_ID, RECORD_VIDEO_MODAL_ID } from '../Feeds/CommentsTextInput/textInputHelper'
import {
    BOT_OPTION_MODAL_ID,
    BOT_WARNING_MODAL_ID,
    MENTION_MODAL_ID,
    RUN_OUT_OF_GOLD_MODAL_ID,
} from '../ModalsManager/modalsManager'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import useFloatPopupLock from '../../hooks/useFloatPopupLock'

export default function TaskCommentsWrapper({
    commentsData,
    projectId,
    objectId,
    subscribeClickObserver,
    unsubscribeClickObserver,
    disabled,
    inTextInput,
    objectType,
    inDetailView,
    userGettingKarmaId,
    tagStyle,
    outline,
    linkForNoteTopic,
    objectName,
    assistantId,
    compact,
}) {
    const openModals = useSelector(state => state.openModals)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const [showModal, setShowModal] = useState(false)
    const isUnmountedRef = useRef(false)
    const hideTimeoutRef = useRef(null)
    const popupLock = useFloatPopupLock()

    useEffect(() => {
        isUnmountedRef.current = false
        return () => {
            isUnmountedRef.current = true
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
        }
    }, [])

    const safeSetShowModal = value => {
        if (isUnmountedRef.current) {
            if (console && console.debug) {
                console.debug('[TaskCommentsWrapper] Ignored setShowModal on unmounted component', { value })
            }
            return
        }
        if (console && console.debug) {
            console.debug('[TaskCommentsWrapper] setShowModal', { value })
        }
        setShowModal(value)
    }

    const openModal = () => {
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
        }
        safeSetShowModal(true)
        popupLock.acquire()
        if (unsubscribeClickObserver) {
            unsubscribeClickObserver()
        }
    }
    const closeModal = () => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[RECORD_VIDEO_MODAL_ID] &&
            !openModals[RECORD_SCREEN_MODAL_ID] &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID]
        ) {
            safeSetShowModal(false)
            hideTimeoutRef.current = setTimeout(() => {
                hideTimeoutRef.current = null
                popupLock.release()
            })
            if (subscribeClickObserver) {
                subscribeClickObserver()
            }
        }
    }

    const addComment = async (comment, mentions2, isPrivate, hasKarma, explicitAssistantEnabled) => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID] &&
            comment
        ) {
            const clientSubmissionTime = Date.now()
            console.log('⏱️ [TIMING] CLIENT: TaskCommentsWrapper addComment called', {
                timestamp: new Date().toISOString(),
                submissionTime: clientSubmissionTime,
                projectId,
                objectType,
                objectId,
                assistantId,
                commentLength: comment?.length,
                explicitAssistantEnabled,
            })
            await createObjectMessage(
                projectId,
                objectId,
                comment,
                objectType,
                STAYWARD_COMMENT,
                null,
                null,
                false, // skipAssistantTrigger
                explicitAssistantEnabled
            )
            console.log('⏱️ [TIMING] CLIENT: TaskCommentsWrapper createObjectMessage completed', {
                timeSinceSubmission: `${Date.now() - clientSubmissionTime}ms`,
            })
            if (!assistantEnabled) closeModal()
        }
    }

    return showModal && !isUnmountedRef.current ? (
        <Popover
            content={
                <RichCommentModal
                    projectId={projectId}
                    objectType={objectType}
                    objectId={objectId}
                    closeModal={closeModal}
                    processDone={addComment}
                    userGettingKarmaId={userGettingKarmaId}
                    showBotButton={true}
                    objectName={objectName}
                    externalAssistantId={assistantId}
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
            <TaskCommentsTag
                commentsData={commentsData}
                isOpen={true}
                onOpen={openModal}
                onClose={closeModal}
                accessibilityLabel={'social-text-block'}
                disabled={disabled}
                inTextInput={inTextInput}
                inDetailView={inDetailView}
                style={tagStyle}
                outline={outline}
                compact={compact}
            />
        </Popover>
    ) : (
        <TaskCommentsTag
            commentsData={commentsData}
            isOpen={false}
            onOpen={openModal}
            onClose={closeModal}
            accessibilityLabel={'social-text-block'}
            disabled={disabled}
            inTextInput={inTextInput}
            inDetailView={inDetailView}
            style={tagStyle}
            outline={outline}
            compact={compact}
        />
    )
}
