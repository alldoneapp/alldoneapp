import React, { useEffect, useRef, useState } from 'react'
import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import { useDispatch, useSelector } from 'react-redux'

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
import LastAssistantComment from './LastAssistantComment'
import { cleanTextMetaData, removeFormatTagsFromText } from '../../../../functions/Utils/parseTextUtils'

export default function LastAssistantCommentWrapper({
    projectId,
    objectId,
    objectType,
    objectName,
    assistantId,
    commentText,
    isNew,
    unreadComments,
    isFollowedNotification,
    setAModalIsOpen,
    compact = false,
    arrivalId = null,
}) {
    const openModals = useSelector(state => state.openModals)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const [showModal, setShowModal] = useState(false)
    const isUnmountedRef = useRef(false)
    const dispatch = useDispatch()

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
        }
    }, [])

    const openModal = () => {
        if (!isUnmountedRef.current) {
            setAModalIsOpen?.(true)
            setShowModal(true)
            dispatch(showFloatPopup())
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
    }

    const addComment = async (comment, mentions, privacy, hasKarma, explicitAssistantEnabled) => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID] &&
            comment
        ) {
            await createObjectMessage(
                projectId,
                objectId,
                comment,
                objectType,
                STAYWARD_COMMENT,
                null,
                null,
                false,
                explicitAssistantEnabled
            )
            if (!assistantEnabled) closeModal()
        }
    }

    const parsedComment = cleanTextMetaData(removeFormatTagsFromText(commentText), true, true)
    const parsedObjectName = cleanTextMetaData(removeFormatTagsFromText(objectName), true)

    /**
     * Built ONCE and rendered from both branches on purpose.
     *
     * These used to be two hand-written copies of the same element, and AT-2511 shipped `arrivalId`
     * onto only one of them — the popover branch, which is open exactly when the user is typing a
     * reply and therefore never when a comment arrives. So the card was handed `null` in every case
     * that matters, its motion hook never armed, and the animation could not run for any user. The
     * suites stayed green because the one that renders this container mocks this component away, and
     * the one that renders the card passes `arrivalId` by hand.
     *
     * The duplication is what allowed that, so it is gone: a prop can no longer reach one branch and
     * not the other.
     */
    const card = (
        <LastAssistantComment
            isNew={isNew}
            unreadComments={unreadComments}
            isFollowedNotification={isFollowedNotification}
            onPress={openModal}
            commentText={parsedComment}
            objectName={parsedObjectName}
            projectId={projectId}
            compact={compact}
            arrivalId={arrivalId}
        />
    )

    return showModal ? (
        <AppPopover
            content={
                <RichCommentModal
                    projectId={projectId}
                    objectType={objectType}
                    objectId={objectId}
                    closeModal={closeModal}
                    processDone={addComment}
                    showBotButton={true}
                    objectName={objectName}
                    externalAssistantId={assistantId}
                    openedFromUnreadComment={isNew}
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
