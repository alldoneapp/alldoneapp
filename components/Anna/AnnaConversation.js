import React, { useEffect, useRef, useState } from 'react'
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

export default function AnnaConversation({ conversation, assistant, user, call, onExpand, onSendingChange }) {
    const [limit, setLimit] = useState(40)
    const messages = useGetMessages(false, false, conversation.projectId, conversation.id, 'topics', limit)
    const [draft, setDraft] = useState('')
    const [sending, setSending] = useState(false)
    const [error, setError] = useState('')
    const [retryMessage, setRetryMessage] = useState(null)
    const [newMessages, setNewMessages] = useState(false)
    const scroll = useRef(null)
    const follow = useRef(true)
    const inFlight = useRef(false)
    const mounted = useRef(true)
    const voiceActive = call.status !== 'idle'
    const last = messages[messages.length - 1]
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])
    useEffect(() => {
        const element = scroll.current
        if (!element) return
        if (follow.current) element.scrollTop = element.scrollHeight
        else setNewMessages(true)
    }, [messages.length, last?.commentText])

    const send = async event => {
        event?.preventDefault()
        if (inFlight.current || voiceActive || (!draft.trim() && !retryMessage)) return
        if (!(user.gold > 0)) {
            setError(translate('You need Gold to talk with Anna.'))
            return
        }
        inFlight.current = true
        setSending(true)
        onSendingChange?.(true)
        setError('')
        follow.current = true
        let messageId = retryMessage?.id
        const text = retryMessage?.text || draft.trim()
        try {
            // Context is saved before the request, so "this note" refers to what is visible.
            await getDb()
                .doc(`chatObjects/${conversation.projectId}/chats/${conversation.id}`)
                .update({ annaPageContext: getAnnaWorkspaceContext() || { path: '/', title: 'Anna' } })
            if (!messageId) {
                messageId = await createObjectMessage(
                    conversation.projectId,
                    conversation.id,
                    text,
                    'topics',
                    STAYWARD_COMMENT,
                    null,
                    null,
                    true,
                    true,
                    conversation.assistantId
                )
                if (!messageId) throw new Error('Your message was not saved. Please try again.')
            }
            if (mounted.current) {
                setDraft('')
                setRetryMessage({ id: messageId, text })
            }
            await runHttpsCallableFunction(
                'askToBotSecondGen',
                {
                    userId: user.uid,
                    projectId: conversation.projectId,
                    objectId: conversation.id,
                    objectType: 'topics',
                    messageId,
                    assistantId: conversation.assistantId,
                    userIdsToNotify: [user.uid],
                    isPublicFor: [user.uid],
                    followerIds: [user.uid],
                    language: window.navigator.language,
                },
                { timeout: 3600000 }
            )
            if (mounted.current) setRetryMessage(null)
        } catch (failure) {
            if (mounted.current) {
                if (messageId) setRetryMessage({ id: messageId, text })
                setError(failure.message || translate('Your message could not be sent. Please try again.'))
            }
        } finally {
            inFlight.current = false
            onSendingChange?.(false)
            if (mounted.current) setSending(false)
        }
    }
    const latest = () => {
        follow.current = true
        if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
        setNewMessages(false)
    }
    return (
        <>
            <div
                className="anna-messages"
                ref={scroll}
                role="log"
                aria-label={translate('Conversation with Anna')}
                onScroll={() => {
                    const el = scroll.current
                    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
                    if (follow.current) setNewMessages(false)
                }}
            >
                {messages.length >= limit && (
                    <button
                        className="anna-text-button"
                        onClick={() => {
                            follow.current = false
                            setLimit(value => value + 40)
                        }}
                    >
                        {translate('Earlier messages')}
                    </button>
                )}
                {!messages.loaded && <p className="anna-muted">{translate('Loading your conversation…')}</p>}
                {messages.loaded && messages.length === 0 && (
                    <div className="anna-welcome">
                        <span className="anna-eyebrow">{translate('A little more space for life')}</span>
                        <h1>{translate('What’s on your mind?')}</h1>
                        <p>
                            {translate(
                                'Talk with Anna. Your tasks, notes and projects are right here when you need them.'
                            )}
                        </p>
                        <div className="anna-suggestions">
                            {['Help me plan my day', 'Show me my tasks', 'Find a note'].map(text => (
                                <button
                                    key={text}
                                    onClick={() => {
                                        setDraft(translate(text))
                                        onExpand()
                                    }}
                                >
                                    {translate(text)}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map(message => {
                    const own = message.creatorId === user.uid && !message.fromAssistant
                    return (
                        <article key={message.id} className={`anna-message ${own ? 'anna-message-user' : ''}`}>
                            <div className="anna-message-author">
                                {own ? translate('You') : assistant.displayName || 'Anna'}
                                <time>
                                    {new Date(
                                        getTimestampInMilliseconds(message.created || message.lastChangeDate)
                                    ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </time>
                            </div>
                            <MessageItemBody
                                messageId={message.id}
                                projectId={conversation.projectId}
                                commentText={message.commentText || ''}
                                chat={conversation}
                                objectType="topics"
                                creatorData={own ? user : { ...assistant, isAssistant: true }}
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
                {sending && (
                    <p className="anna-muted" role="status">
                        {translate('Anna is working…')}
                    </p>
                )}
            </div>
            {newMessages && (
                <button className="anna-latest" onClick={latest}>
                    {translate('Latest messages')} ↓
                </button>
            )}
            <form className="anna-composer" onSubmit={send}>
                {error && (
                    <div className="anna-error" role="alert">
                        {error}
                        {retryMessage && (
                            <button type="button" onClick={send}>
                                {translate('Retry')}
                            </button>
                        )}
                    </div>
                )}
                <div className="anna-composer-field">
                    <textarea
                        aria-label={translate('Message Anna')}
                        placeholder={
                            voiceActive ? translate('Voice call in progress') : translate('Talk or type to Anna…')
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
                    <span>{translate('Your private conversation')}</span>
                    <span>{translate('Shift + Enter for a new line')}</span>
                </div>
            </form>
        </>
    )
}
