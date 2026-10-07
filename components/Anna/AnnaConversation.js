import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import useGetMessages from '../../hooks/Chats/useGetMessages'
import MessageItemBody from '../ChatsView/ChatDV/EditorView/MessageItemBody'
import { getAnnaWorkspaceContext } from '../../utils/annaWorkspaceContext'
import { CHAT_INPUT_LIMIT_IN_CHARACTERS } from '../../utils/assistantHelper'
import { getTimestampInMilliseconds } from '../ChatsView/Utils/ChatHelper'
import { resolveEffectiveMessageLoading } from '../ChatsView/ChatDV/EditorView/messageLoadingState'
import { translate } from '../../i18n/TranslationService'
import useAnnaMessageReadState from './useAnnaMessageReadState'
import useAnnaContextNotices from './useAnnaContextNotices'
import useAnnaMessageSends from './useAnnaMessageSends'
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
    pageContext,
}) {
    const contextNotices = useAnnaContextNotices(user.uid, conversation, pageContext)
    const assistantName = assistant?.displayName?.trim() || translate('Assistant')
    const [draft, setDraft] = useState('')
    const [error, setError] = useState('')
    const {
        messages: localMessages,
        sending,
        submit,
        retry,
        acknowledge,
    } = useAnnaMessageSends({
        userId: user.uid,
        conversation,
        resolveConversation,
        onBeforeSend,
        onSendingChange,
    })
    const [newMessages, setNewMessages] = useState(false)
    const scroll = useRef(null)
    const follow = useRef(true)
    const scrollAnchor = useRef(null)
    const composer = useRef(null)
    const draftRef = useRef('')
    const changeDraft = text => {
        draftRef.current = text
        setDraft(text)
    }
    const resumed = useRef(null)
    const mounted = useRef(true)
    const [preparingVoice, setPreparingVoice] = useState(false)
    const voiceRequest = useRef(0)
    const voiceActive = preparingVoice || call.status !== 'idle'
    const seconds = Math.floor(call.voiceSeconds || 0)
    const voiceLabel = translate(
        voiceActive
            ? preparingVoice || call.status === 'connecting'
                ? 'Cancel call'
                : 'End call'
            : 'Talk with %{assistantName}',
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
            voiceRequest.current++
        }
    }, [])
    const toggleVoiceCall = async () => {
        if (preparingVoice) {
            voiceRequest.current++
            setPreparingVoice(false)
            return
        }
        if (call.status !== 'idle') return call.endCall()
        const request = ++voiceRequest.current
        setPreparingVoice(true)
        setError('')
        try {
            // A cached conversation may belong to yesterday. Voice, like text,
            // must resolve today's authoritative target before starting work.
            const thread = resolveConversation ? await resolveConversation() : conversation
            if (!mounted.current || request !== voiceRequest.current) return
            if (!thread?.id) throw new Error(translate('Your conversation could not be loaded. Please try again.'))
            await onBeforeSend?.()
            if (!mounted.current || request !== voiceRequest.current) return
            setPreparingVoice(false)
            await call.startCall({
                assistant: { ...assistant, uid: thread.assistantId },
                projectId: thread.projectId,
                chatId: thread.id,
                skipNavigationOnThreadCreate: true,
            })
        } catch (failure) {
            if (mounted.current && request === voiceRequest.current) setError(failure.message)
        } finally {
            if (mounted.current && request === voiceRequest.current) {
                setPreparingVoice(false)
            }
        }
    }
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

    const send = (event, continuation = null) => {
        event?.preventDefault()
        const text = continuation?.text || draftRef.current.trim()
        if (voiceActive || !text) return
        if (!(user.gold > 0)) {
            setError(translate('You need Gold to talk with %{assistantName}.', { assistantName }))
            return
        }
        setError('')
        follow.current = true
        scrollAnchor.current = null
        submit(text, getAnnaWorkspaceContext() || { path: '/', title: assistantName }, continuation)
        if (!continuation) {
            // Clear synchronously as well as in React, so two submit events in
            // the same frame cannot send the same draft twice.
            changeDraft('')
            composer.current?.focus()
        }
    }
    const retryMessage = key => {
        if (voiceActive) return
        if (!(user.gold > 0)) {
            setError(translate('You need Gold to talk with %{assistantName}.', { assistantName }))
            return
        }
        retry(key)
    }
    useEffect(() => {
        if (!resumeRequest || resumed.current === resumeRequest.id || sending || voiceActive) return
        resumed.current = resumeRequest.id
        send(null, resumeRequest)
        onResumeHandled?.(resumeRequest.id)
    }, [resumeRequest, sending, voiceActive])
    // Keep pending/failed submissions visible even when today's resolved thread
    // differs from the cached conversation or a rollover changes the history.
    const displayedThreads = [...(threads.length ? threads : [{ ...conversation, chatId: conversation.id }])]
    localMessages.forEach(message => {
        const thread = message.thread
        if (
            thread?.id &&
            !displayedThreads.some(
                item => item.projectId === thread.projectId && (item.chatId || item.id) === thread.id
            )
        )
            displayedThreads.push(thread)
    })
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
                {displayedThreads.map(thread => (
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
                        localMessages={localMessages.filter(
                            message =>
                                message.thread?.projectId === thread.projectId &&
                                message.thread?.id === (thread.chatId || thread.id)
                        )}
                        onRetry={retryMessage}
                        onAcknowledge={acknowledge}
                        onChange={messagesChanged}
                        onLoadEarlier={preservePosition}
                        visible={visible}
                        contextNotices={contextNotices.filter(
                            notice =>
                                notice.projectId === thread.projectId && notice.chatId === (thread.chatId || thread.id)
                        )}
                        onSuggest={text => {
                            changeDraft(text)
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
                    </div>
                )}
                <div className="anna-composer-field">
                    <textarea
                        ref={composer}
                        aria-label={translate('Message %{assistantName}', { assistantName })}
                        placeholder={
                            voiceActive
                                ? translate('Voice call in progress')
                                : translate('Talk or type to %{assistantName}…', { assistantName })
                        }
                        value={draft}
                        maxLength={CHAT_INPUT_LIMIT_IN_CHARACTERS}
                        rows={2}
                        disabled={voiceActive}
                        onFocus={onExpand}
                        onChange={event => changeDraft(event.target.value)}
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
                        disabled={voiceActive ? call.status === 'ending' : sending}
                        onClick={toggleVoiceCall}
                    >
                        <Icon name={voiceActive ? 'phone-off' : 'phone-call'} size={20} color="currentColor" />
                    </button>
                    <button
                        type="submit"
                        className="anna-send"
                        disabled={voiceActive || !draft.trim()}
                        aria-label={translate('Send message')}
                    >
                        ↑
                    </button>
                </div>
                <div className="anna-composer-footer">
                    {voiceActive ? (
                        <>
                            <span role="status">
                                {translate(
                                    preparingVoice || call.status === 'connecting'
                                        ? 'Connecting'
                                        : 'Voice call in progress'
                                )}
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
    contextNotices,
    localMessages,
    onRetry,
    onAcknowledge,
}) {
    const assistantName = assistant?.displayName?.trim() || translate('Assistant')
    const [limit, setLimit] = useState(40)
    const chatId = thread.chatId || thread.id
    const messages = useGetMessages(false, false, thread.projectId, chatId, 'topics', limit)
    useAnnaMessageReadState(thread.projectId, chatId, scroll, messages, visible)
    const savedMessageIds = JSON.stringify(messages.map(message => message.id))
    const localMessageIds = JSON.stringify(localMessages.map(message => message.id))
    useEffect(() => {
        onAcknowledge(thread.projectId, chatId, JSON.parse(savedMessageIds))
    }, [thread.projectId, chatId, savedMessageIds, localMessageIds, onAcknowledge])
    const localById = new Map(localMessages.filter(message => message.id).map(message => [message.id, message]))
    const savedIds = new Set(messages.map(message => message.id))
    const displayedMessages = [
        ...messages.map(message => ({ ...message, submission: localById.get(message.id) })),
        ...localMessages
            .filter(message => !savedIds.has(message.id))
            .map(message => ({
                id: message.id || message.key,
                creatorId: user.uid,
                commentText: message.text,
                created: message.created,
                submission: message,
                local: true,
            })),
    ]
    const last = displayedMessages[displayedMessages.length - 1]
    useLayoutEffect(() => {
        onChange()
    }, [
        displayedMessages.length,
        messages.loaded,
        savedMessageIds,
        last?.commentText,
        last?.submission?.status,
        contextNotices.at(-1)?.id,
        onChange,
    ])
    const timeline = [
        ...displayedMessages.map(message => ({
            message,
            created: getTimestampInMilliseconds(message.created || message.lastChangeDate),
        })),
        ...contextNotices.map(notice => ({ notice, created: notice.created })),
    ].sort((a, b) => a.created - b.created)
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
            {current && messages.loaded && displayedMessages.length === 0 && (
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
            {timeline.map(({ message, notice }) => {
                if (notice)
                    return (
                        <p className="anna-context-notice" key={`context-${notice.id}`}>
                            <span>
                                {translate('Looking at:')} {notice.title}
                            </span>
                            <time dateTime={new Date(notice.created).toISOString()}>
                                {new Date(notice.created).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}
                            </time>
                        </p>
                    )
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
                        {message.local ? (
                            <div className="anna-message-text">{message.commentText}</div>
                        ) : (
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
                        )}
                        {message.submission?.status === 'sending' && (
                            <span className="anna-message-status" role="status">
                                {translate('assistantLineSending')}
                            </span>
                        )}
                        {message.submission?.error && (
                            <div className="anna-error" role="alert">
                                {message.submission.error}{' '}
                                <button type="button" onClick={() => onRetry(message.submission.key)}>
                                    {translate('Retry')}
                                </button>
                            </div>
                        )}
                    </article>
                )
            })}
        </section>
    )
}
