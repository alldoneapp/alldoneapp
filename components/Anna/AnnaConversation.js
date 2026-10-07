import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import useGetMessages from '../../hooks/Chats/useGetMessages'
import MessageItemBody from '../ChatsView/ChatDV/EditorView/MessageItemBody'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import { STAYWARD_COMMENT } from '../Feeds/Utils/HelperFunctions'
import { getDb, runHttpsCallableFunction } from '../../utils/backends/firestore'
import { getAnnaWorkspaceContext } from '../../utils/annaWorkspaceContext'
import { CHAT_INPUT_LIMIT_IN_CHARACTERS } from '../../utils/assistantHelper'
import { getTimestampInMilliseconds } from '../ChatsView/Utils/ChatHelper'
import { resolveEffectiveMessageLoading } from '../ChatsView/ChatDV/EditorView/messageLoadingState'
import { translate } from '../../i18n/TranslationService'
import useAnnaMessageReadState from './useAnnaMessageReadState'
import { getUserPresentationData } from '../ContactsView/Utils/ContactsHelper'
import Icon from '../Icon'
import VoiceMicrophoneStatus from '../UIComponents/VoiceMicrophoneStatus'
import { LIVE_GOLD_PER_MINUTE, LIVE_INITIALIZATION_SECONDS } from '../../functions/WhatsApp/assistantLivePricing'

