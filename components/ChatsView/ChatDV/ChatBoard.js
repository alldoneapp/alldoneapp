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
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
    const scrollViewRef = useRef()
    const lastScrollPositionRef = useRef(0)
    const contentHeightRef = useRef(0)
    const scrollViewHeightRef = useRef(0)

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

    const onMessageSent = () => {
        setAutoScrollEnabled(true)
    }

    const handleScroll = event => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
        const currentScrollPosition = contentOffset.y
        const maxScrollPosition = contentSize.height - layoutMeasurement.height

        // Update refs for tracking
        lastScrollPositionRef.current = currentScrollPosition
        contentHeightRef.current = contentSize.height
        scrollViewHeightRef.current = layoutMeasurement.height

        // If user scrolls up (away from bottom by more than 50px threshold), disable auto-scroll
        const distanceFromBottom = maxScrollPosition - currentScrollPosition
        if (distanceFromBottom > 50) {
            setAutoScrollEnabled(false)
        }
    }

    const handleContentSizeChange = (contentWidth, contentHeight) => {
        contentHeightRef.current = contentHeight
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
        if (!waitingForBotAnswer || messages.length === 0) return

        const lastMessage = messages[messages.length - 1]
        const messageCreator = lastMessage?.creatorId
        const isAssistantMessage = !!getAssistant(messageCreator)

        if (!isAssistantMessage) return

        const trimmedText = (lastMessage?.commentText || '').trim()
        const isEmpty = trimmedText === ''

        // Hide placeholder when any assistant message appears (including status messages like "Processing...")
        // Status messages are rendered via MessageItem, so we don't need the placeholder anymore
        if (lastMessage?.isLoading || isEmpty) return

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
    }, [isAnonymous, chat.id, projectId, chat.type])

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
            dispatch(setActiveChatMessageId(''))
            dispatch(setAssistantEnabled(false))
        }
    }, [chat.id])

    useEffect(() => {
        if (!showingEarlier && autoScrollEnabled) {
            setTimeout(() => {
                scrollToEnd()
            })
        }
    }, [lastMessageid, lastMessageLength, autoScrollEnabled])

    return (
        <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
            <PagesAmountSubscriptionContainer projectId={projectId} chat={chat} />
            <CustomScrollView
                ref={scrollViewRef}
                containerStyle={[localStyles.scrollView]}
                onScroll={handleScroll}
                onContentSizeChange={handleContentSizeChange}
                scrollEventThrottle={16}
            >
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
                    {waitingForBotAnswer && <BotMessagePlaceholder projectId={projectId} assistantId={assistantId} />}
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
                    onMessageSent={onMessageSent}
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
