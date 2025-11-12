import React, { useRef, useState } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import Backend from '../../../utils/BackendBridge'
import { getObjectData, OBJECT_DATA_ID, OBJECT_DATA_TYPE, STAYWARD_COMMENT } from '../Utils/HelperFunctions'
import Button from '../../UIControls/Button'
import { execShortcutFn, popoverToTop } from '../../../utils/HelperFunctions'
import Hotkeys from 'react-hot-keys'
import { useDispatch, useSelector } from 'react-redux'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import RichCommentModal from '../../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { RECORD_SCREEN_MODAL_ID, RECORD_VIDEO_MODAL_ID } from '../CommentsTextInput/textInputHelper'
import {
    MENTION_MODAL_ID,
    BOT_OPTION_MODAL_ID,
    RUN_OUT_OF_GOLD_MODAL_ID,
    BOT_WARNING_MODAL_ID,
} from '../../ModalsManager/modalsManager'
import { translate } from '../../../i18n/TranslationService'
import { createObjectMessage } from '../../../utils/backends/Chats/chatsComments'

export default function CommentsWrapper({
    subscribeClickObserver,
    unsubscribeClickObserver,
    style,
    projectId,
    commentedFeed,
    smallScreen,
    setShowInteractionBar,
    disabled,
    extraFunction,
    userGettingKarmaId,
    assistantId,
}) {
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const commentBtnRef = useRef()
    const [showModal, setShowModal] = useState(false)
    const dispatch = useDispatch()

    const openModal = () => {
        unsubscribeClickObserver && unsubscribeClickObserver()
        setShowModal(true)
        dispatch(showFloatPopup())
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
            subscribeClickObserver && subscribeClickObserver()
            setShowModal(false)
            dispatch(hideFloatPopup())
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
            const { taskId, contactId, userId, noteId, goalId, skillId, assistantId } = commentedFeed

            console.log('⏱️ [TIMING] CLIENT: CommentsWrapper addComment called', {
                timestamp: new Date().toISOString(),
                submissionTime: clientSubmissionTime,
                projectId,
                objectType: taskId
                    ? 'tasks'
                    : noteId
                    ? 'notes'
                    : goalId
                    ? 'goals'
                    : skillId
                    ? 'skills'
                    : userId || contactId
                    ? 'contacts'
                    : assistantId
                    ? 'assistants'
                    : 'unknown',
                objectId: taskId || noteId || goalId || skillId || userId || contactId || assistantId,
                assistantId,
                commentLength: comment?.length,
            })

            if (taskId) {
                await createObjectMessage(projectId, taskId, comment, 'tasks', STAYWARD_COMMENT, null, null, null)
            } else if (noteId) {
                await createObjectMessage(projectId, noteId, comment, 'notes', null, null, null)
            } else if (goalId) {
                await createObjectMessage(projectId, goalId, comment, 'goals', null, null, null)
            } else if (skillId) {
                await createObjectMessage(projectId, skillId, comment, 'skills', null, null, null)
            } else if (userId) {
                await createObjectMessage(projectId, userId, comment, 'contacts', null, null, null)
            } else if (contactId) {
                await createObjectMessage(projectId, contactId, comment, 'contacts', null, null, null)
            } else if (assistantId) {
                await createObjectMessage(projectId, assistantId, comment, 'assistants', null, null, null)
            }

            console.log('⏱️ [TIMING] CLIENT: CommentsWrapper createObjectMessage completed', {
                timeSinceSubmission: `${Date.now() - clientSubmissionTime}ms`,
            })

            extraFunction && extraFunction()

            if (!assistantEnabled) {
                closeModal()
                setShowInteractionBar && setShowInteractionBar(false)
            }
        }
    }

    return (
        <View>
            <Popover
                content={
                    <RichCommentModal
                        projectId={projectId}
                        objectType={getObjectData(OBJECT_DATA_TYPE, commentedFeed)}
                        objectId={getObjectData(OBJECT_DATA_ID, commentedFeed)}
                        closeModal={closeModal}
                        processDone={addComment}
                        userGettingKarmaId={userGettingKarmaId}
                        showBotButton={true}
                        objectName={commentedFeed.name}
                        externalAssistantId={assistantId}
                    />
                }
                onClickOutside={closeModal}
                isOpen={showModal}
                position={['bottom', 'right', 'top', 'left']}
                padding={4}
                align={'start'}
                disableReposition={true}
                contentLocation={popoverToTop}
            >
                <Hotkeys
                    disabled={true}
                    keyName={'alt+C'}
                    onKeyDown={(sht, event) => execShortcutFn(commentBtnRef.current, openModal, event)}
                    filter={e => true}
                >
                    <Button
                        ref={commentBtnRef}
                        title={smallScreen ? null : translate('Comment')}
                        type={'ghost'}
                        noBorder={smallScreen}
                        icon={'message-circle'}
                        buttonStyle={style}
                        onPress={openModal}
                        shortcutText={'C'}
                        disabled={disabled}
                    />
                </Hotkeys>
            </Popover>
        </View>
    )
}
