import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import Icon from '../Icon'
import { colors } from '../styles/global'
import useAnnaConversation from './useAnnaConversation'
import AnnaConversation from './AnnaConversation'
import AnnaWorkspaceHighlight from './AnnaWorkspaceHighlight'
import AnnaBrowserWorkspace from './AnnaBrowserWorkspace'
import { resolveAnnaLink } from './annaNavigation'
import { isAnnaWorkspacePath } from '../../functions/Assistant/annaWorkspaceContract'
import { getAssistantFromState } from '../AdminPanel/Assistants/assistantStateLookup'
import { useVoiceCall } from '../UIComponents/AssistantVoiceCallProvider'
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
    const call = useVoiceCall()
    const [visited, setVisited] = useState(active)
    const [textBusy, setTextBusy] = useState(false)
    const { conversation, loading, error, retry, threads, resolveConversation, loadEarlier, nextBefore } =
        useAnnaConversation(user.uid, { enabled: active, user, hold: textBusy || call.status !== 'idle' })
    const resolvedAssistant = useSelector(state =>
        conversation?.assistantId
            ? getAssistantFromState(state, conversation.assistantId) ||
              (state.defaultAssistant?.uid === conversation.assistantId ? state.defaultAssistant : null)
            : state.defaultAssistant
    )
    const assistant = resolvedAssistant || {}
    const assistantName = assistant.displayName?.trim() || translate('Assistant')
    const assistantDescription = typeof assistant.description === 'string' ? assistant.description.trim() : ''
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
                surface: surfaceName,
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
    const photo = assistant.photoURL || assistant.photoURL300 || assistant.photoURL50
    const contextLabel = `${translate('Looking at:')} ${
        surface === 'browser' ? browser?.title || translate('Browser') : pageTitle
    }`

    return (
        <div
            className={`anna-shell anna-zoom-shell ${active ? 'anna-zoom-active' : 'anna-fullscreen'} anna-mobile-${mobilePane}`}
            style={{
                '--anna-chat-width': `${chatWidth}%`,
                '--anna-ink': colors.Text01,
                '--anna-muted': colors.Text02,
                '--anna-placeholder': colors.Text03,
                '--anna-accent': colors.Primary200,
                '--anna-neutral': colors.Grey200,
                '--anna-tint': colors.UtilityBlue100,
                '--anna-hover': colors.UtilityBlue112,
                '--anna-border': colors.Grey300,
                '--anna-focus': colors.UtilityBlue150,
                '--anna-surface': colors.Grey100,
            }}
            onClickCapture={interceptLink}
        >
            <header className="anna-header" hidden={!active}>
                <div className="anna-header-assistant">
                    <div className="anna-small-avatar">
                        {photo ? <img src={photo} alt="" /> : assistantName.charAt(0)}
                    </div>
                    <div className="anna-header-details">
                        <div className="anna-header-identity">
                            <strong className="anna-brand" title={assistantName}>
                                {assistantName}
                            </strong>
                            {assistantDescription && <span title={assistantDescription}>{assistantDescription}</span>}
                        </div>
                        <div className="anna-context" title={contextLabel}>
                            <span>{contextLabel}</span>
                        </div>
                    </div>
                </div>
                <button
                    className="anna-zoom-back"
                    aria-label={translate('Zoom in Alldone')}
                    onClick={() => setAnnaMode(false)}
                >
                    <span aria-hidden="true">
                        <Icon name="minimize-2" size={16} color="currentColor" />
                    </span>
                    <span>{translate('Zoom in Alldone')}</span>
                </button>
            </header>
            <nav className="anna-mobile-tabs" hidden={!active} aria-label={translate('Assistant views')}>
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
                    aria-label={translate('Conversation with %{assistantName}', { assistantName })}
                    aria-hidden={!active || (mobile && mobilePane !== 'chat')}
                    inert={!active || (mobile && mobilePane !== 'chat') ? '' : undefined}
                >
                    {visited && (
                        <>
                            {loading && (
                                <div className="anna-empty" role="status">
                                    {translate('Connecting with %{assistantName}…', { assistantName })}
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
                                    resumeRequest={
                                        (resumeRequest?.surface === 'browser' ? browserControl : control)
                                            ? null
                                            : resumeRequest
                                    }
                                    onResumeHandled={id =>
                                        setResumeRequest(current => (current?.id === id ? null : current))
                                    }
                                    visible={active && (!mobile || mobilePane === 'chat')}
                                    onExpand={() => setMobilePane('chat')}
                                    onSendingChange={setTextBusy}
                                />
                            )}
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
                                {translate(control ? 'Let %{assistantName} continue' : 'Take control', {
                                    assistantName,
                                })}
                            </button>
                        )}
                    </div>
                    {active && pending && (
                        <div className="anna-pending" role="status">
                            <span>
                                {translate('%{assistantName} would like to show you:', { assistantName })}{' '}
                                {pending.title}
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
                        <div
                            className="anna-workspace-content"
                            ref={workspaceContent}
                            onPointerDownCapture={takeControl}
                            onKeyDownCapture={takeControl}
                        >
                            {children}
                            {visited && (
                                <AnnaWorkspaceHighlight
                                    assistantName={assistantName}
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
                                assistantName={assistantName}
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
