import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import useAnnaConversation from './useAnnaConversation'
import AnnaConversation from './AnnaConversation'
import AnnaWorkspaceHighlight from './AnnaWorkspaceHighlight'
import AnnaBrowserWorkspace from './AnnaBrowserWorkspace'
import { resolveAnnaLink } from './annaNavigation'
import { isAnnaWorkspacePath } from '../../functions/Assistant/annaWorkspaceContract'
import { getAssistant } from '../AdminPanel/Assistants/assistantsHelper'
import { useVoiceCall } from '../UIComponents/AssistantVoiceCallProvider'
import AssistantVoiceCallButton from '../UIComponents/AssistantVoiceCallButton'
import VoiceMicrophoneStatus from '../UIComponents/VoiceMicrophoneStatus'
import { getDb } from '../../utils/backends/firestore'
import { setAnnaWorkspaceContext } from '../../utils/annaWorkspaceContext'
import { setAnnaMode, useAnnaMode } from '../../utils/annaMode'
import NavigationService from '../../utils/NavigationService'
import URLTrigger from '../../URLSystem/URLTrigger'
import { translate, useTranslator } from '../../i18n/TranslationService'
import { sanitizeCallPageContext } from '../../functions/WhatsApp/assistantCallPageContext'
import './anna.css'

function useMobilePane() {
    const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 760px)').matches || false)
    useEffect(() => {
        const media = window.matchMedia?.('(max-width: 760px)')
        if (!media) return
        const update = () => setMobile(media.matches)
        media.addEventListener('change', update)
        return () => media.removeEventListener('change', update)
    }, [])
    return mobile
}

