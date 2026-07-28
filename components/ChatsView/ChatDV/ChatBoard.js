import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
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
import SharedHelper from '../../../utils/SharedHelper'
import URLsSkills, { URL_SKILL_DETAILS_CHAT } from '../../../URLSystem/Skills/URLsSkills'
import PagesAmountSubscriptionContainer from './PagesAmountSubscriptionContainer'
import BotMessagePlaceholder from './EditorView/BotMessagePlaceholder'
import { getAssistant } from '../../AdminPanel/Assistants/assistantsHelper'
import URLsAssistants, { URL_ASSISTANT_DETAILS_CHAT } from '../../../URLSystem/Assistants/URLsAssistants'
import { getChatCommentsWithLinkedEmails, markChatMessagesAsRead } from '../../../utils/backends/Chats/chatsComments'
import { hasNewVisibleAssistantMessage, snapshotAssistantMessageIds } from '../Utils/assistantWaiting'
import { performEmailLineAction } from '../../../utils/backends/EmailLine/emailLineBackend'
import {
    getLinkedEmailFromMessage,
    getLinkedEmailsFromMessages,
    groupLinkedEmailsByConnection,
} from './linkedEmailActions'
import Icon from '../../Icon'
import global, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import useNewEmailCommentIds from './useNewEmailCommentIds'
import shouldAutoFocusChatInput from '../Utils/shouldAutoFocusChatInput'

