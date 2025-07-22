import React, { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { FEED_CHAT_OBJECT_TYPE, FEED_PUBLIC_FOR_ALL } from '../../Feeds/Utils/FeedsConstants'
import {
    CREATE_TASK_MODAL_THEME,
    insertAttachmentInsideEditor,
    MENTION_MODAL_TOPICS_TAB,
} from '../../Feeds/CommentsTextInput/textInputHelper'
import { StyleSheet, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import PrivacyWrapper from '../../UIComponents/FloatModals/ManageTaskModal/PrivacyWrapper'
import HighlightWrapper from '../../UIComponents/FloatModals/ManageTaskModal/HighlightWrapper'
import PlusButton from '../Common/PlusButton'
import AttachmentWrapper from './AttachmentWrapper'
import { STAYWARD_COMMENT, updateNewAttachmentsData } from '../../Feeds/Utils/HelperFunctions'
import { startLoadingData, stopLoadingData } from '../../../redux/actions'
import { translate } from '../../../i18n/TranslationService'
import store from '../../../redux/store'
import {
    COMMENT_MODAL_ID,
    exitsOpenModals,
    MENTION_MODAL_ID,
    TAGS_INTERACTION_MODAL_ID,
    TASK_PARENT_GOAL_MODAL_ID,
} from '../../ModalsManager/modalsManager'
import { getId, runHttpsCallableFunction } from '../../../utils/backends/firestore'
import { generateUserIdsToNotifyForNewComments } from '../../../utils/assistantHelper'
import BotButtonInModalWhenAddChats from '../../ChatsView/ChatDV/EditorView/BotOption/BotButtonInModalWhenAddChats'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { updateChatAssistant } from '../../../utils/backends/Chats/chatsFirestore'
import { createChat } from '../../../utils/backends/Chats/chatsComments'

export default function CreateTopic({ projectId, containerStyle, selectItemToMention, modalId, mentionText }) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const defaultAssistantId = useSelector(state => state.defaultAssistant.uid)
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    const [sendingData, setSendingData] = useState(false)
    const [text, setText] = useState('')
    const [topicPrivacy, setTopicPrivacy] = useState(false)
    const [publicFor, setPublicFor] = useState([FEED_PUBLIC_FOR_ALL, loggedUser.uid])
    const [topicColor, setTopicColor] = useState('#FFFFFF')
    const [editor, setEditor] = useState(null)
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    const [botIsActive, setBotIsActive] = useState(false)
    const editorOpsRef = useRef([])
    const topicObject = {
        isPrivate: topicPrivacy,
        isPublicFor: publicFor,
        creatorId: loggedUser.uid,
        hasStar: topicColor,
    }

    const inputText = useRef()

    const assistantId = project.assistantId || defaultAssistantId

    const cleanedText = text?.trim()

    useEffect(() => {
        inputText?.current?.focus()
    }, [])

    const onChangeText = text => {
        setText(text)
    }

    const onToggleBot = () => {
        setBotIsActive(state => !state)
    }

    const setPrivacy = (isPrivate, isPublicFor) => {
        setTopicPrivacy(isPrivate)
        setPublicFor(isPublicFor)
    }

    const setColor = color => {
        setTopicColor(color)
    }

    const addTopic = () => {
        if (cleanedText.length > 0) {
            dispatch(startLoadingData())
            setSendingData(true)
            updateNewAttachmentsData(projectId, text).then(async title => {
                const chatId = getId()
                createChat(
                    chatId,
                    projectId,
                    loggedUser.uid,
                    '',
                    'topics',
                    title,
                    publicFor,
                    '#FFFFFF',
                    null,
                    null,
                    '',
                    '',
                    STAYWARD_COMMENT,
                    loggedUser.uid
                ).then(async chat => {
                    if (botIsActive) {
                        if (!project.isTemplate) {
                            updateChatAssistant(projectId, chatId, assistantId)
                            runHttpsCallableFunction('generateBotAdvaiceSecondGen', {
                                projectId,
                                objectId: chatId,
                                objectType: 'topics',
                                userIdsToNotify: generateUserIdsToNotifyForNewComments(projectId, publicFor, ''),
                                topicName: title,
                                language: window.navigator.language,
                                isPublicFor: publicFor,
                                assistantId,
                                followerIds: null,
                            })
                        }
                    }
                    dispatch(stopLoadingData())
                    selectItemToMention(chat, MENTION_MODAL_TOPICS_TAB, projectId)
                })
            })
        }
    }

    const addAttachmentTag = (text, uri) => {
        insertAttachmentInsideEditor(inputCursorIndex, editor, text, uri)
        editorOpsRef.current = editor.getContents().ops
        setInputCursorIndex(inputCursorIndex + 3)
    }

    const enterKeyAction = () => {
        const { mentionModalStack } = store.getState()
        if (
            mentionModalStack[0] === modalId &&
            !exitsOpenModals([MENTION_MODAL_ID, COMMENT_MODAL_ID, TAGS_INTERACTION_MODAL_ID, TASK_PARENT_GOAL_MODAL_ID])
        ) {
            addTopic()
        }
    }

    return (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.inputContainer}>
                <Icon name={'plus-square'} size={24} color={colors.Primary100} style={localStyles.icon} />
                <View style={{ marginTop: 2, marginBottom: 26, marginLeft: 28, minHeight: 38 }}>
                    <CustomTextInput3
                        ref={inputText}
                        placeholder={translate('Type to add chat')}
                        placeholderTextColor={colors.Text03}
                        onChangeText={onChangeText}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        setMentionsModalActive={() => {}}
                        initialTextExtended={mentionText || text}
                        projectId={projectId}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        disabledEdition={sendingData}
                        // inputHeight={72}
                        setInputCursorIndex={setInputCursorIndex}
                        setEditor={setEditor}
                        initialDeltaOps={editorOpsRef.current.length > 0 ? editorOpsRef.current : null}
                        initialCursorIndex={inputCursorIndex}
                        otherFormats={['image', 'attachment', 'customImageFormat', 'videoFormat']}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    {/*<OpenButton onPress={open} disabled={!cleanedText || sendingData} />*/}
                    <AttachmentWrapper
                        projectId={projectId}
                        addAttachmentTag={addAttachmentTag}
                        disabled={!cleanedText || sendingData}
                    />
                    <PrivacyWrapper
                        object={topicObject}
                        objectType={FEED_CHAT_OBJECT_TYPE}
                        projectId={projectId}
                        setPrivacy={setPrivacy}
                        disabled={!cleanedText || sendingData}
                    />
                    <HighlightWrapper object={topicObject} setColor={setColor} disabled={!cleanedText || sendingData} />
                    <BotButtonInModalWhenAddChats
                        disabled={!cleanedText || sendingData}
                        botIsActive={botIsActive}
                        onPress={onToggleBot}
                        projectId={projectId}
                        assistantId={assistantId}
                    />
                </View>
                <View style={localStyles.buttonsRight}>
                    <PlusButton onPress={() => addTopic()} disabled={!cleanedText || sendingData} modalId={modalId} />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 2,
        paddingHorizontal: 16,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
    buttonsContainer: {
        flexDirection: 'row',
        backgroundColor: '#162764',
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    buttonsLeft: {
        flexDirection: 'row',
        flex: 1,
    },
    buttonsRight: {},
    icon: {
        position: 'absolute',
        top: 8,
        left: 8,
    },
})
