import React, { useState, useEffect } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import ObjectCommentsTag from '../../../Tags/ObjectCommentsTag'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import RichCommentModal from '../../../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { popoverToTop } from '../../../../utils/HelperFunctions'
import {
    BOT_OPTION_MODAL_ID,
    BOT_WARNING_MODAL_ID,
    MENTION_MODAL_ID,
    RUN_OUT_OF_GOLD_MODAL_ID,
} from '../../../ModalsManager/modalsManager'
import { createObjectMessage } from '../../../../utils/backends/Chats/chatsComments'

export default function CommentWrapperTag({
    projectId,
    skillId,
    disabled,
    userGettingKarmaId,
    skillName,
    assistantId,
    commentsData,
}) {
    const dispatch = useDispatch()
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const isMentionModalOpen = useSelector(state => state.openModals[MENTION_MODAL_ID])
    const isBotOptionModalOpen = useSelector(state => state.openModals[BOT_OPTION_MODAL_ID])
    const isRunOutOfGoldModalOpen = useSelector(state => state.openModals[RUN_OUT_OF_GOLD_MODAL_ID])
    const isBotWarningModalOpen = useSelector(state => state.openModals[BOT_WARNING_MODAL_ID])
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const [showModal, setShowModal] = useState(false)

    const openModal = () => {
        setShowModal(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        if (
            !isQuillTagEditorOpen &&
            !isMentionModalOpen &&
            !isBotOptionModalOpen &&
            !isRunOutOfGoldModalOpen &&
            !isBotWarningModalOpen
        ) {
            setShowModal(false)
            dispatch(hideFloatPopup())
        }
    }

    const addComment = async comment => {
        if (
            !isQuillTagEditorOpen &&
            !isMentionModalOpen &&
            !isBotOptionModalOpen &&
            !isRunOutOfGoldModalOpen &&
            !isBotWarningModalOpen &&
            comment
        ) {
            createObjectMessage(projectId, skillId, comment, 'skills', null, null, null)
            if (!assistantEnabled) closeModal()
        }
    }

    return commentsData ? (
        <Popover
            content={
                <RichCommentModal
                    projectId={projectId}
                    objectType="skills"
                    objectId={skillId}
                    closeModal={closeModal}
                    processDone={addComment}
                    userGettingKarmaId={userGettingKarmaId}
                    showBotButton={true}
                    objectName={skillName}
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
            <ObjectCommentsTag
                commentsData={commentsData}
                isOpen={showModal}
                onOpen={openModal}
                onClose={closeModal}
                accessibilityLabel={'social-text-block'}
                style={{ marginLeft: 8 }}
                disabled={disabled}
            />
        </Popover>
    ) : null
}
