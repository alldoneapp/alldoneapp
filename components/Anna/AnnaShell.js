import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import useAnnaConversation from './useAnnaConversation'
import AnnaConversation from './AnnaConversation'
import AnnaWorkspaceHighlight from './AnnaWorkspaceHighlight'
import { resolveAnnaLink, shouldDeferPresentation } from './annaNavigation'
import { isAnnaWorkspacePath } from '../../functions/Assistant/annaWorkspaceContract'
import { getAssistant } from '../AdminPanel/Assistants/assistantsHelper'
import { useVoiceCall } from '../UIComponents/AssistantVoiceCallProvider'
import AssistantVoiceCallButton from '../UIComponents/AssistantVoiceCallButton'
import VoiceMicrophoneStatus from '../UIComponents/VoiceMicrophoneStatus'
import { getDb } from '../../utils/backends/firestore'
import { setAnnaWorkspaceContext } from '../../utils/annaWorkspaceContext'
import NavigationService from '../../utils/NavigationService'
import URLTrigger from '../../URLSystem/URLTrigger'
import { translate, useTranslator } from '../../i18n/TranslationService'
import { sanitizeCallPageContext } from '../../functions/WhatsApp/assistantCallPageContext'
import './anna.css'
import { showGlobalSearchPopup } from '../../redux/actions'
import { pushSheetHistoryLayer, releaseSheetHistoryLayer } from '../../utils/sheetHistoryLayers'

const initiallyOpen = typeof window !== 'undefined' && isAnnaWorkspacePath(window.location.pathname)

