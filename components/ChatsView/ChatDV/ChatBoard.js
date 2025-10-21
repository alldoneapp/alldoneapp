import React, { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import CustomScrollView from '../../UIControls/CustomScrollView'
import ChatInput from './EditorView/ChatInput'
import MessageItem from './EditorView/MessageItem'
import useGetMessages from '../../../hooks/Chats/useGetMessages'
import {
    DV_TAB_TASK_CHAT,
    DV_TAB_CHAT_BOARD,
    DV_TAB_USER_CHAT,
    DV_TAB_CONTACT_CHAT,
    DV_TAB_GOAL_CHAT,
    DV_TAB_NOTE_CHAT,
    DV_TAB_SKILL_CHAT,
    DV_TAB_ASSISTANT_CHAT,
} from '../../../utils/TabNavigationConstants'
import URLsTasks, { URL_TASK_DETAILS_CHAT } from '../../../URLSystem/Tasks/URLsTasks'
import URLsChats, { URL_CHAT_DETAILS } from '../../../URLSystem/Chats/URLsChats'
import {
    setActiveChatData,
    setActiveChatMessageId,
    setAssistantEnabled,
    setChatPagesAmount,
    setTriggerBotSpinner,
} from '../../../redux/actions'
import URLsPeople, { URL_PEOPLE_DETAILS_CHAT } from '../../../URLSystem/People/URLsPeople'
import URLsGoals, { URL_GOAL_DETAILS_CHAT } from '../../../URLSystem/Goals/URLsGoals'
import URLsNotes, { URL_NOTE_DETAILS_CHAT } from '../../../URLSystem/Notes/URLsNotes'
import { LIMIT_SHOW_EARLIER } from '../Utils/ChatHelper'
import ShowMoreButton from '../../UIControls/ShowMoreButton'
import Backend from '../../../utils/BackendBridge'
import URLsSkills, { URL_SKILL_DETAILS_CHAT } from '../../../URLSystem/Skills/URLsSkills'
import PagesAmountSubscriptionContainer from './PagesAmountSubscriptionContainer'
import BotMessagePlaceholder from './EditorView/BotMessagePlaceholder'
import { getAssistant } from '../../AdminPanel/Assistants/assistantsHelper'
import URLsAssistants, { URL_ASSISTANT_DETAILS_CHAT } from '../../../URLSystem/Assistants/URLsAssistants'
import { markChatMessagesAsRead } from '../../../utils/backends/Chats/chatsComments'

const ASSISTANT_STATUS_MESSAGES = ['Processing...', 'Thinking...']

export default function ChatBoard({ projectId, chat, parentObject, assistantId, chatTitle, members, objectType }) {
    const dispatch = useDispatch()
    const triggerBotSpinner = useSelector(state => state.triggerBotSpinner)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const chatPagesAmount = useSelector(state => state.chatPagesAmount)
    const chatNotifications = useSelector(state => state.projectChatNotifications[projectId][chat.id])
    const [amountOfNewCommentsToHighligth, setAmountOfNewCommentsToHighligth] = useState(0)
    const [page, setPage] = useState(1)
    const [toRender, setToRender] = useState(LIMIT_SHOW_EARLIER)
    const [showingEarlier, setShowingEarlier] = useState(false)
    const [serverTime, setServerTime] = useState(null)
    const [waitingForBotAnswer, setWaitingForBotAnswer] = useState(false)

    useEffect(() => {
        console.log('🎯 ChatBoard: waitingForBotAnswer changed to:', waitingForBotAnswer)
    }, [waitingForBotAnswer])
    const scrollViewRef = useRef()

    const messages = useGetMessages(true, true, projectId, chat.id, chat.type, toRender)
    const lastMessageid = messages.length > 0 ? messages[messages.length - 1].id : ''
    const lastMessageLength = messages.length > 0 ? messages[messages.length - 1].commentText.length : 0

    const totalFollowed = chatNotifications ? chatNotifications.totalFollowed : 0
    const totalUnfollowed = chatNotifications ? chatNotifications.totalUnfollowed : 0
    const chatNotificationsAmount = totalFollowed || totalUnfollowed

    const amountOfCommentsToNotHighligth = messages.length - amountOfNewCommentsToHighligth

    const showEarlier = () => {
        setShowingEarlier(true)
        if (page < chatPagesAmount) {
            setPage(page + 1)
            setToRender(toRender + LIMIT_SHOW_EARLIER)
            scrollViewRef.current.scrollTo({ x: 0, y: 25, animated: true })
        } else setToRender(10000)
    }

    const scrollToEnd = () => {
        scrollViewRef.current?.scrollToEnd({ animated: false })
    }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_TASK_CHAT) {
            const data = { projectId, task: chat.id }
            URLsTasks.push(URL_TASK_DETAILS_CHAT, data, projectId, chat.id)
        } else if (selectedTab === DV_TAB_CHAT_BOARD) {
            const data = { projectId, chatId: chat.id }
            URLsChats.push(URL_CHAT_DETAILS, data, projectId, chat.id)
        } else if (selectedTab === DV_TAB_USER_CHAT) {
            const data = { projectId, userId: chat.id }
            URLsPeople.push(URL_PEOPLE_DETAILS_CHAT, data, projectId, chat.id)
        } else if (selectedTab === DV_TAB_CONTACT_CHAT) {
            const data = { projectId, userId: chat.id }
            URLsPeople.push(URL_PEOPLE_DETAILS_CHAT, data, projectId, chat.id)
        } else if (selectedTab === DV_TAB_GOAL_CHAT) {
            const data = { projectId, goal: chat.id }
            URLsGoals.push(URL_GOAL_DETAILS_CHAT, data, projectId, chat.id)
        } else if (selectedTab === DV_TAB_NOTE_CHAT) {
            const data = { projectId, note: chat.id }
            URLsNotes.push(URL_NOTE_DETAILS_CHAT, data, projectId, chat.id, parentObject?.title || '')
        } else if (selectedTab === DV_TAB_SKILL_CHAT) {
            const data = { projectId, skill: chat.id }
            URLsSkills.push(URL_SKILL_DETAILS_CHAT, data, projectId, chat.id)
        } else if (selectedTab === DV_TAB_ASSISTANT_CHAT) {
            const data = { projectId, assistantId: chat.id }
            URLsAssistants.push(URL_ASSISTANT_DETAILS_CHAT, data, projectId, chat.id)
        }
    }

    useEffect(() => {
        if (chatNotificationsAmount > 0) {
            setAmountOfNewCommentsToHighligth(state => state + chatNotificationsAmount)
            markChatMessagesAsRead(projectId, chat.id)
        }
    }, [chatNotificationsAmount])

    useEffect(() => {
        console.log('🔍 ChatBoard: Checking bot response', { waitingForBotAnswer, messagesLength: messages.length })
        if (!waitingForBotAnswer || messages.length === 0) return

        const lastMessage = messages[messages.length - 1]
        const messageCreator = lastMessage?.creatorId
        const isAssistantMessage = !!getAssistant(messageCreator)

        console.log('🔍 ChatBoard: Last message check', {
            creatorId: messageCreator,
            isAssistant: isAssistantMessage,
            text: lastMessage?.commentText?.substring(0, 50),
        })

        if (!isAssistantMessage) return

        const trimmedText = (lastMessage?.commentText || '').trim()
        const isStatusMessage = ASSISTANT_STATUS_MESSAGES.includes(trimmedText)
        const isEmpty = trimmedText === ''

        console.log('🔍 ChatBoard: Assistant message status', {
            trimmedText,
            isStatusMessage,
            isEmpty,
            isLoading: lastMessage?.isLoading,
        })

        if (isStatusMessage || lastMessage?.isLoading || isEmpty) return

        console.log('✅ ChatBoard: Bot responded, setting waitingForBotAnswer to FALSE')
        setWaitingForBotAnswer(false)
    }, [messages])

    useEffect(() => {
        writeBrowserURL()
    }, [])

    useEffect(() => {
        dispatch(setChatPagesAmount(0))
    }, [])

    useEffect(() => {
        if (triggerBotSpinner) setWaitingForBotAnswer(true)
    }, [triggerBotSpinner])

    useEffect(() => {
        return () => {
            dispatch(setTriggerBotSpinner(false))
        }
    }, [dispatch])

    useEffect(() => {
        if (!isAnonymous) {
            dispatch(setActiveChatData(projectId, chat.id, chat.type))
            return () => {
                dispatch(setActiveChatData('', '', ''))
                setAmountOfNewCommentsToHighligth(0)
            }
        }
    }, [isAnonymous])

    useEffect(() => {
        let interval
        Backend.getFirebaseTimestampDirectly().then(serverDate => {
            setServerTime(serverDate)
            interval = setInterval(async () => {
                setServerTime(state => state + 1000)
            }, 1000)
        })
        return () => {
            if (interval) clearInterval(interval)
        }
    }, [])

    useEffect(() => {
        return () => {
            dispatch([setActiveChatMessageId(''), setAssistantEnabled(false)])
        }
    }, [])

    useEffect(() => {
        if (!showingEarlier) {
            setTimeout(() => {
                scrollToEnd()
            })
        }
    }, [lastMessageid, lastMessageLength])

    return (
        <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
            <PagesAmountSubscriptionContainer projectId={projectId} chat={chat} />
            <CustomScrollView ref={scrollViewRef} containerStyle={[localStyles.scrollView]}>
                {page < chatPagesAmount && messages.length > 0 && (
                    <ShowMoreButton expand={showEarlier} expandText={'show earlier'} />
                )}
                <View>
                    {messages.map((message, index) => {
                        const highlight = index >= amountOfCommentsToNotHighligth
                        return (
                            <MessageItem
                                chat={chat}
                                key={message.id}
                                projectId={projectId}
                                message={message}
                                serverTime={serverTime}
                                chatTitle={chatTitle}
                                members={members}
                                objectType={objectType}
                                highlight={highlight}
                                setAmountOfNewCommentsToHighligth={setAmountOfNewCommentsToHighligth}
                            />
                        )
                    })}
                    {waitingForBotAnswer && (
                        <>
                            {console.log('🔄 ChatBoard: Rendering BotMessagePlaceholder')}
                            <BotMessagePlaceholder projectId={projectId} assistantId={assistantId} />
                        </>
                    )}
                </View>
            </CustomScrollView>
            {!isAnonymous && (
                <ChatInput
                    projectId={projectId}
                    chat={chat}
                    chatTitle={chatTitle}
                    members={members}
                    setWaitingForBotAnswer={setWaitingForBotAnswer}
                    assistantId={assistantId}
                    objectType={objectType}
                    setAmountOfNewCommentsToHighligth={setAmountOfNewCommentsToHighligth}
                />
            )}
        </KeyboardAvoidingView>
    )
}

const localStyles = StyleSheet.create({
    scrollView: {
        paddingTop: 8,
        paddingBottom: 32,
        marginLeft: -13,
    },
})
