import React, { useEffect, useRef, useState } from 'react'
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
    const isUnmountedRef = useRef(false)
    const dispatch = useDispatch()

    useEffect(() => {
        isUnmountedRef.current = false
        return () => {
            isUnmountedRef.current = true
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
        safeSetShowModal(true)
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
            safeSetShowModal(false)
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
            const clientSubmissionTime = Date.now()
            console.log('⏱️ [TIMING] CLIENT: TaskCommentsWrapper addComment called', {
                timestamp: new Date().toISOString(),
                submissionTime: clientSubmissionTime,
                projectId,
                objectType,
                objectId,
                assistantId,
                commentLength: comment?.length,
            })
            await createObjectMessage(projectId, objectId, comment, objectType, STAYWARD_COMMENT, null, null)
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
        />
    )
}