// Always mounted around the same route subtree, including in fullscreen Alldone. A layout switch
// must never destroy a note editor, an unsent message, a selection, or the workspace scroll state.
export default function AnnaShell({ children, routeId }) {
    useTranslator()
    const active = useAnnaMode()
    const user = useSelector(state => state.loggedUser)
    const defaultAssistant = useSelector(state => state.defaultAssistant)
    const call = useVoiceCall()
    const [visited, setVisited] = useState(active)
    const [textBusy, setTextBusy] = useState(false)
    const { conversation, loading, error, retry, threads, resolveConversation, loadEarlier, nextBefore } =
        useAnnaConversation(user.uid, { enabled: active, user, hold: textBusy || call.status !== 'idle' })
    const assistant = (conversation && getAssistant(conversation.assistantId)) || defaultAssistant || {}
    const [mobilePane, setMobilePane] = useState('chat')
    const [surface, setSurface] = useState('alldone')
    const [control, setControl] = useState(false)
    const [browserControl, setBrowserControl] = useState(false)
    const [browser, setBrowser] = useState(null)
    const [resumeRequest, setResumeRequest] = useState(null)
    const [controlBusy, setControlBusy] = useState(false)
    const controlWrite = useRef(false)
    const [pending, setPending] = useState(null)
    const [pageTitle, setPageTitle] = useState('')
    const [navigationError, setNavigationError] = useState('')
    const [chatWidth, setChatWidth] = useState(36)
    const workspaceContent = useRef(null)
    const layout = useRef(null)
    const controlRef = useRef(false)
    const presentationSeen = useRef(new Set())
    const browserSeen = useRef(null)
    const heldBrowser = useRef(false)
    const browserRef = useRef(null)
    const nextBrowserRef = useRef(null)
    const requestGeneration = useRef(0)
    const mobile = useMobilePane()
    const visibleWorkspace = active && (mobilePane === 'workspace' || !mobile)

    useEffect(() => {
        if (active) setVisited(true)
    }, [active])
    useEffect(() => {
        if (!visited || !user.uid) return
        const stopControl = getDb()
            .doc(`users/${user.uid}/private/annaWorkspace`)
            .onSnapshot(
                snapshot => {
                    if (controlWrite.current) return
                    const held = snapshot.data()?.control === 'user'
                    controlRef.current = held
                    setControl(held)
                },
                () => {}
            )
        const stopBrowser = getDb()
            .doc(`users/${user.uid}/private/annaBrowser`)
            .onSnapshot(
                snapshot => {
                    const next = snapshot.exists ? snapshot.data() : null
                    nextBrowserRef.current = next
                    if (heldBrowser.current && browserRef.current?.runId !== next?.runId) return
                    browserRef.current = next
                    setBrowser(next)
                    if (next?.runId && browserSeen.current !== next.runId) {
                        browserSeen.current = next.runId
                        if (!controlRef.current && Date.now() - Number(next.updatedAt || 0) < 120000)
                            setSurface('browser')
                    }
                },
                () => {}
            )
        return () => {
            stopControl()
            stopBrowser()
        }
    }, [visited, user.uid])

    const resumeWork = useCallback(
        (context, surfaceName = 'alldone') => {
            if (!context) return
            // The ongoing voice conversation can continue using the released surface. Do not
            // enqueue a second text execution after that call has already handled the hand-back.
            if (call.status !== 'idle') return
            const daily =
                ['topics', 'chats'].includes(context.objectType) &&
                (context.objectId === `anna_${user.uid}` || context.objectId?.startsWith('AnnaChat'))
            const text = translate(
                surfaceName === 'browser'
                    ? 'I have returned browser control to you. Please continue my current request.'
                    : 'I have returned Alldone control to you. Please continue my current request.'
            )
            setResumeRequest({
                id: `${context.at}-${surfaceName}`,
                text:
                    text +
                    (!daily && context.objectType === 'tasks' && !context.objectId?.startsWith('direct__')
                        ? `\nhttps://my.alldone.app/projects/${context.projectId}/tasks/${context.objectId}/chat`
                        : ''),
                thread: daily
                    ? { projectId: context.projectId, id: context.objectId, assistantId: context.assistantId }
                    : null,
            })
        },
        [user.uid, call.status]
    )
    const setWorkspaceControl = useCallback(
        async held => {
            if (!user.uid || controlRef.current === held || controlWrite.current) return
            controlWrite.current = true
            setControlBusy(true)
            const previous = controlRef.current
            controlRef.current = held
            setControl(held)
            try {
                const ref = getDb().doc(`users/${user.uid}/private/annaWorkspace`)
                const interrupted = await getDb().runTransaction(async tx => {
                    const state = (await tx.get(ref)).data()
                    tx.set(
                        ref,
                        {
                            control: held ? 'user' : 'assistant',
                            page: sanitizeCallPageContext({ path: window.location.pathname, title: document.title }),
                            ...(!held ? { blocked: null } : {}),
                            updatedAt: Date.now(),
                        },
                        { merge: true }
                    )
                    return state?.blocked
                })
                if (!held) resumeWork(interrupted)
            } catch (_) {
                controlRef.current = previous
                setControl(previous)
                setNavigationError(translate('Could not change workspace control. Please try again.'))
            } finally {
                controlWrite.current = false
                setControlBusy(false)
            }
        },
        [user.uid, resumeWork]
    )
    const acknowledge = useCallback(
        (presentation, status) => {
            if (!conversation || (presentation.manual && conversation.annaPresentation?.id !== presentation.id)) return
            getDb()
                .doc(`chatObjects/${conversation.projectId}/chats/${conversation.id}`)
                .update({ annaPresentationStatus: { id: presentation.id, status, at: Date.now() } })
                .catch(() => {})
        },
        [conversation?.projectId, conversation?.id, conversation?.annaPresentation?.id]
    )
    const present = useCallback(
        async presentation => {
            const generation = ++requestGeneration.current
            setNavigationError('')
            if (presentation.view === 'anna') {
                setMobilePane('chat')
                acknowledge(presentation, 'presented')
                return
            }
            if (!isAnnaWorkspacePath(presentation.path)) {
                setNavigationError(translate('This workspace link is not supported.'))
                acknowledge(presentation, 'failed')
                return
            }
            try {
                await URLTrigger.processUrl(NavigationService.createNavigationProp(), presentation.path)
                if (generation !== requestGeneration.current) return
                setSurface('alldone')
                if (presentation.manual) setMobilePane('workspace')
                setPending(null)
                acknowledge(presentation, mobile && mobilePane === 'chat' ? 'opened_hidden' : 'opened')
            } catch (_) {
                if (generation !== requestGeneration.current) return
                setNavigationError(translate('This item could not be opened. Please try again.'))
                acknowledge(presentation, 'failed')
            }
        },
        [acknowledge, mobile, mobilePane]
    )

    useEffect(() => {
        const presentation = conversation?.annaPresentation
        if (!presentation?.id || presentationSeen.current.has(presentation.id)) return
        presentationSeen.current.add(presentation.id)
        const fresh = Date.now() - Number(presentation.createdAt || 0) < 120000
        if (!fresh && conversation?.annaPresentationStatus?.id === presentation.id) return
        if (!active || controlRef.current || browserControl) {
            setPending(presentation)
            acknowledge(presentation, 'deferred')
        } else present(presentation)
    }, [conversation?.annaPresentation?.id, active, browserControl, present, acknowledge])

    useEffect(() => {
        if (!conversation) return
        let stopped = false,
            publishing = false,
            previous = ''
        const tick = async () => {
            if (stopped || publishing || document.hidden) return
            const context =
                !active || (surface === 'alldone' && visibleWorkspace)
                    ? sanitizeCallPageContext({ path: window.location.pathname, title: document.title })
                    : { path: '/', title: active && surface === 'browser' ? 'Browser' : 'Anna' }
            setAnnaWorkspaceContext(context)
            setPageTitle(context.title?.replace(/\s*[|–-]\s*Alldone.*$/i, '') || translate('Workspace'))
            const key = JSON.stringify(context)
            if (key === previous) return
            publishing = true
            try {
                await getDb()
                    .doc(`chatObjects/${conversation.projectId}/chats/${conversation.id}`)
                    .update({ annaPageContext: context })
                if (controlRef.current)
                    await getDb()
                        .doc(`users/${user.uid}/private/annaWorkspace`)
                        .set(
                            {
                                page: sanitizeCallPageContext({
                                    path: window.location.pathname,
                                    title: document.title,
                                }),
                            },
                            { merge: true }
                        )
                if (!stopped) previous = key
            } catch (_) {
                /* Retry fresh context only. */
            } finally {
                publishing = false
            }
        }
        tick()
        const timer = setInterval(tick, 1000)
        return () => {
            stopped = true
            clearInterval(timer)
            setAnnaWorkspaceContext(null)
        }
    }, [active, visibleWorkspace, surface, conversation?.projectId, conversation?.id])

    const interceptLink = event => {
        if (
            !active ||
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
        present({ path, id: `link-${Date.now()}`, view: 'link', manual: true })
    }
    const takeControl = () => {
        if (visited) setWorkspaceControl(true)
    }
    const showList = view =>
        present({
            id: `manual-${Date.now()}`,
            view,
            manual: true,
            path: `/projects/${view}/${view === 'notes' ? 'all' : 'open'}`,
        })
    const photo = assistant.photoURL || assistant.photoURL300 || assistant.photoURL50
    const seconds = Math.floor(call.voiceSeconds || 0)

    return (
        <div
            className={`anna-shell anna-zoom-shell ${active ? 'anna-zoom-active' : 'anna-fullscreen'} anna-mobile-${mobilePane}`}
            style={{ '--anna-chat-width': `${chatWidth}%` }}
            onClickCapture={interceptLink}
        >
            <header className="anna-header" hidden={!active}>
                <span className="anna-brand">{assistant.displayName || 'Anna Alldone'}</span>
                <button className="anna-zoom-back" onClick={() => setAnnaMode(false)}>
                    {translate('Alldone fullscreen')}
                </button>
            </header>
            <nav className="anna-mobile-tabs" hidden={!active} aria-label={translate('Anna views')}>
                <button aria-pressed={mobilePane === 'chat'} onClick={() => setMobilePane('chat')}>
                    {translate('Chat')}
                    {textBusy ? ' ···' : ''}
                </button>
                <button aria-pressed={mobilePane === 'workspace'} onClick={() => setMobilePane('workspace')}>
                    {translate('Workspace')}
                    {pending ? ' •' : ''}
                </button>
            </nav>
            <main className="anna-layout" ref={layout}>
                <section
                    className="anna-conversation"
                    aria-label={translate('Conversation with Anna')}
                    aria-hidden={!active || (mobile && mobilePane !== 'chat')}
                    inert={!active || (mobile && mobilePane !== 'chat') ? '' : undefined}
                >
                    {visited && (
                        <>
                            <div className="anna-conversation-heading">
                                <div className="anna-small-avatar">{photo ? <img src={photo} alt="" /> : 'A'}</div>
                                <div>
                                    <strong>{assistant.displayName || 'Anna Alldone'}</strong>
                                    <span>{translate('Your personal assistant')}</span>
                                </div>
                            </div>
                            <div className="anna-context">
                                <span>
                                    {translate('Looking at:')}{' '}
                                    {surface === 'browser' ? browser?.title || translate('Browser') : pageTitle}
                                </span>
                            </div>
                            {loading && (
                                <div className="anna-empty" role="status">
                                    {translate('Connecting with Anna…')}
                                </div>
                            )}
                            {error && (
                                <div className="anna-error" role="alert">
                                    {error}
                                    <button onClick={retry}>{translate('Try again')}</button>
                                </div>
                            )}
                            {conversation && (
                                <AnnaConversation
                                    conversation={conversation}
                                    assistant={assistant}
                                    user={user}
                                    call={call}
                                    threads={threads}
                                    resolveConversation={resolveConversation}
                                    loadEarlier={loadEarlier}
                                    hasEarlier={nextBefore != null}
                                    resumeRequest={control || browserControl ? null : resumeRequest}
                                    onResumeHandled={id =>
                                        setResumeRequest(current => (current?.id === id ? null : current))
                                    }
                                    visible={active && (!mobile || mobilePane === 'chat')}
                                    onExpand={() => setMobilePane('chat')}
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
                                        <span>
                                            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                                        </span>
                                        <button disabled={call.status === 'ending'} onClick={call.endCall}>
                                            {translate(call.status === 'connecting' ? 'Cancel call' : 'End call')}
                                        </button>
                                    </>
                                )}
                                {call.needsAudioPlayback && (
                                    <button onClick={call.playCallAudio}>{translate('Enable call audio')}</button>
                                )}
                                {call.error && (
                                    <p className="anna-error" role="alert">
                                        {call.error}
                                    </p>
                                )}
                            </div>
                        </>
                    )}
                </section>
                <div
                    className="anna-divider"
                    role="separator"
                    aria-label={translate('Conversation width')}
                    aria-orientation="vertical"
                    aria-valuemin={30}
                    aria-valuemax={55}
                    aria-valuenow={chatWidth}
                    tabIndex={active ? 0 : -1}
                    onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
                    onPointerMove={event => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            const bounds = layout.current.getBoundingClientRect()
                            setChatWidth(
                                Math.max(30, Math.min(55, ((event.clientX - bounds.left) / bounds.width) * 100))
                            )
                        }
                    }}
                    onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}
                    onKeyDown={event => {
                        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                            event.preventDefault()
                            setChatWidth(value =>
                                Math.max(30, Math.min(55, value + (event.key === 'ArrowLeft' ? -2 : 2)))
                            )
                        }
                    }}
                />
                <section
                    className="anna-stage"
                    aria-label={translate('Alldone workspace')}
                    aria-hidden={active && mobile && mobilePane !== 'workspace'}
                    inert={active && mobile && mobilePane !== 'workspace' ? '' : undefined}
                >
                    <div className="anna-workspace-toolbar" hidden={!active}>
                        <button aria-pressed={surface === 'alldone'} onClick={() => setSurface('alldone')}>
                            Alldone
                        </button>
                        <button aria-pressed={surface === 'browser'} onClick={() => setSurface('browser')}>
                            {translate('Browser')}
                        </button>
                        {surface === 'alldone' && (
                            <button
                                className="anna-control"
                                disabled={controlBusy}
                                aria-pressed={control}
                                onClick={() => setWorkspaceControl(!control)}
                            >
                                {translate(control ? 'Let Anna continue' : 'Take control')}
                            </button>
                        )}
                    </div>
                    {active && pending && (
                        <div className="anna-pending" role="status">
                            <span>
                                {translate('Anna would like to show you:')} {pending.title}
                            </span>
                            <button onClick={() => present({ ...pending, manual: true })}>{translate('Open')}</button>
                            <button
                                aria-label={translate('Dismiss')}
                                onClick={() => {
                                    acknowledge(pending, 'dismissed')
                                    setPending(null)
                                }}
                            >
                                ×
                            </button>
                        </div>
                    )}
                    {active && navigationError && (
                        <div className="anna-error" role="alert">
                            {navigationError}
                        </div>
                    )}
                    <div
                        className={`anna-workspace ${active && surface === 'browser' ? 'anna-surface-hidden' : ''}`}
                        aria-hidden={active && surface === 'browser'}
                        inert={active && surface === 'browser' ? '' : undefined}
                    >
                        <div className="anna-workspace-toolbar anna-object-views" hidden={!active}>
                            <span className="anna-muted">
                                {translate(control ? 'You are in control' : 'Following Anna')}
                            </span>
                            <nav aria-label={translate('Workspace views')}>
                                {conversation && (
                                    <button
                                        onClick={() =>
                                            present({
                                                id: `manual-${Date.now()}`,
                                                manual: true,
                                                view: 'tasks',
                                                path: `/projects/${conversation.projectId}/user/${conversation.assistantId}/tasks/open`,
                                            })
                                        }
                                    >
                                        {translate('Assistant tasks')}
                                    </button>
                                )}
                                {['tasks', 'notes', 'goals'].map(view => (
                                    <button key={view} onClick={() => showList(view)}>
                                        {translate(view[0].toUpperCase() + view.slice(1))}
                                    </button>
                                ))}
                            </nav>
                        </div>
                        <div
                            className="anna-workspace-content"
                            ref={workspaceContent}
                            onPointerDownCapture={takeControl}
                            onKeyDownCapture={takeControl}
                        >
                            {children}
                            {visited && (
                                <AnnaWorkspaceHighlight
                                    rootRef={workspaceContent}
                                    active={visibleWorkspace && surface === 'alldone'}
                                    conversation={conversation}
                                    routeId={routeId}
                                />
                            )}
                        </div>
                    </div>
                    {visited && (
                        <div
                            className={`anna-browser-surface ${!active || surface !== 'browser' ? 'anna-surface-hidden' : ''}`}
                            aria-hidden={!active || surface !== 'browser'}
                            inert={!active || surface !== 'browser' ? '' : undefined}
                        >
                            <AnnaBrowserWorkspace
                                browser={browser}
                                active={visibleWorkspace && surface === 'browser'}
                                onControlChange={held => {
                                    heldBrowser.current = held
                                    setBrowserControl(held)
                                    if (!held && nextBrowserRef.current?.runId !== browserRef.current?.runId) {
                                        browserRef.current = nextBrowserRef.current
                                        setBrowser(nextBrowserRef.current)
                                    }
                                }}
                                onResume={resumeWork}
                            />
                        </div>
                    )}
                </section>
            </main>
        </div>
    )
}
