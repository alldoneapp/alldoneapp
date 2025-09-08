import React, { useEffect, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import RichCommentModal from '../../../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { STAYWARD_COMMENT } from '../../../Feeds/Utils/HelperFunctions'
import { popoverToTop } from '../../../../utils/HelperFunctions'
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
    setAModalIsOpen,
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

    const addComment = async comment => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID] &&
            comment
        ) {
            await createObjectMessage(projectId, objectId, comment, objectType, STAYWARD_COMMENT, null, null)
            if (!assistantEnabled) closeModal()
        }
    }

    const parsedComment = cleanTextMetaData(removeFormatTagsFromText(commentText), true)

    return showModal ? (
        <Popover
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
                />
            }
            onClickOutside={closeModal}
            isOpen={true}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            disableReposition={true}
            contentLocation={popoverToTop}
        >
            <LastAssistantComment
                isNew={isNew}
                onPress={openModal}
                commentText={parsedComment}
                objectName={objectName}
                projectId={projectId}
            />
        </Popover>
    ) : (
        <LastAssistantComment
            isNew={isNew}
            onPress={openModal}
            commentText={parsedComment}
            objectName={objectName}
            projectId={projectId}
        />
    )
}
