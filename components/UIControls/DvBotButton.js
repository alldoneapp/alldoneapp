import React, { useState } from 'react'
import { TouchableOpacity, StyleSheet, View } from 'react-native-web'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import { setAssistantEnabled, setSelectedNavItem, setShowNotificationAboutTheBotBehavior } from '../../redux/actions'
import { colors } from '../styles/global'
import { getAssistantInProjectObject } from '../AdminPanel/Assistants/assistantsHelper'
import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'
import BotOptionsModal from '../ChatsView/ChatDV/EditorView/BotOption/BotOptionsModal'
import RunOutOfGoldAssistantModal from '../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'

export default function DvBotButton({ style, navItem, projectId, assistantId, objectId, objectType, parentObject }) {
    const dispatch = useDispatch()
    const gold = useSelector(state => state.loggedUser.gold)
    const mainChatEditor = useSelector(state => state.mainChatEditor)
    const noticeAboutTheBotBehavior = useSelector(state => state.loggedUser.noticeAboutTheBotBehavior)
    const showNotificationAboutTheBotBehavior = useSelector(state => state.showNotificationAboutTheBotBehavior)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const [isOpen, setIsOpen] = useState(false)

    const { photoURL50 } = getAssistantInProjectObject(projectId, assistantId)

    const navigateToChat = () => {
        dispatch(setSelectedNavItem(navItem))
    }

    const onSelectBotOption = optionText => {
        navigateToChat()
        setTimeout(() => {
            dispatch(setAssistantEnabled(true))
            if (optionText) {
                if (mainChatEditor) {
                    mainChatEditor.setText(optionText)
                    mainChatEditor.setSelection(optionText.length)
                }
            } else {
                if (mainChatEditor) {
                    mainChatEditor.getSelection(true)
                }
            }
        }, 500)
    }

    const openModal = () => {
        if (!noticeAboutTheBotBehavior) dispatch(setShowNotificationAboutTheBotBehavior(true))
        if (gold <= 0) dispatch(setAssistantEnabled(false))
        setIsOpen(true)
        if (document.activeElement) document.activeElement.blur()
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    return (
        <Popover
            content={
                gold > 0 ? (
                    <BotOptionsModal
                        closeModal={closeModal}
                        onSelectBotOption={onSelectBotOption}
                        assistantId={assistantId}
                        parentObject={parentObject}
                        projectId={projectId}
                        objectId={objectId}
                        objectType={objectType}
                        inChatTab={false}
                    />
                ) : (
                    <RunOutOfGoldAssistantModal closeModal={closeModal} />
                )
            }
            align={'end'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen && noticeAboutTheBotBehavior && !showNotificationAboutTheBotBehavior}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <TouchableOpacity style={[localStyles.container, style]} onPress={openModal}>
                <AssistantAvatar photoURL={photoURL50} assistantId={assistantId} size={24} />
            </TouchableOpacity>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        maxHeight: 32,
        minHeight: 32,
        borderWidth: 1,
        borderRadius: 4,
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderColor: colors.Gray400,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 7,
        paddingHorizontal: 7,
        marginRight: 8,
    },
})