export default function AnnaConversation({
    conversation,
    assistant,
    user,
    call,
    onExpand,
    onSendingChange,
    threads = [],
    resolveConversation,
    loadEarlier,
    hasEarlier = false,
    visible = true,
    resumeRequest,
    onResumeHandled,
    onBeforeSend,
}) {
    const assistantName = assistant?.displayName?.trim() || translate('Assistant')
    const [draft, setDraft] = useState('')
    const [sending, setSending] = useState(false)
    const [error, setError] = useState('')
    const [retryMessage, setRetryMessage] = useState(null)
    const [newMessages, setNewMessages] = useState(false)
    const scroll = useRef(null)
    const follow = useRef(true)
    const scrollAnchor = useRef(null)
    const inFlight = useRef(false)
    const resumed = useRef(null)
    const mounted = useRef(true)
    const voiceActive = call.status !== 'idle'
    const seconds = Math.floor(call.voiceSeconds || 0)
    const voiceLabel = translate(
        voiceActive ? (call.status === 'connecting' ? 'Cancel call' : 'End call') : 'Talk with %{assistantName}',
        { assistantName }
    )
    const voiceHint = voiceActive
        ? voiceLabel
        : `${voiceLabel}. ${translate('Voice costs %{gold} Gold/min plus normal assistant usage', {
              gold: LIVE_GOLD_PER_MINUTE,
          })}. ${translate('Voice has a %{seconds}-second minimum; connected time includes silence', {
              seconds: LIVE_INITIALIZATION_SECONDS,
          })}`
    const [loadingEarlier, setLoadingEarlier] = useState(false)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])
    const messagesChanged = useCallback(() => {
        const element = scroll.current
        if (!element) return
        const anchor = scrollAnchor.current
        if (anchor?.element.isConnected) {
            element.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top
            return
        }
        if (follow.current) element.scrollTop = element.scrollHeight
        else setNewMessages(true)
    }, [])
    const preservePosition = () => {
        follow.current = false
        const top = scroll.current?.getBoundingClientRect().top || 0
        const element = [...(scroll.current?.querySelectorAll('[data-anna-message-id]') || [])].find(
            node => node.getBoundingClientRect().bottom > top
        )
        scrollAnchor.current = element ? { element, top: element.getBoundingClientRect().top } : null
    }
    const earlier = async () => {
        if (loadingEarlier) return
        preservePosition()
        setLoadingEarlier(true)
        try {
            await loadEarlier()
        } catch (failure) {
            setError(failure.message)
        } finally {
            setLoadingEarlier(false)
        }
    }

    const send = async (event, continuation = null) => {
        event?.preventDefault()
        if (inFlight.current || voiceActive || (!draft.trim() && !retryMessage && !continuation)) return
        if (!(user.gold > 0)) {
            setError(translate('You need Gold to talk with %{assistantName}.', { assistantName }))
            return
        }
        inFlight.current = true
        setSending(true)
        onSendingChange?.(true)
        setError('')
        follow.current = true
        scrollAnchor.current = null
        let messageId = retryMessage?.id
        const text = retryMessage?.text || continuation?.text || draft.trim()
        const keepDraft = retryMessage?.keepDraft || !!continuation
        let thread = retryMessage?.thread || continuation?.thread || conversation
        try {
            if (!retryMessage && !continuation?.thread && resolveConversation) thread = await resolveConversation()
            if (!thread?.id) throw new Error(translate('Your conversation could not be loaded. Please try again.'))
            if (!continuation) await onBeforeSend?.()
            // Context is saved before the request, so "this note" refers to what is visible.
            await getDb()
                .doc(`chatObjects/${thread.projectId}/chats/${thread.id}`)
                .update({ annaPageContext: getAnnaWorkspaceContext() || { path: '/', title: assistantName } })
            if (!messageId) {
                messageId = await createObjectMessage(
                    thread.projectId,
                    thread.id,
                    text,
                    'topics',
                    STAYWARD_COMMENT,
                    null,
                    null,
                    true,
                    true,
                    thread.assistantId
                )
                if (!messageId) throw new Error('Your message was not saved. Please try again.')
            }
            if (mounted.current) {
                if (!keepDraft) setDraft('')
                setRetryMessage({ id: messageId, text, thread, keepDraft })
            }
            await runHttpsCallableFunction(
                'askToBotSecondGen',
                {
                    userId: user.uid,
                    projectId: thread.projectId,
                    objectId: thread.id,
                    objectType: 'topics',
                    messageId,
                    assistantId: thread.assistantId,
                    userIdsToNotify: [user.uid],
                    isPublicFor: thread.isPublicFor || [0],
                    followerIds: [user.uid],
                    language: window.navigator.language,
                },
                { timeout: 3600000 }
            )
            if (mounted.current) setRetryMessage(null)
        } catch (failure) {
            if (mounted.current) {
                if (messageId || continuation) setRetryMessage({ id: messageId, text, thread, keepDraft })
                setError(failure.message || translate('Your message could not be sent. Please try again.'))
            }
        } finally {
            inFlight.current = false
            onSendingChange?.(false)
            if (mounted.current) setSending(false)
        }
    }
    useEffect(() => {
        if (!resumeRequest || resumed.current === resumeRequest.id || sending || voiceActive || retryMessage) return
        resumed.current = resumeRequest.id
        send(null, resumeRequest)
        onResumeHandled?.(resumeRequest.id)
    }, [resumeRequest, sending, voiceActive, retryMessage])
    const latest = () => {
        follow.current = true
        scrollAnchor.current = null
        if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
        setNewMessages(false)
    }
    return (
        <>
            <div
                className="anna-messages"
                ref={scroll}
                role="log"
                aria-label={translate('Conversation with %{assistantName}', { assistantName })}
                onWheel={() => {
                    scrollAnchor.current = null
                }}
                onTouchStart={() => {
                    scrollAnchor.current = null
                }}
                onScroll={() => {
                    const el = scroll.current
                    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
                    if (follow.current) setNewMessages(false)
                }}
            >
                {hasEarlier && (
                    <button className="anna-text-button" disabled={loadingEarlier} onClick={earlier}>
                        {translate(loadingEarlier ? 'Loading earlier days…' : 'Earlier days')}
                    </button>
                )}
                {(threads.length ? threads : [{ ...conversation, chatId: conversation.id }]).map(thread => (
                    <AnnaThreadMessages
                        key={`${thread.projectId}/${thread.chatId || thread.id}`}
                        thread={thread}
                        conversation={conversation}
                        assistant={assistant}
                        user={user}
                        scroll={scroll}
                        current={
                            thread.projectId === conversation.projectId &&
                            (thread.chatId || thread.id) === conversation.id
                        }
                        onChange={messagesChanged}
                        onLoadEarlier={preservePosition}
                        visible={visible}
                        onSuggest={text => {
                            setDraft(text)
                            onExpand()
                        }}
                    />
                ))}
                {sending && (
                    <p className="anna-muted" role="status">
                        {translate('%{assistantName} is working…', { assistantName })}
                    </p>
                )}
            </div>
            {newMessages && (
                <button className="anna-latest" onClick={latest}>
                    {translate('Latest messages')} ↓
                </button>
            )}
            <form className="anna-composer" onSubmit={send}>
                {(error || call.error) && (
                    <div className="anna-error" role="alert">
                        {error || call.error}
                        {error && retryMessage && (
                            <button type="button" onClick={send}>
                                {translate('Retry')}
                            </button>
                        )}
                    </div>
                )}
                <div className="anna-composer-field">
                    <textarea
                        aria-label={translate('Message %{assistantName}', { assistantName })}
                        placeholder={
                            voiceActive
                                ? translate('Voice call in progress')
                                : translate('Talk or type to %{assistantName}…', { assistantName })
                        }
                        value={draft}
                        maxLength={CHAT_INPUT_LIMIT_IN_CHARACTERS}
                        rows={2}
                        disabled={sending || voiceActive || !!retryMessage}
                        onFocus={onExpand}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault()
                                send()
                            }
                        }}
                    />
                    {call.needsAudioPlayback && (
                        <button
                            type="button"
                            className="anna-voice-button"
                            aria-label={translate('Enable call audio')}
                            title={translate('Enable call audio')}
                            onClick={call.playCallAudio}
                        >
                            <Icon name="volume-2" size={20} color="currentColor" />
                        </button>
                    )}
                    <button
                        type="button"
                        className={`anna-voice-button${voiceActive ? ' anna-voice-active' : ''}`}
                        aria-label={voiceLabel}
                        title={voiceHint}
                        disabled={voiceActive ? call.status === 'ending' : sending || !!retryMessage}
                        onClick={() =>
                            voiceActive
                                ? call.endCall()
                                : call.startCall({
                                      assistant: { ...assistant, uid: conversation.assistantId },
                                      projectId: conversation.projectId,
                                      chatId: conversation.id,
                                      skipNavigationOnThreadCreate: true,
                                  })
                        }
                    >
                        <Icon name={voiceActive ? 'phone-off' : 'phone-call'} size={20} color="currentColor" />
                    </button>
                    <button
                        type="submit"
                        className="anna-send"
                        disabled={sending || voiceActive || (!draft.trim() && !retryMessage)}
                        aria-label={translate('Send message')}
                    >
                        ↑
                    </button>
                </div>
                <div className="anna-composer-footer">
                    {voiceActive ? (
                        <>
                            <span role="status">
                                {translate(call.status === 'connecting' ? 'Connecting' : 'Voice call in progress')}
                                {' · '}
                                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                            </span>
                            <VoiceMicrophoneStatus read={call.getMicrophoneSnapshot} compact />
                        </>
                    ) : (
                        <>
                            <span title={translate('Conversation in your default project')}>
                                {translate('Conversation in your default project')}
                            </span>
                            <span className="anna-composer-shortcut">{translate('Shift + Enter for a new line')}</span>
                        </>
                    )}
                </div>
            </form>
        </>
    )
}

