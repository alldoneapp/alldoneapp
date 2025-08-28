import React, { useRef, useState } from 'react'
import { checkDVLink } from '../../../utils/LinkingHelper'
import URLTrigger from '../../../URLSystem/URLTrigger'
import NavigationService from '../../../utils/NavigationService'
import { StyleSheet, View } from 'react-native'
import Icon from '../../Icon'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import styles, { colors } from '../../styles/global'
import { CREATE_TASK_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import SaveButton from '../Common/SaveButton'
import OpenButton from '../../NewObjectsInMentions/Common/OpenButton'
import PrivacyWrapper from '../../UIComponents/FloatModals/ManageTaskModal/PrivacyWrapper'
import { FEED_CHAT_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import StickyWrapper from '../../NewObjectsInMentions/Notes/StickyWrapper'
import HighlightWrapper from '../../UIComponents/FloatModals/ManageTaskModal/HighlightWrapper'
import { getPathname } from '../../Tags/LinkTag'
import { COMMENT_MODAL_ID, exitsOpenModals, TAGS_EDIT_OBJECT_MODAL_ID } from '../../ModalsManager/modalsManager'
import {
    updateChatHighlight,
    updateChatPrivacy,
    updateChatTitle,
    updateStickyChatData,
} from '../../../utils/backends/Chats/chatsFirestore'

export default function EditChatLink({ projectId, containerStyle, chatData, closeModal, objectUrl }) {
    const chatId = chatData.id
    const [chat, setChat] = useState(chatData)
    const inputText = useRef()

    const cleanedTitle = chat.title.trim()

    const needBeUpdated = () => {
        return chat.title.trim() !== chatData.title.trim()
    }

    const setColor = color => {
        setChat(chat => ({ ...chat, hasStar: color }))
        updateChatHighlight(projectId, chat.id, color)
        closeModal()
    }

    const onChangeText = title => {
        setChat(chat => ({ ...chat, title }))
    }

    const updateChat = (openDetails = false) => {
        if (chat.title.trim().length > 0) {
            updateChatTitle(projectId, chat, chat.title.trim())

            if (openDetails) {
                openDV()
            } else {
                closeModal()
            }
        }
    }

    const setPrivacy = (_isPrivate, isPublicFor) => {
        updateChatPrivacy(projectId, chat.id, chat.type, isPublicFor)

        closeModal()
    }

    const setStickyChatData = stickyData => {
        updateStickyChatData(projectId, chat.id, stickyData)
        closeModal()
    }

    const openDV = () => {
        closeModal()

        setTimeout(() => {
            checkDVLink('chat')
            const linkUrl = objectUrl != null ? getPathname(objectUrl) : `/projects/${projectId}/chats/${chatId}/chat`
            URLTrigger.processUrl(NavigationService, linkUrl)
        }, 400)
    }

    const enterKeyAction = () => {
        if (!exitsOpenModals([COMMENT_MODAL_ID, TAGS_EDIT_OBJECT_MODAL_ID])) {
            needBeUpdated() ? updateChat() : closeModal()
        }
    }

    return !chat ? null : (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.inputContainer}>
                <Icon name={'comments-thread'} size={24} color={'#ffffff'} style={localStyles.icon} />
                <View style={{ marginTop: 2, marginBottom: 26, marginLeft: 28, minHeight: 38 }}>
                    <CustomTextInput3
                        ref={inputText}
                        placeholder={'Type to edit the chat'}
                        placeholderTextColor={colors.Text03}
                        onChangeText={onChangeText}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        setMentionsModalActive={() => {}}
                        initialTextExtended={chat.title}
                        chatId={chatId}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    <OpenButton onPress={needBeUpdated() ? () => updateChat(true) : openDV} disabled={!cleanedTitle} />

                    <PrivacyWrapper
                        object={chat}
                        objectType={FEED_CHAT_OBJECT_TYPE}
                        projectId={projectId}
                        setPrivacy={setPrivacy}
                        disabled={!cleanedTitle}
                    />

                    <HighlightWrapper object={chat} setColor={setColor} disabled={!cleanedTitle} />

                    <StickyWrapper
                        note={chat}
                        projectId={projectId}
                        disabled={!cleanedTitle}
                        setSticky={setStickyChatData}
                    />
                </View>
                <View style={localStyles.buttonsRight}>
                    <SaveButton
                        icon={(!needBeUpdated() || !cleanedTitle) && 'x'}
                        onPress={needBeUpdated() ? () => updateChat() : closeModal}
                    />
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
