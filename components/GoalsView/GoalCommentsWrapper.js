import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import ObjectCommentsTag from '../Tags/ObjectCommentsTag'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import RichCommentModal from '../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { popoverToTop } from '../../utils/HelperFunctions'
import {
    BOT_OPTION_MODAL_ID,
    BOT_WARNING_MODAL_ID,
    MENTION_MODAL_ID,
    RUN_OUT_OF_GOLD_MODAL_ID,
} from '../ModalsManager/modalsManager'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'

export default function GoalCommentsWrapper({ commentsData, projectId, goal, tagStyle, disabled = false }) {
    const openModals = useSelector(state => state.openModals)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const [showModal, setShowModal] = useState(false)
    const dispatch = useDispatch()

    const openModal = () => {
        setShowModal(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID]
        ) {
            setShowModal(false)
            dispatch(hideFloatPopup())
        }
    }

    const addComment = async (comment, mentions, isPrivate, hasKarma) => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID] &&
            comment
        ) {
            createObjectMessage(projectId, goal.id, comment, 'goals', null, null, null)

            if (!assistantEnabled) closeModal()
        }
    }

    return (
        <Popover
            content={
                <RichCommentModal
                    projectId={projectId}
                    objectType="goals"
                    objectId={goal.id}
                    closeModal={closeModal}
                    processDone={addComment}
                    userGettingKarmaId=""
                    showBotButton={true}
                    objectName={goal.name}
                    externalAssistantId={goal.assistantId}
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
            <ObjectCommentsTag
                commentsData={commentsData}
                isOpen={showModal}
                onOpen={openModal}
                onClose={closeModal}
                accessibilityLabel={'social-text-block'}
                style={tagStyle}
                disabled={disabled}
            />
        </Popover>
    )
}
