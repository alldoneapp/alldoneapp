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
import { getTimestampInMilliseconds, LIMIT_SHOW_EARLIER } from '../Utils/ChatHelper'
import ShowMoreButton from '../../UIControls/ShowMoreButton'
import Backend from '../../../utils/BackendBridge'
import SharedHelper from '../../../utils/SharedHelper'
import URLsSkills, { URL_SKILL_DETAILS_CHAT } from '../../../URLSystem/Skills/URLsSkills'
import PagesAmountSubscriptionContainer from './PagesAmountSubscriptionContainer'
import BotMessagePlaceholder from './EditorView/BotMessagePlaceholder'
import { getAssistant } from '../../AdminPanel/Assistants/assistantsHelper'
import URLsAssistants, { URL_ASSISTANT_DETAILS_CHAT } from '../../../URLSystem/Assistants/URLsAssistants'
import { getChatCommentsWithLinkedEmails, markChatMessagesAsRead } from '../../../utils/backends/Chats/chatsComments'
import {
    hasLoadingAssistantMessage,
    hasNewVisibleAssistantMessage,
    shouldShowAssistantScrollIndicator,
    snapshotAssistantMessageIds,
} from '../Utils/assistantWaiting'
import { shouldConsumeBotSpinnerTrigger } from '../Utils/botSpinnerTrigger'
import { isAssistantEnabledScopeMatch } from '../Utils/assistantEnabledScope'
import { ASSISTANT_LOADING_TIMEOUT_MS, resolveEffectiveMessageLoading } from './EditorView/messageLoadingState'
import { getLinkedEmailFromMessage, getLinkedEmailsFromMessages } from './linkedEmailActions'
import useLinkedEmailArchive from './useLinkedEmailArchive'
import Icon from '../../Icon'
import global, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import useNewEmailCommentIds from './useNewEmailCommentIds'
import useLoadingMore from '../../../hooks/useLoadingMore'
import MessagesSkeleton from './MessagesSkeleton'
import { resolveGhostRowCount } from '../../UIComponents/Ghosts/ghostRowCount'
import shouldAutoFocusChatInput from '../Utils/shouldAutoFocusChatInput'
import {
    CHAT_EDGE_TOP,
    CHAT_FULLSCREEN_COOLDOWN_MS,
    getChatEdgeAtPosition,
    getChatFullscreenTolerances,
    resolveChatFullscreenChange,
} from '../Utils/chatScrollFullscreen'
import useChatAutoScroll from '../../../hooks/Chats/useChatAutoScroll'
import NewMessagesPill from './NewMessagesPill'
import { CHAT_BOARD_CONTENT_OFFSET } from './chatComposerLayout'

