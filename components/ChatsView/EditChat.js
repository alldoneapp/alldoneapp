import React, { useEffect, useRef, useState } from 'react'
import { Keyboard, StyleSheet, View } from 'react-native'
import Icon from '../Icon'
import { colors } from '../styles/global'
import CustomTextInput3 from '../Feeds/CommentsTextInput/CustomTextInput3'
import { TASK_THEME } from '../Feeds/CommentsTextInput/textInputHelper'
import Button from '../UIControls/Button'
import PrivacyButton from '../UIComponents/FloatModals/PrivacyModal/PrivacyButton'
import { FEED_CHAT_OBJECT_TYPE, FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import HighlightButton from '../UIComponents/FloatModals/HighlightColorModal/HighlightButton'
import { useDispatch, useSelector } from 'react-redux'
import { getId, runHttpsCallableFunction } from '../../utils/backends/firestore'
import { STAYWARD_COMMENT, updateNewAttachmentsData } from '../Feeds/Utils/HelperFunctions'
import NavigationService from '../../utils/NavigationService'
import URLTrigger from '../../URLSystem/URLTrigger'
import { MENTION_MODAL_ID } from '../ModalsManager/modalsManager'
import { getChatIcon, onOpenChat } from './Utils/ChatHelper'
import { setAssistantEnabled, setTriggerBotSpinner, showConfirmPopup } from '../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_TOPIC } from '../UIComponents/ConfirmPopup'
import { DV_TAB_ROOT_CHATS } from '../../utils/TabNavigationConstants'
import StickyButton from '../UIControls/StickyButton'
import { translate } from '../../i18n/TranslationService'
import { generateUserIdsToNotifyForNewComments } from '../../utils/assistantHelper'
import BotButtonWhenAddChats from './ChatDV/EditorView/BotOption/BotButtonWhenAddChats'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../redux/store'
import {
    updateChatAssistant,
    updateChatHighlight,
    updateChatPrivacy,
    updateChatTitle,
    updateStickyChatData,
} from '../../utils/backends/Chats/chatsFirestore'
import { createChat } from '../../utils/backends/Chats/chatsComments'

const EditChat = ({ formType, projectId, onCancelAction, chat }) => {
    let inputRef = useRef()
    const dispatch = useDispatch()
    const openModals = useSelector(state => state.openModals)
    const loggedUser = useSelector(state => state.loggedUser)
    const [inputText, setInputText] = useState('')
    const [isPrivate, setIsPrivate] = useState(false)
    const [isPublicFor, setIsPublicFor] = useState(chat.isPublicFor || [FEED_PUBLIC_FOR_ALL, loggedUser.uid])
    const [hasStar, setHasStar] = useState(chat.hasStar)
    const [stickyData, setStickyData] = useState(chat.stickyData)
    const [showButtonSpace, setShowButtonSpace] = useState(true)
    const [botIsActive, setBotIsActive] = useState(false)

    const tmpInputTextChat = useSelector(state => state.tmpInputTextChat)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const smallScreen = useSelector(state => state.smallScreen)
    const buttonItemStyle = { marginRight: smallScreen ? 8 : 4 }
    const chatChanged = inputText.trim() !== chat?.title.trim()

    useEffect(() => {
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [inputText, openModals])

    const enterKeyAction = event => {
        if (!openModals[MENTION_MODAL_ID]) inputText ? onSubmit(event) : onCancelAction()
    }

    const onKeyDown = event => {
        if (event.key === 'Enter') {
            enterKeyAction(event)
        }
    }

    const onSubmit = e => {
        if (chatChanged) {
            if (formType === 'new') {
                if (e) e.preventDefault()
                updateNewAttachmentsData(projectId, inputText).then(title => {
                    const chatId = getId()
                    createChat(
                        chatId,
                        projectId,
                        loggedUser.uid,
                        '',
                        'topics',
                        title,
                        isPublicFor,
                        hasStar,
                        stickyData,
                        null,
                        '',
                        '',
                        STAYWARD_COMMENT,
                        loggedUser.uid
                    ).then(async () => {
                        if (botIsActive) {
                            const project = ProjectHelper.getProjectById(projectId)
                            if (!project.isTemplate) {
                                const { defaultAssistant } = store.getState()
                                const assistantId = project.assistantId || defaultAssistant.uid
                                updateChatAssistant(projectId, chatId, assistantId)
                                runHttpsCallableFunction('generateBotAdvaiceSecondGen', {
                                    projectId,
                                    objectId: chatId,
                                    objectType: 'topics',
                                    userIdsToNotify: generateUserIdsToNotifyForNewComments(projectId, isPublicFor, ''),
                                    topicName: title,
                                    language: window.navigator.language,
                                    isPublicFor,
                                    assistantId,
                                    followerIds: null,
                                })
                                dispatch([setTriggerBotSpinner(true), setAssistantEnabled(true)])
                            }
                        }
                        const url = `/projects/${projectId}/chats/${chatId}/chat`
                        URLTrigger.processUrl(NavigationService, url)
                    })
                })
                inputRef.current.clear()
                onCancelAction()
            } else if (!!inputText.trim()) {
                updateChatTitle(projectId, chat, inputText.trim())
                onCancelAction()
            } else if (inputText.trim() === '') {
                askToDeleteChat(e)
            }
        } else {
            onCancelAction()
        }
    }

    const onToggleBot = () => {
        setBotIsActive(state => !state)
    }

    const getInitialText = () => {
        if (formType === 'new') {
            return tmpInputTextChat
        } else return chat.title
    }

    const getPlaceholderText = formType => {
        if (formType === 'new') {
            return translate('Type a topic to start a new chat with your teammates')
        }
        return translate('Write the title of the topic')
    }

    const askToDeleteChat = e => {
        if (e) e.preventDefault()
        Keyboard.dismiss()

        dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_TOPIC,
                object: {
                    chat: chat,
                    projectId: projectId,
                    navigation: DV_TAB_ROOT_CHATS,
                },
            })
        )
    }

    const onPressOpen = e => {
        if (formType === 'new') {
            onSubmit(e)
        } else {
            onOpenChat(projectId, chat)
        }
    }

    const setHighlightChat = color => {
        if (formType === 'new') {
            setHasStar(color)
        } else {
            updateChatHighlight(projectId, chat.id, color)
            onCancelAction()
        }
    }

    const setPrivacyChat = (isPrivate, isPublicFor) => {
        if (formType === 'new') {
            setIsPrivate(isPrivate)
            setIsPublicFor(isPublicFor)
        } else {
            updateChatPrivacy(projectId, chat.id, chat.type, isPublicFor)
            onCancelAction()
        }
    }

    const setStickyChatData = stickyData => {
        if (formType === 'new') {
            setStickyData(stickyData)
        } else {
            updateStickyChatData(projectId, chat.id, stickyData)
            onCancelAction()
        }
    }

    return (
        <View
            onLayout={event => setShowButtonSpace(event.nativeEvent.layout.width > 915)}
            style={[
                localStyles.container,
                smallScreenNavigation ? localStyles.containerUnderBreakpoint : undefined,
                formType === 'edit' && { marginVertical: 18 },
            ]}
            data-edit-chat={`${chat.id}`}
        >
            <View style={localStyles.inputContainer}>
                <View
                    style={[
                        localStyles.icon,
                        formType === 'new' ? localStyles.iconNew : undefined,
                        formType === 'new' && smallScreenNavigation ? localStyles.iconNewMobile : undefined,
                    ]}
                >
                    <Icon
                        name={formType === 'new' ? 'plus-square' : getChatIcon(chat)}
                        size={24}
                        color={colors.Primary100}
                    />
                </View>

                <CustomTextInput3
                    ref={inputRef}
                    placeholder={getPlaceholderText(formType)}
                    placeholderTextColor={colors.Text03}
                    onChangeText={text => setInputText(text)}
                    autoFocus={true}
                    projectId={projectId}
                    externalAlignment={localStyles.textInputAlignment}
                    containerStyle={[
                        localStyles.textInputContainer,
                        smallScreenNavigation ? localStyles.inputUnderBreakpoint : undefined,
                    ]}
                    styleTheme={TASK_THEME}
                    initialTextExtended={getInitialText()}
                    otherFormats={['image', 'attachment', 'customImageFormat', 'videoFormat']}
                    disabledEdition={chat.type !== 'topics' && formType === 'edit'}
                    forceTriggerEnterActionForBreakLines={enterKeyAction}
                />
            </View>
            <View style={localStyles.buttonContainer}>
                <View style={[localStyles.buttonSection]}>
                    <View style={{ marginRight: smallScreenNavigation || !showButtonSpace ? 4 : 32 }}>
                        <Button
                            ref={ref => (openBtnRef = ref)}
                            title={smallScreen ? null : translate('Open nav')}
                            type={'secondary'}
                            noBorder={smallScreen}
                            icon={'maximize-2'}
                            buttonStyle={buttonItemStyle}
                            onPress={onPressOpen}
                            disabled={!inputText && formType === 'new'}
                            shortcutText={'O'}
                        />
                    </View>

                    <PrivacyButton
                        projectId={projectId}
                        object={{ creatorId: loggedUser.uid, isPublicFor }}
                        objectType={FEED_CHAT_OBJECT_TYPE}
                        disabled={formType === 'new' && !chatChanged}
                        savePrivacyBeforeSaveObject={setPrivacyChat}
                        inEditComponent={true}
                        style={buttonItemStyle}
                        shortcutText={'P'}
                    />

                    <HighlightButton
                        projectId={projectId}
                        object={{ creatorId: loggedUser.uid, hasStar }}
                        objectType={FEED_CHAT_OBJECT_TYPE}
                        disabled={formType === 'new' && !chatChanged}
                        saveHighlightBeforeSaveObject={setHighlightChat}
                        inEditComponent={true}
                        style={buttonItemStyle}
                        shortcutText={'H'}
                    />

                    <StickyButton
                        projectId={projectId}
                        note={Object.assign(chat, { stickyData })}
                        disabled={formType === 'new' && !chatChanged}
                        style={buttonItemStyle}
                        shortcutText={'Y'}
                        saveStickyBeforeSaveNote={setStickyChatData}
                        isChat={true}
                    />
                    {formType === 'new' && (
                        <BotButtonWhenAddChats
                            botIsActive={botIsActive}
                            disabled={!chatChanged}
                            onPress={onToggleBot}
                            containerStyle={{ marginRight: smallScreenNavigation ? 8 : 4 }}
                            projectId={projectId}
                            assistantId={chat.assistantId}
                        />
                    )}
                </View>

                <View style={[localStyles.buttonSection, localStyles.buttonSectionRight]}>
                    {smallScreen ? undefined : (
                        <Button
                            title={translate('Cancel')}
                            type={'secondary'}
                            buttonStyle={buttonItemStyle}
                            onPress={onCancelAction}
                            shortcutText={'Esc'}
                        />
                    )}

                    <Button
                        title={
                            smallScreen
                                ? null
                                : !chatChanged
                                ? 'Ok'
                                : translate(
                                      formType === 'new'
                                          ? `Start Chat`
                                          : formType === 'edit' && inputText === ''
                                          ? `Delete`
                                          : `Save`
                                  )
                        }
                        type={formType === 'edit' && inputText === '' ? 'danger' : 'primary'}
                        icon={
                            smallScreen
                                ? formType === 'edit' && inputText === ''
                                    ? 'trash-2'
                                    : !chatChanged
                                    ? 'x'
                                    : formType === 'new'
                                    ? 'plus'
                                    : 'save'
                                : null
                        }
                        onPress={onSubmit}
                        accessible={false}
                        shortcutText={'Enter'}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: colors.Grey200,
        borderRadius: 4,
        shadowColor: 'rgba(0,0,0,0.08)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
        marginHorizontal: -4,
    },
    containerUnderBreakpoint: {
        marginLeft: -8,
        marginRight: -8,
    },
    buttonContainer: {
        flex: 1,
        height: 55,
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: colors.Grey100,
        borderTopWidth: 1,
        borderStyle: 'solid',
        borderTopColor: colors.Gray300,
        paddingVertical: 7,
        paddingHorizontal: 9,
    },
    buttonSection: {
        flexDirection: 'row',
    },
    buttonSectionRight: {
        justifyContent: 'flex-end',
    },
    inputContainer: {
        minHeight: 59, // (+1 border top = 60)
        overflow: 'hidden',
    },
    icon: {
        position: 'absolute',
        padding: 0,
        margin: 0,
        left: 15,
        top: 7,
    },
    iconNew: {
        top: 7,
    },
    iconNewMobile: {
        top: 7,
        left: 7,
    },

    // Text Input ===========================================
    textInputContainer: {
        marginTop: 2,
        marginBottom: 12,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        minHeight: 40, // 59 - (7 + 12)
        marginLeft: 67,
        marginRight: 40,
    },
    textInputAlignment: {
        paddingLeft: 0,
        paddingRight: 0,
    },
    inputUnderBreakpoint: {
        marginLeft: 44,
        marginRight: 32,
    },
})

EditChat.defaultProps = {
    chat: { assistantId: '', title: '', hasStar: '#FFFFFF', stickyData: { days: 0, stickyEndDate: 0 } },
}

export default EditChat
