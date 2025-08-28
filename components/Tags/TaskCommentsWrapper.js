import React, { useState } from 'react'
import Popover from 'react-tiny-popover'

import TaskCommentsTag from './TaskCommentsTag'
import { useDispatch, useSelector } from 'react-redux'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import RichCommentModal from '../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { STAYWARD_COMMENT } from '../Feeds/Utils/HelperFunctions'
import { popoverToTop } from '../../utils/HelperFunctions'
import { RECORD_SCREEN_MODAL_ID, RECORD_VIDEO_MODAL_ID } from '../Feeds/CommentsTextInput/textInputHelper'
import {
    BOT_OPTION_MODAL_ID,
    BOT_WARNING_MODAL_ID,
    MENTION_MODAL_ID,
    RUN_OUT_OF_GOLD_MODAL_ID,
} from '../ModalsManager/modalsManager'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'

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
}) {
    const openModals = useSelector(state => state.openModals)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const [showModal, setShowModal] = useState(false)
    const dispatch = useDispatch()

    const openModal = () => {
        setShowModal(true)
        dispatch(showFloatPopup())
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
            setShowModal(false)
            setTimeout(() => {
                dispatch(hideFloatPopup())
            })
            if (subscribeClickObserver) {
                subscribeClickObserver()
            }
        }
    }

    const addComment = async (comment, mentions2, isPrivate, hasKarma) => {
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

    return (
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
            isOpen={showModal}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            disableReposition={true}
            contentLocation={popoverToTop}
        >
            <TaskCommentsTag
                commentsData={commentsData}
                isOpen={showModal}
                onOpen={openModal}
                onClose={closeModal}
                accessibilityLabel={'social-text-block'}
                disabled={disabled}
                inTextInput={inTextInput}
                inDetailView={inDetailView}
                style={tagStyle}
                outline={outline}
            />
        </Popover>
    )
}