export default function ChatBoard({
    projectId,
    chat,
    parentObject,
    assistantId,
    setAssistantId,
    chatTitle,
    members,
    objectType,
    isFullscreen = false,
    setFullscreen,
}) {
    const dispatch = useDispatch()
    const triggerBotSpinner = useSelector(state => state.triggerBotSpinner)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const assistantEnabledScope = useSelector(state => state.assistantEnabledScope)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const loggedUser = useSelector(state => state.loggedUser)
    // Only members can post. Anonymous viewers and logged-in non-members see this chat read-only.
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const chatPagesAmount = useSelector(state => state.chatPagesAmount)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const chatNotifications = useSelector(state => state.projectChatNotifications[projectId][chat.id])
    const [amountOfNewCommentsToHighligth, setAmountOfNewCommentsToHighligth] = useState(0)
    const [page, setPage] = useState(1)
    const [toRender, setToRender] = useState(LIMIT_SHOW_EARLIER)
    const [serverTime, setServerTime] = useState(null)
    const [waitingForBotAnswer, setWaitingForBotAnswer] = useState(false)
    const [archivingAllEmails, setArchivingAllEmails] = useState(false)
    // Shared with the chat list's unread previews (AT-2256) so both archive the same way.
    const { archivingEmailKeys, archivedEmailKeys, archiveLinkedEmails } = useLinkedEmailArchive()
    const scrollViewRef = useRef()
    const assistantMessageIdsAtWaitStartRef = useRef(new Set())
    const isFullscreenRef = useRef(isFullscreen)
    isFullscreenRef.current = isFullscreen
    const lastFullscreenChangeRef = useRef(0)
    const previousFullscreenRef = useRef(isFullscreen)
    const requestedFullscreenRef = useRef(null)
    const suppressExpandUntilEdgeRef = useRef(false)
    // Read through a ref on unmount so leaving the chat tab always restores the normal layout,
    // even when the parent re-created the callback in the meantime.
    const setFullscreenRef = useRef(setFullscreen)
    setFullscreenRef.current = setFullscreen

    const messages = useGetMessages(true, true, projectId, chat.id, chat.type, toRender)
    // AT-2382 - the "a page arrived" edge for the ghosts. Note this canNOT be `messages`
    // itself: `useGetMessages` returns `[...state.messages]`, a brand-new array on EVERY
    // render, so keying on its identity would retire the ghosts on the very next render and
    // flash them for a single frame. "show earlier" prepends older comments, so the oldest
    // id is what actually moves when the page lands; the length covers the rest.
    const olderMessagesSignal = `${messages.length}:${messages[0]?.id || ''}`
    const [loadingMoreMessages, startLoadingMoreMessages] = useLoadingMore(olderMessagesSignal)
    const newEmailCommentIds = useNewEmailCommentIds(`${projectId}:${chat.id}`, chatNotifications)
    const linkedEmails = getLinkedEmailsFromMessages(messages, { projectId, chatId: chat.id })
    const unarchivedLinkedEmails = linkedEmails.filter(email => !archivedEmailKeys.includes(email.key))
    const lastMessageid = messages.length > 0 ? messages[messages.length - 1].id : ''
    const lastMessageLength = messages.length > 0 ? messages[messages.length - 1].commentText.length : 0
    // AT-2439 - a streamed answer arrives as repeated updates to the SAME comment, so the newest
    // message's text length is what moves while it is being written; its id covers a genuinely new
    // message. Combined into one signal because the pin only cares that "the newest message moved".
    const {
        handleScrollPosition,
        handleContentSizeChange,
        handleViewportLayout,
        pinToBottom,
        releasePin,
        hasNewMessagesBelow,
    } = useChatAutoScroll({ scrollViewRef, newestMessageSignal: `${lastMessageid}:${lastMessageLength}` })

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
    const assistantResponseIsLoading =
        waitingForBotAnswer ||
        hasLoadingAssistantMessage(
            messages,
            creatorId => !!getAssistant(creatorId),
            message =>
                message.assistantRun?.kind === 'chat' &&
                resolveEffectiveMessageLoading(message, getTimestampInMilliseconds(message.lastChangeDate))
        )

    const totalFollowed = chatNotifications ? chatNotifications.totalFollowed : 0
    const totalUnfollowed = chatNotifications ? chatNotifications.totalUnfollowed : 0
    const chatNotificationsAmount = totalFollowed || totalUnfollowed
    const shouldAutoFocusInput = shouldAutoFocusChatInput(smallScreenNavigation)

    const amountOfCommentsToNotHighligth = messages.length - amountOfNewCommentsToHighligth

    const showEarlier = () => {
        // AT-2439 - opening older messages is an explicit move away from the newest one, and the
        // page lands a round trip later: without standing the pin down here, that arriving content
        // would be re-pinned to the bottom before any scroll event could report where the reader
        // actually went. It stands down for exactly as long as they stay up there — coming back to
        // the newest message, or sending, re-arms it. (It used to be a latch that killed
        // auto-scroll for the rest of the mount, including for messages the reader sent
        // themselves, which is the reported bug.)
        releasePin()
        // AT-2382 - `toRender` re-subscribes `watchComments` with a bigger limit, so the
        // older messages are a round trip away. Ghosts hold the top of the thread until
        // they land, which also keeps the scrollTo below landing on stable content.
        startLoadingMoreMessages()
        if (page < chatPagesAmount) {
            setPage(page + 1)
            setToRender(toRender + LIMIT_SHOW_EARLIER)
            scrollViewRef.current.scrollTo({ x: 0, y: 25, animated: true })
        } else setToRender(10000)
    }

    const onMessageSent = () => {
        // Sending is the least ambiguous "show me what happens next" there is, so it re-arms the
        // pin no matter where the reader was — including after "show earlier". The comment itself
        // only exists once Firestore echoes it back, so this first hop just closes whatever gap the
        // composer left; the content-size pin is what lands on the real message.
        //
        // Animated here and only here: sending from further up the thread is a jump the reader
        // should be able to follow with their eyes. The automatic follow while an answer streams
        // stays instant — smoothing three to ten scrolls a second would smear the text being read.
        pinToBottom({ animated: true })
    }

    const archiveAllLinkedEmails = async () => {
        if (archivingAllEmails) return
        setArchivingAllEmails(true)
        try {
            const allLinkedEmailComments = await getChatCommentsWithLinkedEmails(projectId, chat.type, chat.id)
            await archiveLinkedEmails(
                getLinkedEmailsFromMessages(allLinkedEmailComments, { projectId, chatId: chat.id })
            )
        } catch (error) {
            console.error('Failed to load linked emails for archive all', error)
            alert(`${translate("Emails couldn't be archived")}: ${error.message}`)
        } finally {
            setArchivingAllEmails(false)
        }
    }

    // Reading the thread in the middle expands the chat over the DV chrome; resting at either
    // edge restores the normal layout. Only a DV that passes `setFullscreen` takes part — the
    // note side chat deliberately does not, since it is a panel beside the editor rather than
    // the tab's main content.
    const updateFullscreenMode = ({ scrollY, contentHeight, viewportHeight }) => {
        if (!setFullscreen) return

        const { enter, exit } = getChatFullscreenTolerances({
            mobile: smallScreenNavigation,
            tablet: isMiddleScreen,
        })

        if (suppressExpandUntilEdgeRef.current) {
            const edge = getChatEdgeAtPosition({ scrollY, contentHeight, viewportHeight, exit })
            if (!edge) return
            suppressExpandUntilEdgeRef.current = false
        }

        const now = Date.now()
        if (now - lastFullscreenChangeRef.current < CHAT_FULLSCREEN_COOLDOWN_MS) return

        const change = resolveChatFullscreenChange({
            scrollY,
            contentHeight,
            viewportHeight,
            isFullscreen: isFullscreenRef.current,
            enter,
            exit,
        })
        if (!change) return

        lastFullscreenChangeRef.current = now
        // The prop only catches up a render later, and onScroll fires every frame until then.
        isFullscreenRef.current = change.fullscreen
        requestedFullscreenRef.current = change.fullscreen
        setFullscreen(change.fullscreen)

        // Restoring the chrome takes that height back off the scroll viewport, which would push
        // the edge the user just reached back out of view. Re-anchor to it once layout settles.
        if (!change.fullscreen) {
            setTimeout(() => {
                if (change.edge === CHAT_EDGE_TOP) {
                    scrollViewRef.current?.scrollTo({ x: 0, y: 0, animated: false })
                } else {
                    // Coming to rest on the newest message is also where the reader wants to be
                    // kept, so re-anchoring here re-arms the pin rather than just moving once.
                    pinToBottom()
                }
            })
        }
    }

    const handleScroll = event => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
        const currentScrollPosition = contentOffset.y

        // AT-2439 - two-way, and derived purely from where the thread actually is. Scrolling up
        // stands the pin down and coming back to the newest message re-arms it, so a nudge of the
        // wheel mid-answer no longer stops the rest of that answer from being followed.
        handleScrollPosition({
            scrollY: currentScrollPosition,
            contentHeight: contentSize.height,
            viewportHeight: layoutMeasurement.height,
        })

        updateFullscreenMode({
            scrollY: currentScrollPosition,
            contentHeight: contentSize.height,
            viewportHeight: layoutMeasurement.height,
        })
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
            markChatMessagesAsRead(projectId, chat.id).catch(error => {
                console.error('[chat read] Could not clear unread notifications', {
                    projectId,
                    chatId: chat.id,
                    code: error?.code,
                    message: error?.message,
                })
            })
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

    // Only the chat the trigger was created for may show the placeholder, and it consumes the
    // trigger immediately so a later Chat DV mount can never replay it (AT-2084).
    useEffect(() => {
        if (!shouldConsumeBotSpinnerTrigger(triggerBotSpinner, projectId, chat.id)) return
        startWaitingForBotAnswer()
        dispatch(setTriggerBotSpinner(null))
    }, [triggerBotSpinner, projectId, chat.id])

    // A scoped assistant-enabled flag belongs to exactly one chat. Clearing a foreign one here,
    // in the component that owns the chat currently on screen, protects readers such as the
    // "keep the comment popover open" checks without each of them having to know about scopes
    // (AT-2084). An unscoped flag is left alone: that is what the in-chat writers produce and it
    // always refers to the open chat.
    useEffect(() => {
        if (!assistantEnabled) return
        if (isAssistantEnabledScopeMatch(assistantEnabledScope, projectId, chat.id)) return
        dispatch(setAssistantEnabled(false))
    }, [assistantEnabled, assistantEnabledScope, projectId, chat.id])

    // Safety net: never leave the "assistant is working" placeholder up forever when the
    // answer never arrives (failed run, assistant not actually triggered, lost subscription).
    useEffect(() => {
        if (!waitingForBotAnswer) return undefined
        const timeout = setTimeout(() => setWaitingForBotAnswer(false), ASSISTANT_LOADING_TIMEOUT_MS)
        return () => clearTimeout(timeout)
    }, [waitingForBotAnswer])

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

    // The DV can also collapse the layout on its own — that is what the bot line's close button
    // does. The reader is then still sitting at the position that expanded it, so the next scroll
    // event would otherwise reopen what they just closed. Hold expansion until they come back to
    // a resting position, which makes the one after that a deliberate scroll. Only a change the
    // scroll handler did not ask for counts: our own switch reaches the prop a render later.
    useEffect(() => {
        const collapsedByTheDv =
            previousFullscreenRef.current && !isFullscreen && requestedFullscreenRef.current !== false
        previousFullscreenRef.current = isFullscreen
        if (requestedFullscreenRef.current === isFullscreen) requestedFullscreenRef.current = null
        if (collapsedByTheDv) suppressExpandUntilEdgeRef.current = true
    }, [isFullscreen])

    // The expanded layout belongs to the chat tab only: leaving it (tab switch, DV close) must
    // hand the header and navigation bar back to whatever renders next.
    useEffect(() => {
        return () => {
            if (setFullscreenRef.current) setFullscreenRef.current(false)
        }
    }, [])

    return (
        <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
            <PagesAmountSubscriptionContainer projectId={projectId} chat={chat} />
            <CustomScrollView
                ref={scrollViewRef}
                containerStyle={[localStyles.scrollView]}
                showIndicator={shouldShowAssistantScrollIndicator(smallScreenNavigation, assistantResponseIsLoading)}
                onScroll={handleScroll}
                onContentSizeChange={handleContentSizeChange}
                scrollOnLayout={handleViewportLayout}
                scrollEventThrottle={16}
                fixedChildren={
                    hasNewMessagesBelow ? <NewMessagesPill onPress={() => pinToBottom({ animated: true })} /> : null
                }
            >
                {page < chatPagesAmount && messages.length > 0 && (
                    <ShowMoreButton expand={showEarlier} expandText={'show earlier'} loading={loadingMoreMessages} />
                )}
                {loadingMoreMessages && <MessagesSkeleton rowCount={resolveGhostRowCount(LIMIT_SHOW_EARLIER)} />}
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
                        const linkedEmail = getLinkedEmailFromMessage(message, { projectId, chatId: chat.id })
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
        // Shared with the pill, which adds it back to centre on the composer instead of on this
        // (leftward-shifted) message column. See chatComposerLayout.js.
        marginLeft: -CHAT_BOARD_CONTENT_OFFSET,
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