export default function ChatBoard({
    projectId,
    chat,
    parentObject,
    assistantId,
    setAssistantId,
    chatTitle,
    members,
    objectType,
}) {
    const dispatch = useDispatch()
    const triggerBotSpinner = useSelector(state => state.triggerBotSpinner)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const loggedUser = useSelector(state => state.loggedUser)
    // Only members can post. Anonymous viewers and logged-in non-members see this chat read-only.
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const chatPagesAmount = useSelector(state => state.chatPagesAmount)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const chatNotifications = useSelector(state => state.projectChatNotifications[projectId][chat.id])
    const [amountOfNewCommentsToHighligth, setAmountOfNewCommentsToHighligth] = useState(0)
    const [page, setPage] = useState(1)
    const [toRender, setToRender] = useState(LIMIT_SHOW_EARLIER)
    const [showingEarlier, setShowingEarlier] = useState(false)
    const [serverTime, setServerTime] = useState(null)
    const [waitingForBotAnswer, setWaitingForBotAnswer] = useState(false)
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
    const [archivingEmailKeys, setArchivingEmailKeys] = useState([])
    const [archivedEmailKeys, setArchivedEmailKeys] = useState([])
    const [archivingAllEmails, setArchivingAllEmails] = useState(false)
    const scrollViewRef = useRef()
    const lastScrollPositionRef = useRef(0)
    const contentHeightRef = useRef(0)
    const scrollViewHeightRef = useRef(0)
    const assistantMessageIdsAtWaitStartRef = useRef(new Set())

    const messages = useGetMessages(true, true, projectId, chat.id, chat.type, toRender)
    const newEmailCommentIds = useNewEmailCommentIds(`${projectId}:${chat.id}`, chatNotifications)
    const linkedEmails = getLinkedEmailsFromMessages(messages)
    const unarchivedLinkedEmails = linkedEmails.filter(email => !archivedEmailKeys.includes(email.key))
    const lastMessageid = messages.length > 0 ? messages[messages.length - 1].id : ''
    const lastMessageLength = messages.length > 0 ? messages[messages.length - 1].commentText.length : 0

    const startWaitingForBotAnswer = () => {
        assistantMessageIdsAtWaitStartRef.current = snapshotAssistantMessageIds(messages, getAssistant)
        setWaitingForBotAnswer(true)
    }

    // Only a new assistant message can satisfy the wait. Older assistant messages may still be
    // among the most recent messages while the user's new comment is being persisted.
    const hasNewAssistantMessage = hasNewVisibleAssistantMessage(
        messages,
        assistantMessageIdsAtWaitStartRef.current,
        getAssistant
    )

    const totalFollowed = chatNotifications ? chatNotifications.totalFollowed : 0
    const totalUnfollowed = chatNotifications ? chatNotifications.totalUnfollowed : 0
    const chatNotificationsAmount = totalFollowed || totalUnfollowed
    const shouldAutoFocusInput = shouldAutoFocusChatInput(smallScreenNavigation)

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

    const archiveLinkedEmails = async emails => {
        const pendingEmails = emails.filter(
            email => !archivedEmailKeys.includes(email.key) && !archivingEmailKeys.includes(email.key)
        )
        if (pendingEmails.length === 0) return

        const pendingKeys = pendingEmails.map(email => email.key)
        setArchivingEmailKeys(current => [...new Set([...current, ...pendingKeys])])
        try {
            const groupedEmails = groupLinkedEmailsByConnection(pendingEmails)
            await Promise.all(
                Object.entries(groupedEmails).map(([connectionProjectId, messageIds]) =>
                    performEmailLineAction(connectionProjectId, { action: 'archive', messageIds })
                )
            )
            setArchivedEmailKeys(current => [...new Set([...current, ...pendingKeys])])
        } catch (error) {
            console.error('Failed to archive linked email', error)
            alert(`${translate("Email couldn't be archived")}: ${error.message}`)
        } finally {
            setArchivingEmailKeys(current => current.filter(key => !pendingKeys.includes(key)))
        }
    }

    const archiveAllLinkedEmails = async () => {
        if (archivingAllEmails) return
        setArchivingAllEmails(true)
        try {
            const allLinkedEmailComments = await getChatCommentsWithLinkedEmails(projectId, chat.type, chat.id)
            await archiveLinkedEmails(getLinkedEmailsFromMessages(allLinkedEmailComments))
        } catch (error) {
            console.error('Failed to load linked emails for archive all', error)
            alert(`${translate("Emails couldn't be archived")}: ${error.message}`)
        } finally {
            setArchivingAllEmails(false)
        }
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
        if (waitingForBotAnswer && hasNewAssistantMessage) setWaitingForBotAnswer(false)
    }, [waitingForBotAnswer, hasNewAssistantMessage])

    useEffect(() => {
        writeBrowserURL()
    }, [])

    useEffect(() => {
        dispatch(setChatPagesAmount(0))
    }, [])

    useEffect(() => {
        if (triggerBotSpinner) startWaitingForBotAnswer()
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
                {accessGranted && linkedEmails.length > 0 && (
                    <View style={localStyles.emailActionsBar}>
                        <TouchableOpacity
                            style={localStyles.emailActionButton}
                            onPress={archiveAllLinkedEmails}
                            disabled={
                                unarchivedLinkedEmails.length === 0 ||
                                archivingEmailKeys.length > 0 ||
                                archivingAllEmails
                            }
                            accessibilityLabel={translate('Archive all emails')}
                        >
                            {archivingEmailKeys.length > 0 || archivingAllEmails ? (
                                <ActivityIndicator size="small" color={colors.Text03} />
                            ) : (
                                <Icon
                                    name={unarchivedLinkedEmails.length === 0 ? 'check' : 'archive'}
                                    size={14}
                                    color={colors.Text03}
                                />
                            )}
                            <Text style={localStyles.emailActionText}>
                                {translate(unarchivedLinkedEmails.length === 0 ? 'Archived' : 'Archive all emails')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}
                <View>
                    {messages.map((message, index) => {
                        const highlight = index >= amountOfCommentsToNotHighligth
                        const linkedEmail = getLinkedEmailFromMessage(message)
                        const linkedEmailNew = !!linkedEmail && newEmailCommentIds.has(message.id)
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
                                highlight={highlight && !linkedEmailNew}
                                linkedEmail={linkedEmail}
                                linkedEmailNew={linkedEmailNew}
                                linkedEmailArchiving={
                                    archivingAllEmails || archivingEmailKeys.includes(linkedEmail?.key)
                                }
                                linkedEmailArchived={archivedEmailKeys.includes(linkedEmail?.key)}
                                onArchiveLinkedEmail={archiveLinkedEmails}
                                setAmountOfNewCommentsToHighligth={setAmountOfNewCommentsToHighligth}
                            />
                        )
                    })}
                    {waitingForBotAnswer && !hasNewAssistantMessage && (
                        <BotMessagePlaceholder projectId={projectId} assistantId={assistantId} />
                    )}
                </View>
            </CustomScrollView>
            {accessGranted && (
                <ChatInput
                    projectId={projectId}
                    chat={chat}
                    parentObject={parentObject}
                    chatTitle={chatTitle}
                    members={members}
                    setWaitingForBotAnswer={startWaitingForBotAnswer}
                    assistantId={assistantId}
                    setAssistantId={setAssistantId}
                    objectType={objectType}
                    setAmountOfNewCommentsToHighligth={setAmountOfNewCommentsToHighligth}
                    onMessageSent={onMessageSent}
                    autoFocus={shouldAutoFocusInput}
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
    emailActionsBar: {
        alignItems: 'flex-end',
        paddingHorizontal: 8,
        paddingBottom: 4,
    },
    emailActionButton: {
        minHeight: 28,
        paddingHorizontal: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Gray300,
        flexDirection: 'row',
        alignItems: 'center',
    },
    emailActionText: {
        ...global.caption2,
        color: colors.Text03,
        marginLeft: 6,
    },
})
