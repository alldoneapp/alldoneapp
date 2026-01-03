import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View, Dimensions } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import { colors } from '../../../styles/global'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import EditForm from './EditForm'
import { applyPopoverWidthV2, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import CloseButton from './CloseButton'
import CommentsList from './CommentsList'
import Header from './Header'
import AttachmentsSelectorModal from '../AttachmentsSelectorModal'
import { insertAttachmentInsideEditor } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { updateNewAttachmentsData } from '../../../Feeds/Utils/HelperFunctions'
import { exportRef } from '../../../NotesView/NotesDV/EditorView/NotesEditorView'
import { BOT_OPTION_MODAL_ID, COMMENT_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import useGetMessages from '../../../../hooks/Chats/useGetMessages'
import { sortBy } from 'lodash'
import ShowMoreButton from '../../../UIControls/ShowMoreButton'
import { DV_TAB_NOTE_EDITOR } from '../../../../utils/TabNavigationConstants'
import URLTrigger from '../../../../URLSystem/URLTrigger'
import NavigationService from '../../../../utils/NavigationService'
import { checkIsLimitedByTraffic } from '../../../Premium/PremiumHelper'
import { setActiveChatData, setAssistantEnabled } from '../../../../redux/actions'
import BotMessagePlaceholder from './BotMessagePlaceholder'
import { CHAT_INPUT_LIMIT_IN_CHARACTERS } from '../../../../utils/assistantHelper'
import { getAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'
import { getDvChatTabLink } from '../../../../utils/LinkingHelper'
import { markChatMessagesAsRead, repairChatMetadata } from '../../../../utils/backends/Chats/chatsComments'

export default function RichCommentModal({
    projectId,
    objectType,
    objectId,
    closeModal,
    processDone,
    currentComment,
    currentMentions,
    currentPrivacy,
    currentKarma,
    commentsLengthRef,
    inNotesEditor,
    inTaskModal,
    inSuggested,
    userGettingKarmaId,
    customHeader,
    showBotButton,
    objectName,
    externalAssistantId,
}) {
    const dispatch = useDispatch()
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const loggedUser = useSelector(state => state.loggedUser)
    const gold = useSelector(state => state.loggedUser.gold)
    const chatNotifications = useSelector(state => state.projectChatNotifications[projectId][objectId])
    const botOptionModalIsOpen = useSelector(state => state.openModals[BOT_OPTION_MODAL_ID])
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const showNotificationAboutTheBotBehavior = useSelector(state => state.showNotificationAboutTheBotBehavior)
    const [width, height] = useWindowSize()
    const editForm = useRef()
    const [assistantId, setAssistantId] = useState(externalAssistantId)
    const [showFileSelector, setShowFileSelector] = useState(false)
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    const [editor, setEditor] = useState(null)
    const [waitingForBotAnswer, setWaitingForBotAnswer] = useState(false)
    const [showRunOutGoalModal, setShowRunOutGoalModal] = useState(false)
    const [windowWidth, setWindowWidth] = useState(Dimensions.get('window').width)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const editorOpsRef = useRef([])
    const commentListRef = useRef()
    const [initialComment, setInitialComment] = useState(currentComment || '')
    const messages = useGetMessages(
        true,
        true,
        projectId,
        objectId,
        objectType === 'users' ? 'contacts' : objectType,
        2
    )

    disableDoneButton = !!botOptionModalIsOpen

    const totalFollowed = chatNotifications ? chatNotifications.totalFollowed : 0
    const totalUnfollowed = chatNotifications ? chatNotifications.totalUnfollowed : 0
    const chatNotificationsAmount = totalFollowed || totalUnfollowed

    const comments = sortBy(messages, [item => -item.created])
    const lastMessageid = comments.length > 0 ? comments[0].id : ''

    const toggleShowFileSelector = () => {
        if (showFileSelector || !checkIsLimitedByTraffic(projectId)) {
            const newValue = !showFileSelector
            setShowFileSelector(newValue)
            if (newValue) {
                editorOpsRef.current = []
            }
        } else {
            closeModal()
        }
    }

    useEffect(() => {
        if (messages.loaded && messages.length === 0) {
            repairChatMetadata(projectId, objectId, objectType)
        }
    }, [messages, messages.loaded])

    useEffect(() => {
        setAssistantId(externalAssistantId)
    }, [externalAssistantId])

    useEffect(() => {
        dispatch(setAssistantEnabled(false))
        return () => {
            dispatch(setAssistantEnabled(false))
        }
    }, [])

    useEffect(() => {
        const subscription = Dimensions.addEventListener('change', ({ window, screen }) => {
            setWindowWidth(window.width)
        })
        return () => subscription?.remove()
    })

    const done = ({ comment, mentions, privacy, hasKarma }) => {
        const clientSubmissionTime = Date.now()
        console.log('⏱️ [TIMING] CLIENT: RichCommentModal submission', {
            timestamp: new Date().toISOString(),
            submissionTime: clientSubmissionTime,
            projectId,
            objectType,
            objectId,
            assistantId,
            assistantEnabled,
            inTaskModal,
            commentLength: comment?.length,
        })

        if (assistantEnabled && gold === 0) {
            setShowRunOutGoalModal(true)
            dispatch(setAssistantEnabled(false))
        } else {
            if (assistantEnabled) setWaitingForBotAnswer(true)

            if (inTaskModal) {
                processDone(comment.trim(), mentions, privacy, hasKarma)
                console.log('⏱️ [TIMING] CLIENT: RichCommentModal processDone called (task modal)', {
                    timeSinceSubmission: `${Date.now() - clientSubmissionTime}ms`,
                })
            } else {
                updateNewAttachmentsData(projectId, comment).then(text => {
                    processDone(text.trim(), mentions, privacy, hasKarma)
                    console.log('⏱️ [TIMING] CLIENT: RichCommentModal processDone called (after attachments)', {
                        timeSinceSubmission: `${Date.now() - clientSubmissionTime}ms`,
                    })
                })
            }

            if (editor) {
                editor.setText('')
                editor.setSelection(0)
            }
            if (!inNotesEditor && !assistantEnabled) {
                closeModal()
            }
        }
    }

    const addAttachmentTag = (text, uri) => {
        insertAttachmentInsideEditor(inputCursorIndex, editor, text, uri)
        const ops = editor.getContents().ops
        editorOpsRef.current = ops
        setInputCursorIndex(inputCursorIndex + 3)
    }

    const getSelectionText = event => {
        const selection = document.getSelection()
        event.clipboardData.setData('text/plain', selection.toString().replaceAll('\n', ' '))
        event.preventDefault()
    }

    useEffect(() => {
        if (waitingForBotAnswer && comments.length > 0 && getAssistant(comments[0].creatorId)) {
            setWaitingForBotAnswer(false)
        }
    }, [lastMessageid])

    useEffect(() => {
        if (commentsLengthRef) {
            commentsLengthRef.current = messages.length
        }
    }, [messages])

    useEffect(() => {
        if (!inSuggested) {
            setTimeout(() => {
                exportRef?.getEditor()?.focus()
                editForm?.current?.focus()
            }, 1000)
        }
    }, [])

    useEffect(() => {
        storeModal(COMMENT_MODAL_ID)
        commentListRef.current.addEventListener('copy', getSelectionText)

        return () => {
            removeModal(COMMENT_MODAL_ID)
            commentListRef?.current?.removeEventListener('copy', getSelectionText)
        }
    }, [])

    useEffect(() => {
        if (!showFileSelector) {
            dispatch(setActiveChatData(projectId, objectId, objectType))
            return () => {
                dispatch(setActiveChatData('', '', ''))
            }
        }
    }, [showFileSelector])

    useEffect(() => {
        if (chatNotificationsAmount > 0) {
            markChatMessagesAsRead(projectId, objectId)
        }
    }, [chatNotificationsAmount])

    const processShowMore = () => {
        if (selectedTab === DV_TAB_NOTE_EDITOR) {
            closeModal(true)
            navigateToComments()
        } else {
            navigateToComments()
        }
    }

    const navigateToComments = () => {
        const path = getDvChatTabLink(projectId, objectId, objectType === 'topics' ? 'chats' : objectType)

        setTimeout(() => closeModal(), 50)
        URLTrigger.processUrl(NavigationService, path)
    }

    return showNotificationAboutTheBotBehavior ? null : (
        <View>
            {showFileSelector ? (
                <AttachmentsSelectorModal
                    closeModal={toggleShowFileSelector}
                    addAttachmentTag={addAttachmentTag}
                    projectId={projectId}
                />
            ) : (
                <CustomScrollView
                    style={[
                        localStyles.container,
                        applyPopoverWidthV2(isMiddleScreen, smallScreenNavigation, windowWidth),
                        { maxHeight: height - MODAL_MAX_HEIGHT_GAP - 64 },
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={localStyles.innerContainer}>
                        {customHeader ? customHeader : <Header title={objectName} />}

                        <EditForm
                            ref={editForm}
                            projectId={projectId}
                            containerStyle={{ marginBottom: comments && comments.length > 0 ? 16 : 0 }}
                            onSuccess={done}
                            currentComment={initialComment}
                            currentMentions={currentMentions}
                            currentPrivacy={currentPrivacy}
                            currentKarma={currentKarma}
                            toggleShowFileSelector={toggleShowFileSelector}
                            setEditor={setEditor}
                            editor={editor}
                            setInputCursorIndex={setInputCursorIndex}
                            initialCursorIndex={inputCursorIndex}
                            initialDeltaOps={editorOpsRef.current.length > 0 ? editorOpsRef.current : null}
                            setInitialComment={setInitialComment}
                            loggedUserId={loggedUser.uid}
                            userGettingKarmaId={userGettingKarmaId}
                            objectType={objectType}
                            userIsAnonymous={loggedUser.isAnonymous}
                            showBotButton={showBotButton}
                            setShowRunOutGoalModal={setShowRunOutGoalModal}
                            showRunOutGoalModal={showRunOutGoalModal}
                            objectId={objectId}
                            characterLimit={CHAT_INPUT_LIMIT_IN_CHARACTERS}
                            disableDoneButton={disableDoneButton}
                            assistantId={assistantId}
                            setAssistantId={setAssistantId}
                            chatAssistantData={{
                                objectId,
                                objectAssistantId: assistantId,
                                objectType: objectType,
                            }}
                        />
                        {waitingForBotAnswer && comments.length > 0 && comments[0].creatorId !== assistantId && (
                            <BotMessagePlaceholder projectId={projectId} assistantId={assistantId} />
                        )}
                        <div ref={commentListRef}>
                            {comments && comments.length > 0 && (
                                <CommentsList projectId={projectId} comments={comments} />
                            )}
                        </div>
                        <ShowMoreButton
                            expand={processShowMore}
                            contract={processShowMore}
                            expanded={false}
                            expandText={'open chat'}
                            style={{ marginTop: 8 }}
                        />
                    </View>

                    <CloseButton closeModal={closeModal} comments={comments} />
                </CustomScrollView>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        height: 'auto',
        maxWidth: 305,
        minWidth: 305,
    },
    innerContainer: {
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
})
