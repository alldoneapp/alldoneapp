import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
} from 'react'
import useGetMessages from '../../hooks/Chats/useGetMessages'
import AnnaMessageBody from './AnnaMessageBody'
import { getAnnaWorkspaceContext } from '../../utils/annaWorkspaceContext'
import { getTimestampInMilliseconds } from '../ChatsView/Utils/ChatHelper'
import {
    resolveEffectiveMessageLoading,
    showsAssistantLiveActivity,
} from '../ChatsView/ChatDV/EditorView/messageLoadingState'
import { translate } from '../../i18n/TranslationService'
import useAnnaMessageReadState from './useAnnaMessageReadState'
import useAnnaContextNotices from './useAnnaContextNotices'
import useAnnaActivityNotices from './useAnnaActivityNotices'
import useAnnaMessageSends from './useAnnaMessageSends'
import { getAnnaWorkspaceWorkState } from './annaWorkspaceWorkState'
import { getUserPresentationData } from '../ContactsView/Utils/ContactsHelper'
import Icon from '../Icon'
import AnnaCallAudioControls from './AnnaCallAudioControls'
import VoiceCallConnecting from '../UIComponents/VoiceCallConnecting'
import RambleButton, { RAMBLE_PHASE_IDLE } from '../UIControls/RambleButton'
import AddFeedAttachButton from '../Feeds/AddFeed/AddFeedAttachButton'
import { isDictationSupported } from '../../hooks/useRambleRecorder'
import { LIVE_GOLD_PER_MINUTE, LIVE_INITIALIZATION_SECONDS } from '../../functions/WhatsApp/assistantLivePricing'
import { isBrowserOffline } from '../../utils/connectionState'
import AnnaChatComposer from './AnnaChatComposer'
import useAnnaDraft from './useAnnaDraft'
import AnnaMessageAuthor from './AnnaMessageAuthor'
import AnnaTimestamp from './AnnaTimestamp'
import { annaMessageCache } from './annaMessageCache'
import AnnaActivityNotice from './AnnaActivityNotice'
import AssistantProgress from '../ChatsView/ChatDV/EditorView/AssistantProgress'
import useAnnaChatScroll from './useAnnaChatScroll'

const MESSAGES_PER_PAGE = 50

const getMessageCreator = (message, user, assistant) => {
    if (message.creatorId === user.uid && !message.fromAssistant) return user
    const creator = getUserPresentationData(message.creatorId)
    if (!creator?.isUnknownUser || !message.fromAssistant) return creator
    const selectedCreator = assistant?.uid && message.creatorId === assistant.uid ? assistant : null
    return {
        displayName: selectedCreator?.displayName || translate('Assistant'),
        photoURL: selectedCreator?.photoURL50,
        isAssistant: true,
    }
}