export default function AnnaShell({ children, routeId }) {
    useTranslator()
    const dispatch = useDispatch()
    const user = useSelector(state => state.loggedUser)
    const defaultAssistant = useSelector(state => state.defaultAssistant)
    const { conversation, loading, error, retry } = useAnnaConversation(user.uid)
    const assistant = (conversation && getAssistant(conversation.assistantId)) || defaultAssistant || {}
    const call = useVoiceCall()
    const [workspaceOpen, setWorkspaceOpen] = useState(initiallyOpen)
    const [chatExpanded, setChatExpanded] = useState(false)
    const [textBusy, setTextBusy] = useState(false)
    const [pinned, setPinned] = useState(false)
    const [pending, setPending] = useState(null)
    const [pageTitle, setPageTitle] = useState('')
    const [navigationError, setNavigationError] = useState('')
    const workspace = useRef(null)
    const workspaceContent = useRef(null)
    const previousRoute = useRef(routeId)
    const lastPresentation = useRef(undefined)
    const previousContext = useRef('')
    const requestGeneration = useRef(0)

    useEffect(() => {
        // Startup redirects choose the normal app's default route in the background.
        // Keep Anna's portrait visible until the conversation is ready or work is explicitly opened.
        if (previousRoute.current !== routeId && conversation) setWorkspaceOpen(true)
        previousRoute.current = routeId
    }, [routeId])

    useEffect(() => {
        if (!workspaceOpen || !chatExpanded || !window.matchMedia('(max-width: 760px)').matches) return
        const layer = pushSheetHistoryLayer(() => setChatExpanded(false))
        return () => releaseSheetHistoryLayer(layer)
    }, [workspaceOpen, chatExpanded])

    const acknowledge = useCallback(
        (presentation, status) => {
            if (!conversation) return
            getDb()
                .doc(`chatObjects/${conversation.projectId}/chats/${conversation.id}`)
                .update({
                    annaPresentationStatus: { id: presentation.id, status, at: Date.now() },
                })
                .catch(() => {})
        },
        [conversation?.projectId, conversation?.id]
    )

    const present = useCallback(
        async presentation => {
            const generation = ++requestGeneration.current
            setNavigationError('')
            if (presentation.view === 'anna') {
                setWorkspaceOpen(false)
                setPending(null)
                acknowledge(presentation, 'presented')
                return
            }
            if (!isAnnaWorkspacePath(presentation.path)) {
                setNavigationError(translate('This workspace link is not supported.'))
                acknowledge(presentation, 'failed')
                return
            }
            try {
                // Existing URL handling performs the same object reads and access checks as the main app.
                await URLTrigger.processUrl(NavigationService.createNavigationProp(), presentation.path)
                if (generation !== requestGeneration.current) return
                setWorkspaceOpen(true)
                setChatExpanded(false)
                setPending(null)
                acknowledge(presentation, 'opened')
            } catch (_) {
                if (generation !== requestGeneration.current) return
                setNavigationError(translate('This item could not be opened. Please try again.'))
                acknowledge(presentation, 'failed')
            }
        },
        [acknowledge]
    )

    useEffect(() => {
        const presentation = conversation?.annaPresentation
        if (lastPresentation.current === undefined) {
            if (conversation) lastPresentation.current = presentation?.id || null
            return
        }
        if (!presentation?.id || presentation.id === lastPresentation.current) return
        lastPresentation.current = presentation.id
        const editing =
            workspace.current?.contains(document.activeElement) &&
            document.activeElement?.matches('input, textarea, [contenteditable="true"], [role="textbox"]')
        if (shouldDeferPresentation({ pinned, editing })) {
            setPending(presentation)
            acknowledge(presentation, 'deferred')
        } else present(presentation)
    }, [conversation?.annaPresentation?.id, conversation?.id, pinned, present, acknowledge])

    useEffect(() => {
        if (!conversation) return
        let stopped = false
        let publishing = false
        const tick = async () => {
            const context = workspaceOpen
                ? sanitizeCallPageContext({ path: window.location.pathname, title: document.title })
                : { path: '/', title: 'Anna' }
            setAnnaWorkspaceContext(context)
            setPageTitle(
                workspaceOpen ? context?.title?.replace(/\s*[|–-]\s*Alldone.*$/i, '') || translate('Workspace') : ''
            )
            const key = JSON.stringify(context)
            if (!context || publishing || key === previousContext.current) return
            publishing = true
            try {
                await getDb()
                    .doc(`chatObjects/${conversation.projectId}/chats/${conversation.id}`)
                    .update({ annaPageContext: context })
                if (!stopped) previousContext.current = key
            } catch (_) {
                /* Retry fresh visible context; never queue obsolete navigation. */
            } finally {
                publishing = false
            }
        }
        tick()
        const timer = setInterval(tick, 750)
        return () => {
            stopped = true
            clearInterval(timer)
            setAnnaWorkspaceContext(null)
        }
    }, [workspaceOpen, conversation?.projectId, conversation?.id])

    const interceptLink = event => {
        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        )
            return
        const anchor = event.target.closest?.('a[href]')
        const path = anchor && resolveAnnaLink(anchor.href, window.location.origin)
        if (!path) return
        event.preventDefault()
        event.stopPropagation()
        present({ path, id: `link-${Date.now()}`, view: 'link' })
    }
    const showList = view =>
        present({ id: `manual-${Date.now()}`, view, path: `/projects/${view}/${view === 'notes' ? 'all' : 'open'}` })
    const seconds = Math.floor(call.voiceSeconds || 0)
    const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    const photo = assistant.photoURL || assistant.photoURL300 || assistant.photoURL50

    return (
        <div
            className={`anna-shell ${workspaceOpen ? 'anna-has-workspace' : ''} ${chatExpanded ? 'anna-chat-expanded' : ''}`}
            onClickCapture={interceptLink}
        >
            <header className="anna-header">
                <button
                    className="anna-brand"
                    onClick={() => {
                        setWorkspaceOpen(false)
                        setChatExpanded(false)
                    }}
                >
                    anna<span>alldone</span>
                </button>
                <span className="anna-header-note">{translate('A little more space for life')}</span>
                <button className="anna-search" onClick={() => dispatch(showGlobalSearchPopup(false))}>
                    {translate('Search')} ⌕
                </button>
                <a className="anna-workspace-link" href="https://my.alldone.app" target="_blank" rel="noreferrer">
                    {translate('Open alldone')} ↗
                </a>
            </header>
            <main className="anna-layout">
                <section className="anna-conversation" aria-label={translate('Conversation with Anna')}>
                    <button
                        className="anna-mobile-dock"
                        onClick={() => setChatExpanded(value => !value)}
                        aria-expanded={chatExpanded}
                    >
                        {photo && <img src={photo} alt="" />}
                        <span>{translate('Conversation with Anna')}</span>
                        <span>{chatExpanded ? '⌄' : '⌃'}</span>
                    </button>
                    <div className="anna-conversation-heading">
                        <div className="anna-small-avatar">{photo ? <img src={photo} alt="" /> : 'A'}</div>
                        <div>
                            <strong>{assistant.displayName || 'Anna Alldone'}</strong>
                            <span>
                                <i />
                                {call.status === 'idle'
                                    ? translate('Your personal assistant')
                                    : translate('Voice call in progress')}
                            </span>
                        </div>
                    </div>
                    {workspaceOpen && (
                        <div className="anna-context">
                            <span>
                                {translate('Looking at:')} {pageTitle}
                            </span>
                            <button onClick={() => setWorkspaceOpen(false)} aria-label={translate('Back to Anna')}>
                                ×
                            </button>
                        </div>
                    )}
                    {loading && (
                        <div className="anna-empty" role="status">
                            {translate('Connecting with Anna…')}
                        </div>
                    )}
                    {error && (
                        <div className="anna-empty anna-error" role="alert">
                            {error}
                            <button onClick={retry}>{translate('Try again')}</button>
                        </div>
                    )}
                    {conversation && (
                        <AnnaConversation
                            key={conversation.id}
                            conversation={conversation}
                            assistant={assistant}
                            user={user}
                            call={call}
                            onExpand={() => setChatExpanded(true)}
                            onSendingChange={setTextBusy}
                        />
                    )}
                    <div className="anna-voice-controls">
                        {conversation && !textBusy && call.status === 'idle' && (
                            <AssistantVoiceCallButton
                                assistant={{ ...assistant, uid: conversation.assistantId }}
                                projectId={conversation.projectId}
                                chatId={conversation.id}
                                title={translate('Talk with Anna')}
                            />
                        )}
                        {call.status !== 'idle' && (
                            <>
                                <VoiceMicrophoneStatus read={call.getMicrophoneSnapshot} />
                                <span className="anna-duration">{duration}</span>
                                <button
                                    className="anna-end-call"
                                    disabled={call.status === 'ending'}
                                    onClick={call.endCall}
                                >
                                    {translate(call.status === 'connecting' ? 'Cancel call' : 'End call')}
                                </button>
                            </>
                        )}
                        {call.needsAudioPlayback && (
                            <button onClick={call.playCallAudio}>{translate('Enable call audio')}</button>
                        )}
                        {call.status !== 'idle' && call.error && (
                            <p className="anna-error" role="alert">
                                {call.error}
                            </p>
                        )}
                    </div>
                </section>
                <section
                    className="anna-stage"
                    aria-label={workspaceOpen ? translate('Alldone workspace') : translate('Anna')}
                >
                    {pending && (
                        <div className="anna-pending" role="status">
                            <span>
                                {translate('Anna would like to show you:')} {pending.title}
                            </span>
                            <button onClick={() => present(pending)}>{translate('Open')}</button>
                            <button
                                onClick={() => {
                                    acknowledge(pending, 'dismissed')
                                    setPending(null)
                                }}
                                aria-label={translate('Dismiss')}
                            >
                                ×
                            </button>
                        </div>
                    )}
                    {navigationError && (
                        <div className="anna-error" role="alert">
                            {navigationError}
                        </div>
                    )}
                    <div
                        className="anna-workspace"
                        ref={workspace}
                        style={{ display: workspaceOpen ? 'flex' : 'none' }}
                    >
                        <div className="anna-workspace-toolbar">
                            <button onClick={() => setWorkspaceOpen(false)}>← {translate('Back to Anna')}</button>
                            <nav aria-label={translate('Workspace views')}>
                                {['tasks', 'notes', 'goals'].map(view => (
                                    <button key={view} onClick={() => showList(view)}>
                                        {translate(view[0].toUpperCase() + view.slice(1))}
                                    </button>
                                ))}
                            </nav>
                            <button aria-pressed={pinned} onClick={() => setPinned(value => !value)}>
                                {translate(pinned ? 'Pinned' : 'Keep open')}
                            </button>
                        </div>
                        <div className="anna-workspace-content" ref={workspaceContent}>
                            {children}
                            <AnnaWorkspaceHighlight
                                rootRef={workspaceContent}
                                active={
                                    workspaceOpen && !(chatExpanded && window.matchMedia('(max-width: 760px)').matches)
                                }
                                conversation={conversation}
                                routeId={routeId}
                            />
                        </div>
                    </div>
                    {!workspaceOpen && (
                        <div className={`anna-presence ${call.status !== 'idle' ? 'anna-presence-live' : ''}`}>
                            <div className="anna-presence-kicker">
                                <i />
                                {translate(call.status === 'idle' ? 'Here when you need me' : 'We’re connected')}
                            </div>
                            <div className="anna-portrait">
                                {photo ? (
                                    <img src={photo} alt={assistant.displayName || 'Anna Alldone'} />
                                ) : (
                                    <span>A</span>
                                )}
                            </div>
                            <div className="anna-presence-copy">
                                <span className="anna-eyebrow">{translate('Your personal assistant')}</span>
                                <h2>{assistant.displayName || 'Anna Alldone'}</h2>
                                <p>{translate('A conversation for everything you’re working on.')}</p>
                            </div>
                            <div className="anna-quick-views">
                                {['tasks', 'notes', 'goals'].map(view => (
                                    <button key={view} onClick={() => showList(view)}>
                                        {translate(view[0].toUpperCase() + view.slice(1))}
                                        <span>↗</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </section>
            </main>
        </div>
    )
}