function AnnaThreadMessages({
    thread,
    conversation,
    assistant,
    user,
    scroll,
    current,
    onChange,
    onLoadEarlier,
    onSuggest,
    visible,
}) {
    const assistantName = assistant?.displayName?.trim() || translate('Assistant')
    const [limit, setLimit] = useState(40)
    const chatId = thread.chatId || thread.id
    const messages = useGetMessages(false, false, thread.projectId, chatId, 'topics', limit)
    useAnnaMessageReadState(thread.projectId, chatId, scroll, messages, visible)
    const last = messages[messages.length - 1]
    useLayoutEffect(() => {
        onChange()
    }, [messages.length, messages.loaded, last?.commentText, onChange])
    const expandEarlier = () => {
        onLoadEarlier()
        setLimit(value => value + 40)
    }
    return (
        <section aria-label={thread.dateKey || translate('Earlier conversation')}>
            {thread.dateKey && (
                <div className="anna-date-divider">{thread.dateKey.replace(/^(....)(..)(..)$/, '$1-$2-$3')}</div>
            )}
            {messages.length >= limit && (
                <button className="anna-text-button" onClick={expandEarlier}>
                    {translate('Earlier messages')}
                </button>
            )}
            {!messages.loaded && <p className="anna-muted">{translate('Loading your conversation…')}</p>}
            {current && messages.loaded && messages.length === 0 && (
                <div className="anna-welcome">
                    <h1>{translate('What’s on your mind?')}</h1>
                    <p>
                        {translate(
                            'Talk with %{assistantName}. Your tasks, notes and projects are right here when you need them.',
                            { assistantName }
                        )}
                    </p>
                    <div className="anna-suggestions">
                        {['Help me plan my day', 'Show me my tasks', 'Find a note'].map(text => (
                            <button key={text} onClick={() => onSuggest(translate(text))}>
                                {translate(text)}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {messages.map(message => {
                const own = message.creatorId === user.uid && !message.fromAssistant
                const knownCreator = own ? user : getUserPresentationData(message.creatorId)
                const creator =
                    knownCreator?.isUnknownUser && message.fromAssistant
                        ? { displayName: translate('Assistant'), isAssistant: true }
                        : knownCreator
                return (
                    <article
                        key={message.id}
                        data-anna-message-id={message.id}
                        data-anna-chat-id={chatId}
                        data-anna-project-id={thread.projectId}
                        className={`anna-message ${own ? 'anna-message-user' : ''}`}
                    >
                        <div className="anna-message-author">
                            {own ? translate('You') : creator?.displayName}
                            <time>
                                {new Date(
                                    getTimestampInMilliseconds(message.created || message.lastChangeDate)
                                ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </time>
                        </div>
                        <MessageItemBody
                            messageId={message.id}
                            projectId={thread.projectId}
                            commentText={message.commentText || ''}
                            chat={{ ...conversation, ...thread, id: chatId }}
                            objectType="topics"
                            creatorData={creator}
                            isLoading={resolveEffectiveMessageLoading(
                                message,
                                getTimestampInMilliseconds(message.lastChangeDate)
                            )}
                            assistantRun={message.assistantRun}
                            containerStyle={{ margin: 0, padding: 0 }}
                        />
                    </article>
                )
            })}
        </section>
    )
}