const AnnaConversation = forwardRef(function AnnaConversation(
    {
        conversation,
        assistant,
        user,
        call,
        onExpand,
        onSendingChange,
        onWorkStateChange,
        threads,
        resolveConversation,
        loadEarlier,
        hasEarlier = false,
        offline = false,
        visible = true,
        active = true,
        resumeRequest,
        onResumeHandled,
        onBeforeSend,
        pageContext,
    },
    ref
) {
    const pageNotices = useAnnaContextNotices(user.uid, conversation, pageContext)
    const activityNotices = useAnnaActivityNotices(user.uid, conversation, active)
    const contextNotices = [...pageNotices, ...activityNotices].sort((a, b) => a.created - b.created)
    const assistantName = assistant?.displayName?.trim() || translate('Assistant')
    // The draft belongs to the continuous conversation, including across midnight.
    const {
        initialText,
        draft: draftRef,
        hasText,
        change: changeDraft,
    } = useAnnaDraft({
        userId: user.uid,
        projectId: user.defaultProjectId || conversation.projectId,
        objectType: 'anna',
        objectId: 'conversation',
    })
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
    const content = useRef(null)
    const chatScroll = useAnnaChatScroll(scroll, content, visible)
    const { follow, update: updateScroll, stop: stopFollowing } = chatScroll
    const scrollAnchor = useRef(null)
    const composer = useRef(null)
    const [dictationPhase, setDictationPhase] = useState(RAMBLE_PHASE_IDLE)
    const dictationBusy = dictationPhase !== RAMBLE_PHASE_IDLE
    const resumed = useRef(null)
    const mounted = useRef(true)
    const insertDictatedText = text => {
        const input = composer.current
        const transcript = text?.replace(/\r\n?/g, '\n').trim()
        if (!mounted.current || !input || !transcript) return
        input.insertDictation(transcript, visible)
    }
    const [preparingVoice, setPreparingVoice] = useState(false)
    const voiceRequest = useRef(0)
    const preparingVoiceRef = useRef(false)
    const voiceConnecting = preparingVoice || call.status === 'connecting'
    const voiceActive = preparingVoice || call.status !== 'idle'
    const placeholder = voiceActive
        ? translate('Voice call in progress')
        : translate('Talk or type to %{assistantName}…', { assistantName })
    const keepLatestVisible = useCallback(() => {
        updateScroll()
    }, [updateScroll])
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
            if (preparingVoiceRef.current) call.endCall()
        }
    }, [])
    const toggleVoiceCall = async () => {
        if (dictationBusy) return
        if (preparingVoiceRef.current) {
            preparingVoiceRef.current = false
            voiceRequest.current++
            setPreparingVoice(false)
            call.endCall()
            return
        }
        if (call.status !== 'idle') return call.endCall()
        if (offline || isBrowserOffline()) return
        const request = ++voiceRequest.current
        preparingVoiceRef.current = true
        setPreparingVoice(true)
        setError('')
        try {
            // Enter the provider synchronously in the click: audio activation
            // and the screen wake lease must precede thread/network awaits.
            await call.startCall({
                assistant,
                resolveTarget: async () => {
                    const thread = resolveConversation ? await resolveConversation() : conversation
                    if (!mounted.current || request !== voiceRequest.current) return null
                    if (!thread?.id)
                        throw new Error(translate('Your conversation could not be loaded. Please try again.'))
                    await onBeforeSend?.()
                    if (!mounted.current || request !== voiceRequest.current) return null
                    preparingVoiceRef.current = false
                    setPreparingVoice(false)
                    return {
                        assistant: { ...assistant, uid: thread.assistantId },
                        projectId: thread.projectId,
                        chatId: thread.id,
                    }
                },
                skipNavigationOnThreadCreate: true,
            })
        } catch (failure) {
            if (mounted.current && request === voiceRequest.current) setError(failure.message)
        } finally {
            if (mounted.current && request === voiceRequest.current) {
                preparingVoiceRef.current = false
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
        if (follow.current) updateScroll()
        else setNewMessages(true)
    }, [updateScroll])
    const preservePosition = () => {
        stopFollowing()
        const top = scroll.current?.getBoundingClientRect().top || 0
        const element = [...(scroll.current?.querySelectorAll('[data-anna-message-id]') || [])].find(
            node => node.getBoundingClientRect().bottom > top
        )
        scrollAnchor.current = element ? { element, top: element.getBoundingClientRect().top } : null
    }
    const earlier = async () => {
        if (loadingEarlier || offline || isBrowserOffline()) return
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
        if (voiceActive || dictationBusy || !text || offline || isBrowserOffline()) return
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
            composer.current?.clear()
            composer.current?.focus()
        }
    }
    const retryMessage = key => {
        if (voiceActive || offline || isBrowserOffline()) return
        if (!(user.gold > 0)) {
            setError(translate('You need Gold to talk with %{assistantName}.', { assistantName }))
            return
        }
        retry(key)
    }
    useEffect(() => {
        if (
            !resumeRequest ||
            resumed.current === resumeRequest.id ||
            sending ||
            voiceActive ||
            dictationBusy ||
            offline ||
            isBrowserOffline()
        )
            return
        resumed.current = resumeRequest.id
        send(null, resumeRequest)
        onResumeHandled?.(resumeRequest.id)
    }, [resumeRequest, sending, voiceActive, dictationBusy, offline])
    // Keep pending/failed submissions visible even when today's resolved thread
    // differs from the cached conversation or a rollover changes the history.
    const displayedThreads = [...(threads || [{ ...conversation, chatId: conversation.id }])]
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
    const latest = useCallback(() => {
        scrollAnchor.current = null
        chatScroll.latest()
        setNewMessages(false)
    }, [chatScroll.latest])
    const activate = useCallback(() => {
        scrollAnchor.current = null
        chatScroll.activate()
        setNewMessages(false)
    }, [chatScroll.activate])
    // Every activation returns to the end, including restored URLs and async
    // mounting. Streaming and the Latest messages button retain smooth motion.
    useLayoutEffect(() => {
        if (active && visible) activate()
    }, [active, visible, activate])
    useImperativeHandle(ref, () => ({ scrollToLatest: activate, focusInput: () => composer.current?.focus() }), [
        activate,
    ])
    return (
        <>
            <div
                className="anna-messages"
                ref={scroll}
                role="log"
                aria-label={translate('Conversation with %{assistantName}', { assistantName })}
                tabIndex={0}
                onWheel={event => {
                    scrollAnchor.current = null
                    chatScroll.onWheel(event)
                }}
                onTouchStart={event => {
                    scrollAnchor.current = null
                    chatScroll.onTouchStart(event)
                }}
                onTouchMove={chatScroll.onTouchMove}
                onKeyDown={chatScroll.onKeyDown}
                onScroll={() => {
                    if (chatScroll.onScroll()) setNewMessages(false)
                }}
            >
                <div className="anna-message-timeline" ref={content}>
                    {hasEarlier && (
                        <button className="anna-text-button" disabled={loadingEarlier || offline} onClick={earlier}>
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
                            onWorkStateChange={onWorkStateChange}
                            onChange={messagesChanged}
                            onLoadEarlier={preservePosition}
                            visible={visible}
                            offline={offline}
                            reducedMotion={chatScroll.reducedMotion}
                            contextNotices={contextNotices.filter(
                                notice =>
                                    notice.projectId === thread.projectId &&
                                    notice.chatId === (thread.chatId || thread.id)
                            )}
                            onSuggest={text => {
                                changeDraft(text)
                                composer.current?.setContent(text)
                                onExpand()
                            }}
                        />
                    ))}
                </div>
            </div>
            {newMessages && (
                <button className="anna-latest" onClick={latest}>
                    {translate('Latest messages')} ↓
                </button>
            )}
            <form className="anna-composer" onSubmit={send}>
                {offline && (
                    <p className="anna-muted" role="status">
                        {translate(
                            'You are offline. You can read saved messages and write a draft. Reconnect to send.'
                        )}
                    </p>
                )}
                {(error || call.error) && (
                    <div className="anna-error" role="alert">
                        {error || call.error}
                    </div>
                )}
                <div className={`anna-composer-slot${voiceConnecting ? ' anna-composer-slot-connecting' : ''}`}>
                    {/* Keep the editor mounted to preserve its draft and exact dimensions while connecting. */}
                    <div className="anna-composer-field" aria-hidden={voiceConnecting || undefined}>
                        <div hidden={voiceActive && !voiceConnecting} aria-hidden={voiceActive || undefined}>
                            <AnnaChatComposer
                                ref={composer}
                                projectId={conversation.projectId}
                                label={translate('Message %{assistantName}', { assistantName })}
                                placeholder={placeholder}
                                initialText={initialText}
                                onResize={keepLatestVisible}
                                disabled={voiceActive}
                                onFocus={onExpand}
                                onChangeText={changeDraft}
                                onSubmit={() => send()}
                            />
                        </div>
                        {voiceActive && !voiceConnecting && <AnnaCallAudioControls call={call} />}
                        <div className="anna-composer-toolbar">
                            {voiceActive && !voiceConnecting ? (
                                <span className="anna-call-duration" role="status">
                                    {translate('Voice call in progress')}
                                    {' · '}
                                    {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                                </span>
                            ) : (
                                <div className="anna-composer-tools">
                                    {!voiceActive && !offline && conversation.projectId && isDictationSupported() && (
                                        <RambleButton
                                            projectId={conversation.projectId}
                                            targetKind="generic"
                                            getCurrentText={() => draftRef.current}
                                            onTextReady={insertDictatedText}
                                            onPhaseChange={setDictationPhase}
                                            getOverlayViewport={() => {
                                                const pane = composer.current?.getPane()
                                                return (
                                                    pane && { ...pane.getBoundingClientRect().toJSON(), active: true }
                                                )
                                            }}
                                            style={{ minWidth: 40, height: 40, borderRadius: 20, flexShrink: 0 }}
                                        />
                                    )}
                                    <div className="anna-composer-attachment">
                                        <AddFeedAttachButton
                                            compact
                                            buttonStyle={{
                                                width: 40,
                                                height: 40,
                                                minHeight: 40,
                                                borderRadius: 20,
                                                alignSelf: 'center',
                                            }}
                                            projectId={conversation.projectId}
                                            getPopoverViewport={() => {
                                                const pane = composer.current?.getPane()
                                                return (
                                                    pane && { ...pane.getBoundingClientRect().toJSON(), active: true }
                                                )
                                            }}
                                            isDisabled={
                                                voiceActive || dictationBusy || offline || !conversation.projectId
                                            }
                                            addAttachmentTag={(text, uri) => {
                                                if (voiceActive || dictationBusy || offline || isBrowserOffline())
                                                    return
                                                composer.current?.addAttachment(text, uri)
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                            <div className="anna-composer-actions">
                                {voiceActive && !voiceConnecting && (
                                    <button
                                        type="button"
                                        className="anna-voice-button"
                                        disabled={call.status === 'ending'}
                                        aria-label={translate(
                                            call.microphoneMuted ? 'Unmute assistant call' : 'Mute assistant call'
                                        )}
                                        aria-pressed={!!call.microphoneMuted}
                                        onClick={call.toggleMicrophoneMuted}
                                    >
                                        <Icon
                                            name={call.microphoneMuted ? 'mic-off' : 'mic'}
                                            size={20}
                                            color="currentColor"
                                        />
                                    </button>
                                )}
                                {!voiceConnecting && call.needsAudioPlayback && (
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
                                    disabled={
                                        voiceActive ? call.status === 'ending' : offline || sending || dictationBusy
                                    }
                                    onClick={toggleVoiceCall}
                                >
                                    <Icon
                                        name={voiceConnecting ? 'x' : voiceActive ? 'phone-off' : 'phone-call'}
                                        size={20}
                                        color="currentColor"
                                    />
                                </button>
                                {!voiceActive && (
                                    <button
                                        type="submit"
                                        className="anna-send"
                                        disabled={offline || voiceActive || dictationBusy || !hasText}
                                        aria-label={translate('Send message')}
                                    >
                                        <Icon name="arrow-up" size={20} color="currentColor" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    {voiceConnecting && (
                        <div className="anna-composer-connecting">
                            <VoiceCallConnecting assistantName={assistantName} style={{ flex: 1, borderRadius: 20 }} />
                            {call.needsAudioPlayback && (
                                <button
                                    type="button"
                                    className="anna-text-button"
                                    aria-label={translate('Enable call audio')}
                                    onClick={call.playCallAudio}
                                >
                                    {translate('Enable call audio')}
                                </button>
                            )}
                            <button
                                type="button"
                                className="anna-text-button anna-composer-cancel"
                                onClick={toggleVoiceCall}
                            >
                                {translate('Cancel call')}
                            </button>
                        </div>
                    )}
                </div>
                {(!voiceActive || voiceConnecting) && (
                    <div
                        className="anna-composer-footer anna-composer-footer-idle"
                        style={voiceConnecting ? { visibility: 'hidden' } : undefined}
                        aria-hidden={voiceConnecting || undefined}
                    >
                        <span className="anna-composer-shortcut">{translate('Shift + Enter for a new line')}</span>
                    </div>
                )}
            </form>
        </>
    )
})

export default AnnaConversation

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
    offline,
    contextNotices,
    localMessages,
    onRetry,
    onAcknowledge,
    onWorkStateChange,
    reducedMotion,
}) {
    const assistantName = assistant?.displayName?.trim() || translate('Assistant')
    const [limit, setLimit] = useState(MESSAGES_PER_PAGE)
    const chatId = thread.chatId || thread.id
    const messages = useGetMessages(false, false, thread.projectId, chatId, 'topics', limit, annaMessageCache)
    // A persisted response takes over from local startup feedback, including one that
    // has already finished while the callable is still completing its cleanup.
    const repliedMessageIds = new Set(
        messages
            .filter(message => message.assistantRun?.kind === 'chat')
            .map(message => message.assistantRun.triggerMessageId)
    )
    // Older servers omitted triggerMessageId. Only use their visible card as a fallback within
    // this thread; a card in yesterday's chat cannot represent a newly submitted request today.
    const hasLegacyLiveActivity = messages.some(
        message =>
            !message.assistantRun?.triggerMessageId &&
            showsAssistantLiveActivity(
                getMessageCreator(message, user, assistant)?.isAssistant,
                resolveEffectiveMessageLoading(message, getTimestampInMilliseconds(message.lastChangeDate)),
                message.assistantRun
            )
    )
    const pendingMessage =
        !hasLegacyLiveActivity &&
        localMessages.findLast(message => message.running && !repliedMessageIds.has(message.id))
    const workStateKey = JSON.stringify(getAnnaWorkspaceWorkState(messages))
    useEffect(() => {
        if (current) onWorkStateChange?.({ projectId: thread.projectId, chatId, ...JSON.parse(workStateKey) })
    }, [current, thread.projectId, chatId, workStateKey, onWorkStateChange])
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
                lastChangeDate: message.created,
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
        contextNotices.length,
        contextNotices.at(-1)?.id,
        pendingMessage?.key,
        pendingMessage?.status,
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
        setLimit(value => value + MESSAGES_PER_PAGE)
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
            {offline && messages.loaded && displayedMessages.length === 0 && (
                <p className="anna-muted">{translate('This conversation is not available offline yet.')}</p>
            )}
            {current && !offline && messages.loaded && displayedMessages.length === 0 && (
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
                if (notice?.kind)
                    return <AnnaActivityNotice key={`context-${notice.id}`} notice={notice} onChange={onChange} />
                if (notice)
                    return (
                        <p className="anna-context-notice" key={`context-${notice.id}`}>
                            <span>
                                {translate('Looking at:')} {notice.title}
                            </span>
                            <AnnaTimestamp timestamp={notice.created} />
                        </p>
                    )
                const own = message.creatorId === user.uid && !message.fromAssistant
                const creator = getMessageCreator(message, user, assistant)
                return (
                    <article
                        key={message.id}
                        data-anna-message-id={message.id}
                        data-anna-chat-id={chatId}
                        data-anna-project-id={thread.projectId}
                        className={`anna-message ${own ? 'anna-message-user' : ''}`}
                    >
                        <AnnaMessageAuthor message={message} creator={creator} own={own} />
                        <AnnaMessageBody
                            reducedMotion={reducedMotion}
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
            {pendingMessage && (
                <div className="anna-message anna-pending-activity" role="status" aria-label={assistantName}>
                    <AssistantProgress
                        runId={pendingMessage.key}
                        activity={{ phase: 'preparing', startedAt: pendingMessage.created }}
                        preparingText={translate(
                            pendingMessage.status === 'sending'
                                ? 'assistant_progress_sending'
                                : 'assistant_progress_waiting'
                        )}
                    />
                </div>
            )}
        </section>
    )
}
