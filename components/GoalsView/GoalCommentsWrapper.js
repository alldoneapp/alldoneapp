import React, { useState, useEffect, useRef } from 'react'
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
    const isUnmountedRef = useRef(false)
    const showModalRef = useRef(false)

    const openModal = () => {
        console.debug('GoalCommentsWrapper: openModal called', {
            goalId: goal?.id,
            isUnmounted: isUnmountedRef.current,
        })
        if (!isUnmountedRef.current) {
            setShowModal(true)
            dispatch(showFloatPopup())
        }
    }

    const closeModal = () => {
        console.debug('GoalCommentsWrapper: closeModal called', {
            goalId: goal?.id,
            isUnmounted: isUnmountedRef.current,
            isQuillTagEditorOpen,
            openModals,
        })
        if (
            !isUnmountedRef.current &&
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

    const handleClickOutside = () => {
        console.debug('GoalCommentsWrapper: onClickOutside', { goalId: goal?.id, isUnmounted: isUnmountedRef.current })
        closeModal()
    }

    useEffect(() => {
        console.debug('GoalCommentsWrapper: mounted', { goalId: goal?.id })
        showModalRef.current = showModal
    }, [showModal])

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            // Close modal immediately to prevent any pending operations
            if (showModalRef.current) {
                console.debug('GoalCommentsWrapper: unmount cleanup, hiding float popup', { goalId: goal?.id })
                dispatch(hideFloatPopup())
            }
            console.debug('GoalCommentsWrapper: unmounted', { goalId: goal?.id })
        }
    }, [dispatch])

    const addComment = async (comment, mentions, isPrivate, hasKarma) => {
        console.debug('GoalCommentsWrapper: addComment start', {
            goalId: goal?.id,
            isUnmounted: isUnmountedRef.current,
        })
        if (
            !isUnmountedRef.current &&
            !isQuillTagEditorOpen &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID] &&
            comment
        ) {
            await createObjectMessage(projectId, goal.id, comment, 'goals', null, null, null)

            if (!isUnmountedRef.current && !assistantEnabled) {
                closeModal()
            }
        }
        console.debug('GoalCommentsWrapper: addComment end', { goalId: goal?.id, isUnmounted: isUnmountedRef.current })
    }

    return showModal && !isUnmountedRef.current ? (
        <Popover
            key={`goal-comments-${goal.id}-${showModal}`}
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
            onClickOutside={handleClickOutside}
            isOpen={showModal && !isUnmountedRef.current}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            disableReposition={true}
            contentLocation={popoverToTop}
        >
            <ObjectCommentsTag
                commentsData={commentsData}
                isOpen={showModal && !isUnmountedRef.current}
                onOpen={openModal}
                onClose={closeModal}
                accessibilityLabel={'social-text-block'}
                style={tagStyle}
                disabled={disabled}
            />
        </Popover>
    ) : (
        <ObjectCommentsTag
            commentsData={commentsData}
            isOpen={false}
            onOpen={openModal}
            onClose={closeModal}
            accessibilityLabel={'social-text-block'}
            style={tagStyle}
            disabled={disabled}
        />
    )
}
