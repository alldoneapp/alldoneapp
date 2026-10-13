import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import Icon from '../Icon'
import AssistantChatToggleIcon from '../UIComponents/AssistantChatToggleIcon'
import { colors } from '../styles/global'
import useAnnaConversation from './useAnnaConversation'
import AnnaConversation from './AnnaConversation'
import AnnaWorkspaceHighlight from './AnnaWorkspaceHighlight'
import AnnaWorkspaceReveal from './AnnaWorkspaceReveal'
import { findWorkspaceObject } from './annaWorkspaceRevealTargets'
import AnnaBrowserWorkspace from './AnnaBrowserWorkspace'
import useAnnaBrowserCompletion, { browserActivityKey } from './useAnnaBrowserCompletion'
import AnnaVmWorkspace from './AnnaVmWorkspace'
import useAnnaVmJobs, { vmJobPath } from './useAnnaVmJobs'
import AnnaBrowserTakeoverContext from './AnnaBrowserTakeoverContext'
import AnnaChatNavigationContext from './AnnaChatNavigationContext'
import AnnaWorkspaceNavigationContext from './AnnaWorkspaceNavigationContext'
import BrowserTakeoverPanel from '../ChatsView/ChatDV/EditorView/BrowserTakeoverPanel'
import { isAnnaNavigationPath, resolveAnnaLink } from './annaNavigation'
import AmountTag from '../Feeds/FollowSwitchableTag/AmountTag'
import getAllProjectsOpenTasksAmount from '../../utils/Tasks/getAllProjectsOpenTasksAmount'
import { isAnnaWorkspacePath } from '../../functions/Assistant/annaWorkspaceContract'
import { getAssistantFromState } from '../AdminPanel/Assistants/assistantStateLookup'
import { useVoiceCall } from '../UIComponents/AssistantVoiceCallProvider'
import { getDb } from '../../utils/backends/firestore'
import { setAnnaWorkspaceContext } from '../../utils/annaWorkspaceContext'
import { setAnnaMode, setAnnaLayout, useAnnaLayout } from '../../utils/annaMode'
import useAnnaChatWidth, { MIN_CHAT_WIDTH } from './useAnnaChatWidth'
import NavigationService from '../../utils/NavigationService'
import URLTrigger from '../../URLSystem/URLTrigger'
import { translate, useTranslator } from '../../i18n/TranslationService'
import { sanitizeCallPageContext } from '../../functions/WhatsApp/assistantCallPageContext'
import { useWorkspaceViewportOwner } from '../../hooks/useWorkspaceViewport'
import { subscribePageVisible } from '../../utils/appResume'
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
    const layoutMode = useAnnaLayout()
    const active = layoutMode !== 'alldone'
    const chatOnly = layoutMode === 'chat'
    const autoFollow = useRef(false)
    autoFollow.current = active && !chatOnly
    const user = useSelector(state => state.loggedUser)
    const openTasksAmount = useSelector(state =>
        getAllProjectsOpenTasksAmount(
            state.sidebarNumbers,
            state.loggedUser.uid,
            state.loggedUser.archivedProjectIds,
            state.loggedUser.templateProjectIds
        )
    )
    const call = useVoiceCall()
    const [visited, setVisited] = useState(active)
    const [textBusy, setTextBusy] = useState(false)
    const [workState, setWorkState] = useState(null)
    const { conversation, loading, error, retry, threads, resolveConversation, loadEarlier, nextBefore, offline } =
        useAnnaConversation(user.uid, { enabled: active, user, hold: textBusy || call.status !== 'idle' })
    const resolvedAssistant = useSelector(state =>
        conversation?.assistantId
            ? getAssistantFromState(state, conversation.assistantId) ||
              (state.defaultAssistant?.uid === conversation.assistantId ? state.defaultAssistant : null)
            : state.defaultAssistant
    )
    const assistant = resolvedAssistant || {}
    const assistantName = assistant.displayName?.trim() || translate('Assistant')
    const [mobilePane, setMobilePane] = useState('chat')
    const [surface, setSurface] = useState('alldone')
    const surfaceRef = useRef(surface)
    surfaceRef.current = surface
    const selectedVmId = surface.startsWith('vm:') ? surface.slice(3) : null
    const vmSurface = surface === 'vms' || !!selectedVmId
    const lastVmId = useRef(null)
    if (selectedVmId) lastVmId.current = selectedVmId
    const {
        jobs: vmJobs,
        error: vmError,
        retry: retryVms,
    } = useAnnaVmJobs(user.uid, {
        enabled: active,
        selectedRunId: selectedVmId,
    })
    const selectedVm = vmJobs.find(job => job.id === selectedVmId)
    const vmPointerDown = useRef(false)
    const [browserControl, setBrowserControl] = useState(false)
    const [browser, setBrowser] = useState(null)
    const browserCompleted = useAnnaBrowserCompletion(browser)
    const followedBrowser = useRef(null)
    const [browserTakeover, setBrowserTakeover] = useState(null)
    const takeoverRef = useRef(null)
    const [resumeRequest, setResumeRequest] = useState(null)
    const browserWorkspace = useRef(null)
    const [pending, setPending] = useState(null)
    const [workspacePage, setWorkspacePage] = useState(null)
    const [browserPage, setBrowserPage] = useState(null)
    const [navigationError, setNavigationError] = useState('')
    const workspaceContent = useRef(null)
    const layout = useRef(null)
    const chatPane = useRef(null)
    const workspaceStage = useRef(null)
    const focusAfterSwitch = useRef(null)
    const previousMode = useRef(layoutMode)
    const { width: chatWidth, maximum: maxChatWidth, resize: setChatWidth } = useAnnaChatWidth(user.uid, layout)
    const presentationSeen = useRef(new Set())
    const browserSeen = useRef(null)
    const heldBrowser = useRef(false)
    const browserRef = useRef(null)
    const nextBrowserRef = useRef(null)
    const requestGeneration = useRef(0)
    const revealGeneration = useRef(0)
    const mobile = useMobilePane()
    const visibleWorkspace = active && !chatOnly && (mobilePane === 'workspace' || !mobile)
    useWorkspaceViewportOwner(workspaceContent, active, visibleWorkspace && surface === 'alldone')
    const selectSurface = nextSurface => {
        if (mobile && nextSurface === 'alldone') {
            closeChat()
            return
        }
        requestGeneration.current++
        if (mobile) focusAfterSwitch.current = 'workspace'
        const vm = vmJobs.find(job => job.id === lastVmId.current) || vmJobs[0]
        setSurface(nextSurface === 'vms' && vm ? `vm:${vm.id}` : nextSurface)
        setAnnaLayout('split')
        setMobilePane('workspace')
    }
    const selectVm = runId => {
        if (runId === selectedVmId) return
        requestGeneration.current++
        setSurface(`vm:${runId}`)
    }
    const closeChat = () => {
        focusAfterSwitch.current = 'workspace'
        requestGeneration.current++
        followedBrowser.current = null
        setSurface('alldone')
        setMobilePane('chat')
        setAnnaMode(false)
    }
    const toggleWorkspace = () => {
        requestGeneration.current++
        followedBrowser.current = null
        setAnnaLayout(chatOnly ? 'split' : 'chat')
        setMobilePane(chatOnly ? 'workspace' : 'chat')
    }
    const backToChat = () => {
        focusAfterSwitch.current = 'chat'
        setMobilePane('chat')
    }
    const openChat = useCallback(() => {
        requestGeneration.current++
        // Focus immediately if already visible; otherwise wait for the pane switch.
        if (layoutMode === 'split' && mobilePane === 'chat') chatPane.current?.focus({ preventScroll: true })
        else focusAfterSwitch.current = 'chat'
        setMobilePane('chat')
        setAnnaMode(true)
    }, [layoutMode, mobilePane])
    const showAlldoneNavigation = useCallback(() => {
        if (!active) return
        requestGeneration.current++
        followedBrowser.current = null
        if (visibleWorkspace && surface === 'alldone') workspaceStage.current?.focus({ preventScroll: true })
        else focusAfterSwitch.current = 'workspace'
        setSurface('alldone')
        setMobilePane('workspace')
        setAnnaLayout('split')
    }, [active, visibleWorkspace, surface])
    useEffect(() => {
        const target = focusAfterSwitch.current || (previousMode.current === 'alldone' && active ? 'chat' : null)
        previousMode.current = layoutMode
        focusAfterSwitch.current = null
        if (target) (target === 'chat' ? chatPane : workspaceStage).current?.focus({ preventScroll: true })
    }, [layoutMode, mobilePane, surface])
    useEffect(() => {
        if (!active) {
            requestGeneration.current++
            followedBrowser.current = null
            setSurface('alldone')
            setMobilePane('chat')
        }
    }, [active])
    useEffect(() => {
        if (surface === 'vms' && vmJobs.length) setSurface(`vm:${vmJobs[0].id}`)
    }, [surface, vmJobs])
    const surfaceLabel = selectedVmId
        ? selectedVm
            ? `VM · ${selectedVm.title}`
            : 'VM'
        : surface === 'vms'
          ? translate('VMs')
          : surface === 'browser'
            ? translate('Browser')
            : 'Alldone'
    const returnFromBrowser = useCallback(runId => {
        const followed = followedBrowser.current
        if (
            !followed ||
            !autoFollow.current ||
            runId !== browserRef.current?.runId ||
            followed.key !== browserActivityKey(browserRef.current) ||
            followed.generation !== requestGeneration.current ||
            surfaceRef.current !== 'browser' ||
            heldBrowser.current ||
            takeoverRef.current ||
            document.hidden
        )
            return
        followedBrowser.current = null
        setSurface('alldone')
    }, [])
    useEffect(() => {
        if (!active || !browserCompleted) return
        const finish = () => returnFromBrowser(browser?.runId)
        finish()
        return subscribePageVisible(finish)
    }, [active, browserCompleted, browser?.runId, browserControl, browserTakeover, returnFromBrowser])

    const openBrowserTakeover = useCallback((approval, callbacks) => {
        if (takeoverRef.current && takeoverRef.current.approval.approvalId !== approval.approvalId) return
        requestGeneration.current++
        setAnnaMode(true)
        setSurface('browser')
        setMobilePane('workspace')
        if (!takeoverRef.current) {
            takeoverRef.current = { approval, ...callbacks }
            setBrowserTakeover(takeoverRef.current)
        }
    }, [])
    const closeBrowserTakeover = cancelled => {
        const current = takeoverRef.current
        takeoverRef.current = null
        setBrowserTakeover(null)
        if (cancelled) current?.onCancelled?.()
        else current?.onFinished?.()
    }

    useEffect(() => {
        if (active) setVisited(true)
    }, [active])
    useEffect(() => {
        if (!visited || !user.uid) return
        const stopBrowser = getDb()
            .doc(`users/${user.uid}/private/annaBrowser`)
            .onSnapshot(
                snapshot => {
                    const next = snapshot.exists ? snapshot.data() : null
                    nextBrowserRef.current = next
                    if (heldBrowser.current && browserRef.current?.runId !== next?.runId) return
                    browserRef.current = next
                    setBrowser(next)
                    const key = browserActivityKey(next)
                    if (key && browserSeen.current !== key) {
                        browserSeen.current = key
                        if (
                            autoFollow.current &&
                            surfaceRef.current !== 'vms' &&
                            !surfaceRef.current.startsWith('vm:') &&
                            Date.now() - Number(next.updatedAt || 0) < 120000
                        ) {
                            followedBrowser.current = { key, generation: requestGeneration.current }
                            setSurface('browser')
                        }
                    }
                },
                () => {}
            )
        return () => {
            stopBrowser()
        }
    }, [visited, user.uid])

    const resumeWork = useCallback(
        (context, surfaceName = 'browser') => {
            if (!context) return
            // The ongoing voice conversation can continue using the released surface. Do not
            // enqueue a second text execution after that call has already handled the hand-back.
            if (call.status !== 'idle') return
            const daily =
                ['topics', 'chats'].includes(context.objectType) &&
                (context.objectId === `anna_${user.uid}` || context.objectId?.startsWith('AnnaChat'))
            const text = translate('I have returned browser control to you. Please continue my current request.')
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
    const resumeForMessage = useCallback(async () => {
        setNavigationError('')
        // A new message or voice call returns the shared browser automatically.
        // That request is the continuation; do not post another chat message.
        setResumeRequest(null)
        // Chat remains usable, but only the login controller may hand back its session.
        if (takeoverRef.current) return
        if (heldBrowser.current && !browserWorkspace.current) throw new Error(translate('The browser is unavailable.'))
        await browserWorkspace.current?.releaseControl()
    }, [])
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
            if (
                !(presentation.manual
                    ? isAnnaNavigationPath(presentation.path)
                    : isAnnaWorkspacePath(presentation.path))
            ) {
                setNavigationError(translate('This workspace link is not supported.'))
                acknowledge(presentation, 'failed')
                return
            }
            try {
                await URLTrigger.processUrl(NavigationService.createNavigationProp(), presentation.path)
                if (generation !== requestGeneration.current) return
                setSurface('alldone')
                if (presentation.manual) {
                    setAnnaLayout('split')
                    setMobilePane('workspace')
                }
                setPending(null)
                acknowledge(presentation, !presentation.manual && !visibleWorkspace ? 'opened_hidden' : 'opened')
            } catch (_) {
                if (generation !== requestGeneration.current) return
                setNavigationError(translate('This item could not be opened. Please try again.'))
                acknowledge(presentation, 'failed')
            }
        },
        [acknowledge, visibleWorkspace]
    )

    useEffect(() => {
        const presentation = conversation?.annaPresentation
        if (!presentation?.id || presentationSeen.current.has(presentation.id)) return
        presentationSeen.current.add(presentation.id)
        const fresh = Date.now() - Number(presentation.createdAt || 0) < 120000
        if (!fresh && conversation?.annaPresentationStatus?.id === presentation.id) return
        if (!active || chatOnly || browserControl || browserTakeover || vmSurface) {
            setPending(presentation)
            acknowledge(presentation, 'deferred')
        } else present(presentation)
    }, [
        conversation?.annaPresentation?.id,
        active,
        chatOnly,
        browserControl,
        browserTakeover,
        vmSurface,
        present,
        acknowledge,
    ])

    useEffect(() => {
        if (!conversation) return
        let stopped = false,
            publishing = false,
            previous = ''
        const tick = async () => {
            if (stopped || publishing || document.hidden) return
            const page = sanitizeCallPageContext({ path: window.location.pathname, title: document.title })
            setWorkspacePage(previous =>
                previous?.path === page?.path && previous?.title === page?.title ? previous : page
            )
            const context =
                !active || (surface === 'alldone' && visibleWorkspace)
                    ? page
                    : selectedVm && visibleWorkspace
                      ? sanitizeCallPageContext({ path: vmJobPath(selectedVm), title: selectedVm.title })
                      : { path: '/', title: visibleWorkspace && surface === 'browser' ? 'Browser' : 'Anna' }
            setAnnaWorkspaceContext(context)
            const key = JSON.stringify(context)
            if (key === previous) return
            publishing = true
            try {
                await getDb()
                    .doc(`chatObjects/${conversation.projectId}/chats/${conversation.id}`)
                    .update({ annaPageContext: context })
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
    }, [
        active,
        visibleWorkspace,
        surface,
        selectedVm?.id,
        selectedVm?.title,
        conversation?.projectId,
        conversation?.id,
    ])

    const openWorkspaceChange = useCallback(async (change, isCancelled) => {
        const generation = requestGeneration.current
        const assertAvailable = () => {
            if (
                !isAnnaWorkspacePath(change.path) ||
                heldBrowser.current ||
                takeoverRef.current ||
                surfaceRef.current.startsWith('vm:') ||
                generation !== requestGeneration.current ||
                isCancelled()
            )
                throw new Error('Workspace is unavailable')
        }
        const waitForTarget = async ms => {
            const deadline = Date.now() + ms
            while (true) {
                assertAvailable()
                if (findWorkspaceObject(workspaceContent.current, change)) return true
                if (Date.now() >= deadline) return false
                await new Promise(resolve => setTimeout(resolve, 75))
            }
        }
        assertAvailable()
        revealGeneration.current = generation
        setSurface('alldone')
        // Keep the current view when its live listener can reveal the saved row.
        if (await waitForTarget(600)) return
        // Otherwise try its actual project/assignee list before opening details.
        // The list may need a fresh Firestore subscription before its row mounts.
        if (isAnnaWorkspacePath(change.listPath)) {
            try {
                await URLTrigger.processUrl(NavigationService.createNavigationProp(), change.listPath)
            } catch (_) {
                // A list navigation failure can still use the verified detail link.
            }
            if (await waitForTarget(2500)) return
        }
        assertAvailable()
        await URLTrigger.processUrl(NavigationService.createNavigationProp(), change.path)
    }, [])

    const returnWorkspaceHome = useCallback(async () => {
        if (
            heldBrowser.current ||
            takeoverRef.current ||
            document.hidden ||
            revealGeneration.current !== requestGeneration.current
        )
            return
        await URLTrigger.processUrl(NavigationService.createNavigationProp(), '/projects/tasks/open')
    }, [])
    const currentWorkState = {
        busy:
            textBusy ||
            call.status !== 'idle' ||
            workState?.projectId !== conversation?.projectId ||
            workState?.chatId !== conversation?.id ||
            workState?.busy !== false,
        completedRequests: workState?.completedRequests || [],
    }

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
    const photo = assistant.photoURL || assistant.photoURL300 || assistant.photoURL50
    const currentBrowserPage = browserPage?.runId === browser?.runId ? browserPage : browser
    const chatPageContext =
        !active || chatOnly
            ? null
            : surface === 'browser'
              ? {
                    surface,
                    path: currentBrowserPage?.url || '',
                    title: currentBrowserPage?.title || translate('Browser'),
                }
              : selectedVm
                ? { surface: 'vm', path: vmJobPath(selectedVm), title: selectedVm.title }
                : workspacePage && { ...workspacePage, surface }

    const pendingNotice = pending && (
        <div className="anna-pending" role="status">
            <span>
                {translate('%{assistantName} would like to show you:', { assistantName })} {pending.title}
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
    )

    const header = (
        <header className="anna-header">
            <button
                type="button"
                className="anna-pane-toggle"
                aria-label={translate('Close chat — Alldone only')}
                title={translate('Close chat — Alldone only')}
                onClick={closeChat}
            >
                <span aria-hidden="true" style={{ display: 'flex' }}>
                    <AssistantChatToggleIcon expanded color="currentColor" />
                </span>
            </button>
            <button
                type="button"
                className="anna-header-assistant"
                title={`${assistantName} – ${translate('Go to home')}`}
                aria-label={`${assistantName} – ${translate('Go to home')}`}
                onClick={() =>
                    present({
                        id: `home-${Date.now()}`,
                        view: 'link',
                        path: '/projects/tasks/open',
                        manual: true,
                    })
                }
            >
                <span className="anna-small-avatar">
                    {photo ? <img src={photo} alt="" /> : assistantName.charAt(0)}
                </span>
                <strong className="anna-brand">{assistantName}</strong>
                {openTasksAmount > 0 && (
                    <span
                        className="anna-open-tasks-badge"
                        aria-label={translate('%{count} open tasks today', { count: openTasksAmount })}
                        title={translate('%{count} open tasks today', { count: openTasksAmount })}
                    >
                        <AmountTag
                            feedAmount={openTasksAmount}
                            isFollowedButton={false}
                            showFullAmount={true}
                            style={{ backgroundColor: colors.Primary100 }}
                        />
                    </span>
                )}
            </button>
            <label className="anna-header-picker">
                <select
                    aria-label={translate('Workspace')}
                    value={mobile && !visibleWorkspace ? '' : vmSurface ? 'vms' : surface}
                    onChange={event => {
                        if (event.target.value === 'chat') backToChat()
                        else selectSurface(event.target.value)
                    }}
                >
                    {mobile && !visibleWorkspace && (
                        // A mobile selection opens that pane, including when reopening the same surface.
                        <option value="" disabled hidden>
                            {vmSurface ? translate('VMs') : surfaceLabel}
                        </option>
                    )}
                    {mobile && visibleWorkspace && <option value="chat">{translate('Back to chat')}</option>}
                    <option value="alldone">Alldone</option>
                    <option value="browser">{translate('Browser')}</option>
                    <option value="vms">
                        {translate('VMs')}
                        {vmJobs.length ? ` (${vmJobs.length})` : ''}
                    </option>
                </select>
                <span aria-hidden="true">
                    <Icon name="chevron-down" size={14} color="currentColor" />
                </span>
            </label>
            {!mobile && (
                <button
                    type="button"
                    className="anna-pane-toggle anna-pane-toggle-right"
                    aria-label={translate(chatOnly ? 'Show workspace' : 'Hide workspace — chat only')}
                    title={translate(chatOnly ? 'Show workspace' : 'Hide workspace — chat only')}
                    aria-expanded={visibleWorkspace}
                    onClick={toggleWorkspace}
                >
                    <Icon name="sidebar" size={18} color="currentColor" />
                </button>
            )}
        </header>
    )

    const content = (
        <div
            className={`anna-shell anna-zoom-shell ${active ? (chatOnly ? 'anna-zoom-active anna-chat-only' : 'anna-zoom-active') : 'anna-fullscreen'} anna-mobile-${chatOnly ? 'chat' : mobilePane}`}
            style={{
                '--anna-chat-width': `${chatWidth}px`,
                '--anna-ink': colors.Text01,
                '--anna-muted': colors.Text02,
                '--anna-placeholder': colors.Text03,
                '--anna-accent': colors.Primary200,
                '--anna-unread': colors.UtilityRed200,
                '--anna-neutral': colors.Grey200,
                '--anna-tint': colors.UtilityBlue100,
                '--anna-hover': colors.UtilityBlue112,
                '--anna-border': colors.Grey300,
                '--anna-focus': colors.UtilityBlue150,
                '--anna-surface': colors.Grey100,
            }}
            onClickCapture={interceptLink}
        >
            {mobile && active && header}
            <main className="anna-layout" ref={layout}>
                <section
                    className="anna-conversation"
                    ref={chatPane}
                    tabIndex={-1}
                    aria-label={translate('Conversation with %{assistantName}', { assistantName })}
                    aria-hidden={!active || (!chatOnly && mobile && mobilePane !== 'chat')}
                    inert={!active || (!chatOnly && mobile && mobilePane !== 'chat') ? '' : undefined}
                >
                    {!mobile && header}
                    {active && !visibleWorkspace && pendingNotice}
                    {active && !visibleWorkspace && navigationError && (
                        <div className="anna-error" role="alert">
                            {navigationError}
                        </div>
                    )}
                    {visited && (
                        <>
                            {loading && (
                                <div className="anna-empty" role="status">
                                    {translate('Loading conversation…')}
                                </div>
                            )}
                            {error && (
                                <div className="anna-error" role="alert">
                                    {error}
                                    <button onClick={retry}>{translate('Try again')}</button>
                                </div>
                            )}
                            {offline && !conversation && (
                                <div className="anna-empty" role="status">
                                    {translate('This conversation is not available offline yet.')}
                                </div>
                            )}
                            {conversation && (
                                <AnnaConversation
                                    key={`${user.uid}/${user.defaultProjectId}`}
                                    conversation={conversation}
                                    assistant={assistant}
                                    user={user}
                                    call={call}
                                    threads={threads}
                                    resolveConversation={resolveConversation}
                                    loadEarlier={loadEarlier}
                                    hasEarlier={nextBefore != null}
                                    offline={offline}
                                    resumeRequest={browserControl ? null : resumeRequest}
                                    onResumeHandled={id =>
                                        setResumeRequest(current => (current?.id === id ? null : current))
                                    }
                                    visible={active && (chatOnly || !mobile || mobilePane === 'chat')}
                                    active={active}
                                    onExpand={() => setMobilePane('chat')}
                                    onSendingChange={setTextBusy}
                                    onWorkStateChange={setWorkState}
                                    onBeforeSend={resumeForMessage}
                                    pageContext={chatPageContext}
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
                    aria-valuemin={MIN_CHAT_WIDTH}
                    aria-valuemax={maxChatWidth}
                    aria-valuenow={chatWidth}
                    aria-valuetext={`${Math.round(chatWidth)}px`}
                    tabIndex={active && !chatOnly && !mobile ? 0 : -1}
                    onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
                    onPointerMove={event => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            const bounds = layout.current.getBoundingClientRect()
                            setChatWidth(event.clientX - bounds.left)
                        }
                    }}
                    onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}
                    onKeyDown={event => {
                        if (['Home', 'End'].includes(event.key)) {
                            event.preventDefault()
                            setChatWidth(event.key === 'Home' ? MIN_CHAT_WIDTH : maxChatWidth)
                        }
                        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                            event.preventDefault()
                            setChatWidth(chatWidth + (event.key === 'ArrowLeft' ? -20 : 20))
                        }
                    }}
                />
                <section
                    className="anna-stage"
                    ref={workspaceStage}
                    tabIndex={-1}
                    aria-label={translate('Alldone workspace')}
                    aria-hidden={active && !visibleWorkspace}
                    inert={active && !visibleWorkspace ? '' : undefined}
                >
                    {visibleWorkspace && pendingNotice}
                    {visibleWorkspace && navigationError && (
                        <div className="anna-error" role="alert">
                            {navigationError}
                        </div>
                    )}
                    <div
                        className={`anna-workspace ${active && surface !== 'alldone' ? 'anna-surface-hidden' : ''}`}
                        aria-hidden={active && surface !== 'alldone'}
                        inert={active && surface !== 'alldone' ? '' : undefined}
                    >
                        <div className="anna-workspace-content" ref={workspaceContent}>
                            {children}
                            {visited && (
                                <AnnaWorkspaceReveal
                                    rootRef={workspaceContent}
                                    conversation={conversation}
                                    assistantName={assistantName}
                                    available={visibleWorkspace && !browserControl && !browserTakeover && !vmSurface}
                                    onOpen={openWorkspaceChange}
                                    onComplete={returnWorkspaceHome}
                                    workState={currentWorkState}
                                />
                            )}
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
                    <div
                        className={`anna-vms ${!active || !vmSurface ? 'anna-surface-hidden' : ''}`}
                        aria-hidden={!active || !vmSurface}
                        inert={!active || !vmSurface ? '' : undefined}
                        onPointerDownCapture={() => {
                            vmPointerDown.current = true
                        }}
                        onPointerUpCapture={() => {
                            vmPointerDown.current = false
                        }}
                        onPointerCancelCapture={() => {
                            vmPointerDown.current = false
                        }}
                        onPointerLeave={() => {
                            vmPointerDown.current = false
                        }}
                    >
                        {vmError && (
                            <div className="anna-error" role="alert">
                                {translate('vm_workspace_unavailable')}
                                <button onClick={retryVms}>{translate('vm_workspace_retry')}</button>
                            </div>
                        )}
                        {vmJobs.map(job => (
                            <section
                                key={job.id}
                                className={`anna-vm-surface ${selectedVmId === job.id ? 'anna-vm-selected' : ''}`}
                                aria-label={job.title}
                                aria-current={selectedVmId === job.id ? 'true' : undefined}
                                tabIndex={0}
                                onFocusCapture={() => {
                                    // Selecting another run may remove a completed panel above it.
                                    // Keep pointer targets in place until their click has finished.
                                    if (!vmPointerDown.current) selectVm(job.id)
                                }}
                                onClickCapture={() => selectVm(job.id)}
                            >
                                <AnnaVmWorkspace job={job} active={visibleWorkspace && vmSurface} />
                            </section>
                        ))}
                        {vmSurface && (!vmJobs.length || (selectedVmId && !selectedVm)) && (
                            <div className={vmJobs.length ? 'anna-error' : 'anna-empty'} role="status">
                                {translate(selectedVmId ? 'vm_workspace_unavailable' : 'No VM sessions yet')}
                            </div>
                        )}
                    </div>
                    {visited && (
                        <div
                            className={`anna-browser-surface ${!active || surface !== 'browser' ? 'anna-surface-hidden' : ''}`}
                            aria-hidden={!active || surface !== 'browser'}
                            inert={!active || surface !== 'browser' ? '' : undefined}
                            onPointerDownCapture={() => {
                                followedBrowser.current = null
                            }}
                            onKeyDownCapture={() => {
                                followedBrowser.current = null
                            }}
                        >
                            {browserTakeover && (
                                <div className="anna-browser-takeover">
                                    <BrowserTakeoverPanel
                                        key={browserTakeover.approval.approvalId}
                                        approval={browserTakeover.approval}
                                        workspace
                                        onFinished={() => closeBrowserTakeover(false)}
                                        onCancelled={() => closeBrowserTakeover(true)}
                                    />
                                </div>
                            )}
                            <div hidden={!!browserTakeover} inert={browserTakeover ? '' : undefined}>
                                <AnnaBrowserWorkspace
                                    ref={browserWorkspace}
                                    onPageChange={setBrowserPage}
                                    assistantName={assistantName}
                                    browser={browser}
                                    active={visibleWorkspace && surface === 'browser' && !browserTakeover}
                                    onControlChange={held => {
                                        heldBrowser.current = held
                                        if (held) followedBrowser.current = null
                                        setBrowserControl(held)
                                        if (!held && nextBrowserRef.current?.runId !== browserRef.current?.runId) {
                                            browserRef.current = nextBrowserRef.current
                                            setBrowser(nextBrowserRef.current)
                                        }
                                    }}
                                    onResume={resumeWork}
                                    onSessionEnded={returnFromBrowser}
                                />
                            </div>
                        </div>
                    )}
                </section>
            </main>
        </div>
    )
    return (
        <AnnaBrowserTakeoverContext.Provider
            value={{ open: openBrowserTakeover, approvalId: browserTakeover?.approval.approvalId }}
        >
            <AnnaChatNavigationContext.Provider value={openChat}>
                <AnnaWorkspaceNavigationContext.Provider value={showAlldoneNavigation}>
                    {content}
                </AnnaWorkspaceNavigationContext.Provider>
            </AnnaChatNavigationContext.Provider>
        </AnnaBrowserTakeoverContext.Provider>
    )
}
