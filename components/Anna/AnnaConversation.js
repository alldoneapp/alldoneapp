import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import { useSelector } from 'react-redux'
import useGetMessages from '../../hooks/Chats/useGetMessages'
import { getAssistantFromState } from '../AdminPanel/Assistants/assistantStateLookup'
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
import useAnnaProjectSwitchNotices from './useAnnaProjectSwitchNotices'
import useAnnaActivityNotices, { useAnnaUnreadActivityIds } from './useAnnaActivityNotices'
import useAnnaMessageSends from './useAnnaMessageSends'
import { getAssistantReplies, replyConfirmsProcessing } from './annaSubmissionReconciliation'
import { getAnnaWorkspaceWorkState } from './annaWorkspaceWorkState'
import { getUserPresentationData } from '../ContactsView/Utils/ContactsHelper'
import Icon from '../Icon'
import AnnaCallAudioControls, { AnnaCallActions } from './AnnaCallAudioControls'
import VoiceCallConnecting from '../UIComponents/VoiceCallConnecting'
import RambleButton, { RAMBLE_PHASE_IDLE } from '../UIControls/RambleButton'
import { resolveComposerMicSlot } from '../UIControls/composerMicSlot'
import { colors } from '../styles/global'
import AddFeedAttachButton from '../Feeds/AddFeed/AddFeedAttachButton'
import AssistantTaskSearchButtonWrapper from '../MyDayView/AssistantLine/AssistantOptions/Search/AssistantTaskSearchButtonWrapper'
import { isDictationSupported } from '../../hooks/useRambleRecorder'
import { LIVE_GOLD_PER_MINUTE, LIVE_INITIALIZATION_SECONDS } from '../../functions/WhatsApp/assistantLivePricing'
import { isBrowserOffline } from '../../utils/connectionState'
import AnnaChatComposer from './AnnaChatComposer'
import useAnnaDraft from './useAnnaDraft'
import AnnaMessageAuthor from './AnnaMessageAuthor'
import AnnaTimestamp from './AnnaTimestamp'
import { annaMessageCache } from './annaMessageCache'
import { AnnaActivityGroup } from './AnnaActivityNotice'
import { groupAnnaTimeline } from './annaActivityGroups'
import AssistantProgress from '../ChatsView/ChatDV/EditorView/AssistantProgress'
import useAnnaChatScroll from './useAnnaChatScroll'
import useAnnaFileDrop from './useAnnaFileDrop'
import { isAnnaProjectSelectable } from './annaProjectSelection'
import { scopeAnnaThreads } from './annaThreadScope'

const MESSAGES_PER_PAGE = 50
// AT-3032: below this composer width the Templates button drops its label (icon only, same
// accessible name), so +, Templates, mic, call and send stay on one row on the narrowest phones.
export const ANNA_TEMPLATES_COMPACT_WIDTH = 360
// The Templates list (up to 520px) is wider than the chat pane, so it opens upwards over the
// window rather than inside the pane; without a viewport it would be pushed into the workspace
// pane (window.__alldoneWorkspaceViewport). Phones get the usual bottom sheet.
const ANNA_TEMPLATES_POSITION = ['top', 'bottom', 'right', 'left']
const getTemplatesViewport = () => ({
    top: 0,
    left: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
    active: true,
})

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

// AT-3036: the chat shows one project's threads; the other projects' chats of the loaded days are
// one tap away. A jump selects that project like the project chip does, so the chat continues in
// its daily thread and the workspace on the right follows.
function AnnaProjectJumps({ projectIds, disabled, onOpenProject }) {
    const projects = useSelector(state => state.loggedUserProjectsMap)
    return (
        <nav className="anna-project-jumps" aria-label={translate('Chats in other projects')}>
            <span className="anna-project-jumps-label">{translate('Chats in other projects')}</span>
            {projectIds.map(projectId => {
                const project = projects?.[projectId]
                const name = project?.name || translate('Project')
                return (
                    <button
                        key={projectId}
                        type="button"
                        className="anna-project-jump"
                        data-anna-project-id={projectId}
                        disabled={disabled}
                        aria-label={translate('Open the chat in %{projectName}', { projectName: name })}
                        onClick={() => onOpenProject(projectId)}
                    >
                        <span
                            className="anna-project-jump-dot"
                            aria-hidden="true"
                            style={project?.color ? { background: project.color } : undefined}
                        />
                        <span className="anna-project-jump-name">{name}</span>
                    </button>
                )
            })}
        </nav>
    )
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
        // AT-2903: true while the selected project's chat is still being resolved.
        switching = false,
        // AT-3036: the project being opened, for the loading state shown meanwhile.
        switchingProjectName = '',
        renderProjectSwitcher,
        // AT-2914: the latest project chosen in the switcher ({ id, projectId, name, created }).
        projectSwitch = null,
        // AT-3036: other projects' threads, offered as jumps; `onOpenProject(projectId)` switches there.
        otherThreads = [],
        onOpenProject,
        // AT-3036: called with the project id once a project switch has ended and the new chat's
        // messages are on screen (right before the snap to the bottom).
        onSwitchSettled,
    },
    ref
) {
    // AT-2914: one indicator of the view open right now, always at the end of the chat.
    const viewNotice = useAnnaContextNotices(user.uid, conversation, pageContext)
    const projectNotices = useAnnaProjectSwitchNotices(user.uid, conversation, projectSwitch)
    const activityNotices = useAnnaActivityNotices(user.uid, conversation, active)
    const unreadActivityIds = useAnnaUnreadActivityIds()
    const contextNotices = [...projectNotices, ...activityNotices].sort((a, b) => a.created - b.created)
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
        sendNow,
        remove: removeQueued,
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
    const composerForm = useRef(null)
    const [compactTemplates, setCompactTemplates] = useState(false)
    useLayoutEffect(() => {
        const form = composerForm.current
        if (!form) return
        const measure = () => {
            const width = form.getBoundingClientRect().width
            if (width > 0) setCompactTemplates(width < ANNA_TEMPLATES_COMPACT_WIDTH)
        }
        measure()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(measure)
        observer.observe(form)
        return () => observer.disconnect()
    }, [])
    const [dictationPhase, setDictationPhase] = useState(RAMBLE_PHASE_IDLE)
    // AT-3025: the second mic, drawn in the send button's place while the draft is empty.
    const [sendSlotDictationPhase, setSendSlotDictationPhase] = useState(RAMBLE_PHASE_IDLE)
    const dictationBusy = dictationPhase !== RAMBLE_PHASE_IDLE || sendSlotDictationPhase !== RAMBLE_PHASE_IDLE
    const resumed = useRef(null)
    const mounted = useRef(true)
    // Set only when the latest transcript really reached the composer; consumed by the
    // hold-to-send below so a failed or empty take can never send the draft on its own.
    const dictationInserted = useRef(false)
    const insertDictatedText = text => {
        dictationInserted.current = false
        const input = composer.current
        const transcript = text?.replace(/\r\n?/g, '\n').trim()
        if (!mounted.current || !input || !transcript) return
        dictationInserted.current = input.insertDictation(transcript, visible) === true
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
                    const thread = resolveConversation
                        ? await resolveConversation(conversation.projectId)
                        : conversation
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

    const send = (event, continuation = null, { fromDictation = false } = {}) => {
        event?.preventDefault()
        const text = continuation?.text || draftRef.current.trim()
        // A hold-to-send arrives while the dictation phase is still 'processing' (the mic
        // finishes its own phase after handing over the transcript), so only it may pass.
        if (voiceActive || (dictationBusy && !fromDictation) || !text || offline || isBrowserOffline()) return
        // Wait for the selected project's chat, so a message never lands in the previous one.
        if (switching && !continuation) return
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
            // Hold-to-send must not pull focus into the field: on a phone that would open
            // the keyboard right after the user sent by voice (the AT-2422 lesson).
            if (!fromDictation) composer.current?.focus()
        }
    }
    // AT-2929: holding the microphone and releasing sends the take at once. The mic decides
    // what a release means (a tap keeps the toggle and leaves the text for review, sliding
    // away or a too-short take discards) and calls this once per held take, right after
    // `insertDictatedText`. The draft is read from its ref, so the transcript is already in
    // it; together with anything typed before, it goes out exactly like a manual send, with
    // every guard of `send` (offline, Gold, project switch, voice call) still applying. When
    // one of them refuses, the transcript simply stays in the composer.
    const sendDictation = () => {
        if (!dictationInserted.current) return
        dictationInserted.current = false
        send(null, null, { fromDictation: true })
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
            switching ||
            voiceActive ||
            dictationBusy ||
            offline ||
            isBrowserOffline()
        )
            return
        resumed.current = resumeRequest.id
        send(null, resumeRequest)
        onResumeHandled?.(resumeRequest.id)
    }, [resumeRequest, sending, switching, voiceActive, dictationBusy, offline])
    // Keep pending/failed submissions visible even when today's resolved thread
    // differs from the cached conversation or a rollover changes the history.
    // AT-3036: only those of the project on screen; another project's are reached by its jump.
    const { threads: displayedThreads, otherProjectIds } = scopeAnnaThreads({
        conversation,
        threads,
        otherThreads,
        localThreads: localMessages.map(message => message.thread),
        canOpen: projectId => !!onOpenProject && isAnnaProjectSelectable(user, projectId),
    })
    const isCurrentThread = thread =>
        thread.projectId === conversation.projectId && (thread.chatId || thread.id) === conversation.id
    // AT-2903: the composer writes into the current thread, so `scopeAnnaThreads` keeps it the
    // last section, also after switching back to a project whose chat started earlier today.
    const showProject =
        new Set(displayedThreads.map(thread => thread.projectId)).size > 1 ||
        conversation.projectId !== user.defaultProjectId
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
    // AT-3036: a project switch (from the chat's chip or picker, a jump, or the workspace) ends at
    // the very bottom of the new project's chat, once its messages are really on screen. The
    // current thread reports when its messages have loaded (`threadLoaded`); the switch is keyed
    // to the conversation it ends in, so a slower thread of an earlier, overtaken switch never
    // scrolls. It snaps once (`activate`) and then follows like any open chat: later images or
    // markdown keep it at the bottom until the reader scrolls up, and nothing else forces it down.
    const conversationKey = `${conversation.projectId}/${conversation.id}`
    const loadedThreads = useRef(new Set())
    const switchScroll = useRef(null)
    const switchingRef = useRef(switching)
    switchingRef.current = switching
    const shownProjectId = useRef(conversation.projectId)
    const onSwitchSettledRef = useRef(onSwitchSettled)
    onSwitchSettledRef.current = onSwitchSettled
    const snapAfterSwitch = useCallback(() => {
        const pending = switchScroll.current
        if (!pending?.key || switchingRef.current || !loadedThreads.current.has(pending.key)) return
        switchScroll.current = null
        // The shell may focus the composer (a switch picked in the chat); the snap comes after it,
        // so nothing the focus does moves the chat away from the bottom.
        onSwitchSettledRef.current?.(pending.projectId)
        activate()
    }, [activate])
    const threadLoaded = useCallback(
        (key, loaded) => {
            if (!loaded) {
                loadedThreads.current.delete(key)
                return
            }
            loadedThreads.current.add(key)
            snapAfterSwitch()
        },
        [snapAfterSwitch]
    )
    // Runs after the threads' own layout effects, so a thread that loaded in this very commit
    // (from the message cache) has already reported.
    useLayoutEffect(() => {
        if (switching) {
            switchScroll.current = { key: null }
            return
        }
        if (shownProjectId.current !== conversation.projectId) switchScroll.current = { key: null }
        shownProjectId.current = conversation.projectId
        if (!switchScroll.current) return
        switchScroll.current = { key: conversationKey, projectId: conversation.projectId }
        snapAfterSwitch()
    }, [switching, conversation.projectId, conversationKey, snapAfterSwitch])
    // AT-2928: a file dropped anywhere on the chat pane joins the draft, under the same
    // conditions as the attach button.
    const attachmentsBlocked = voiceActive || dictationBusy || offline || !conversation.projectId
    // Both mics (toolbar and send slot) share one wiring; only where they sit and when they show
    // differ (AT-3025, composerMicSlot.js).
    const dictationAvailable = !offline && !!conversation.projectId && isDictationSupported()
    const { micInSendSlot, inlineMicVisible } = resolveComposerMicSlot({
        enabled: dictationAvailable,
        isEmpty: !hasText,
        inlinePhase: dictationPhase,
        sendSlotPhase: sendSlotDictationPhase,
    })
    const dictationProps = {
        projectId: conversation.projectId,
        targetKind: 'generic',
        getCurrentText: () => draftRef.current,
        onTextReady: insertDictatedText,
        onSubmit: sendDictation,
        getOverlayViewport: () => {
            const pane = composer.current?.getPane()
            return pane && { ...pane.getBoundingClientRect().toJSON(), active: true }
        },
    }
    const draggingFiles = useAnnaFileDrop({
        getPane: () => scroll.current?.closest('.anna-conversation') || scroll.current?.parentElement,
        canAccept: () => !attachmentsBlocked && !isBrowserOffline(),
        onFiles: files => {
            if (composer.current?.addFiles(files)?.length) onExpand?.()
        },
    })
    useImperativeHandle(ref, () => ({ scrollToLatest: activate, focusInput: () => composer.current?.focus() }), [
        activate,
    ])
    return (
        <>
            {draggingFiles && (
                <div className="anna-drop-overlay" aria-hidden="true" data-testid="anna-drop-overlay">
                    <div className="anna-drop-overlay-card">
                        <Icon name="paperclip" size={24} color="currentColor" />
                        <span>{translate('Drop files to attach')}</span>
                    </div>
                </div>
            )}
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
                    {/* AT-3036: while another project's chat opens, the previous project's
                        messages are not shown as if they were the new chat's. */}
                    {switching && (
                        <div
                            className="anna-project-switch-loading"
                            role="status"
                            aria-live="polite"
                            data-testid="anna-project-switch-loading"
                        >
                            <span className="anna-project-switch-spinner" aria-hidden="true" />
                            <span>
                                {switchingProjectName
                                    ? translate('Opening the chat in %{projectName}…', {
                                          projectName: switchingProjectName,
                                      })
                                    : translate('Opening the chat…')}
                            </span>
                        </div>
                    )}
                    {!switching && hasEarlier && (
                        <button className="anna-text-button" disabled={loadingEarlier || offline} onClick={earlier}>
                            {translate(loadingEarlier ? 'Loading earlier days…' : 'Earlier days')}
                        </button>
                    )}
                    {!switching && otherProjectIds.length > 0 && (
                        <AnnaProjectJumps
                            projectIds={otherProjectIds}
                            disabled={voiceActive || offline}
                            onOpenProject={onOpenProject}
                        />
                    )}
                    {(switching ? [] : displayedThreads).map(thread => (
                        <AnnaThreadMessages
                            key={`${thread.projectId}/${thread.chatId || thread.id}`}
                            thread={thread}
                            conversation={conversation}
                            assistant={assistant}
                            user={user}
                            scroll={scroll}
                            current={isCurrentThread(thread)}
                            showProject={showProject}
                            localMessages={localMessages.filter(
                                message =>
                                    message.thread?.projectId === thread.projectId &&
                                    message.thread?.id === (thread.chatId || thread.id)
                            )}
                            onRetry={retryMessage}
                            onSendNow={sendNow}
                            onRemoveQueued={removeQueued}
                            onAcknowledge={acknowledge}
                            onWorkStateChange={onWorkStateChange}
                            onChange={messagesChanged}
                            onLoaded={threadLoaded}
                            onLoadEarlier={preservePosition}
                            visible={visible}
                            offline={offline}
                            reducedMotion={chatScroll.reducedMotion}
                            contextNotices={contextNotices.filter(
                                notice =>
                                    notice.projectId === thread.projectId &&
                                    notice.chatId === (thread.chatId || thread.id)
                            )}
                            unreadActivityIds={unreadActivityIds}
                            viewNotice={isCurrentThread(thread) ? viewNotice : null}
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
            <form className="anna-composer" ref={composerForm} onSubmit={send}>
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
                <div
                    className={`anna-composer-slot${voiceConnecting ? ' anna-composer-slot-connecting' : ''}${voiceActive ? ' anna-composer-slot-voice' : ''}`}
                >
                    {/* The invisible draft and toolbar retain the exact responsive call footprint. */}
                    <div className="anna-composer-field">
                        <div
                            className="anna-composer-draft"
                            aria-hidden={voiceActive || undefined}
                            inert={voiceActive ? '' : undefined}
                        >
                            {/* AT-3032: the project chip sits on the field's top edge, half over the
                                border (anna.css). First in the DOM, so it is also first in tab order. */}
                            <div className="anna-composer-project">
                                {renderProjectSwitcher?.({ disabled: voiceActive || dictationBusy || offline })}
                            </div>
                            <div>
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
                            <div className="anna-composer-toolbar">
                                {/* AT-3029/AT-3032: + and Templates on the left; mic, call and send on the right. */}
                                <div className="anna-composer-tools">
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
                                            isDisabled={attachmentsBlocked}
                                            addAttachmentTag={(text, uri) => {
                                                if (voiceActive || dictationBusy || offline || isBrowserOffline())
                                                    return
                                                composer.current?.addAttachment(text, uri)
                                            }}
                                        />
                                    </div>
                                    {/* The assistant line's own Templates button and modal, unchanged. */}
                                    <div className="anna-composer-templates">
                                        <AssistantTaskSearchButtonWrapper
                                            preferredAssistantId={conversation.assistantId || assistant?.uid}
                                            preferredProjectId={conversation.projectId}
                                            compact={compactTemplates}
                                            position={ANNA_TEMPLATES_POSITION}
                                            getPopoverViewport={getTemplatesViewport}
                                        />
                                    </div>
                                </div>
                                <div className="anna-composer-actions">
                                    {dictationAvailable && (
                                        <RambleButton
                                            {...dictationProps}
                                            visible={inlineMicVisible}
                                            onPhaseChange={setDictationPhase}
                                            style={{ minWidth: 40, height: 40, borderRadius: 20, flexShrink: 0 }}
                                        />
                                    )}
                                    <button
                                        type="button"
                                        className="anna-voice-button"
                                        aria-label={translate('Talk with %{assistantName}', { assistantName })}
                                        title={voiceHint}
                                        disabled={voiceActive || offline || sending || dictationBusy || switching}
                                        onClick={toggleVoiceCall}
                                    >
                                        <Icon name="phone-call" size={20} color="currentColor" />
                                    </button>
                                    {/* AT-3025: an empty draft offers the mic where Send sits. Both mics
                                        stay mounted so a take survives the draft filling up. */}
                                    {dictationAvailable && (
                                        <RambleButton
                                            {...dictationProps}
                                            visible={micInSendSlot}
                                            variant="send"
                                            testID="anna-send-slot-dictation"
                                            onPhaseChange={setSendSlotDictationPhase}
                                            style={{ minWidth: 40, height: 40, borderRadius: 20, flexShrink: 0 }}
                                            sendIdleStyle={{ backgroundColor: colors.Primary200 }}
                                        />
                                    )}
                                    {!micInSendSlot && (
                                        <button
                                            type="submit"
                                            className="anna-send"
                                            disabled={offline || voiceActive || dictationBusy || switching || !hasText}
                                            aria-label={translate('Send message')}
                                        >
                                            <Icon name="arrow-up" size={20} color="currentColor" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                        {voiceActive && !voiceConnecting && (
                            <AnnaCallAudioControls call={call} seconds={seconds}>
                                <AnnaCallActions call={call} endLabel={voiceLabel} onEnd={toggleVoiceCall} />
                            </AnnaCallAudioControls>
                        )}
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
                                aria-label={translate('Cancel call')}
                                onClick={toggleVoiceCall}
                            >
                                {translate('Cancel call')}
                            </button>
                        </div>
                    )}
                </div>
                <div
                    className="anna-composer-footer anna-composer-footer-idle"
                    style={voiceActive ? { visibility: 'hidden' } : undefined}
                    aria-hidden={voiceActive || undefined}
                >
                    <span className="anna-composer-shortcut">{translate('Shift + Enter for a new line')}</span>
                </div>
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
    unreadActivityIds,
    viewNotice = null,
    localMessages,
    onRetry,
    onSendNow,
    onRemoveQueued,
    onAcknowledge,
    onWorkStateChange,
    reducedMotion,
    showProject = false,
    onLoaded,
}) {
    // Earlier sections can belong to another project and its assistant (AT-2903).
    const threadAssistant = useSelector(state =>
        !current && thread.assistantId && thread.assistantId !== assistant?.uid
            ? getAssistantFromState(state, thread.assistantId)
            : null
    )
    assistant = threadAssistant || assistant
    const projectName = useSelector(state =>
        showProject ? state.loggedUserProjectsMap?.[thread.projectId]?.name || '' : ''
    )
    const assistantName = assistant?.displayName?.trim() || translate('Assistant')
    // AT-3046: an activity card names its project and actor only when they differ from this thread's.
    const activityContext = useMemo(
        () => ({ projectId: thread.projectId, assistantName: assistant?.displayName || '' }),
        [thread.projectId, assistant?.displayName]
    )
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
    // A request whose connection dropped (app backgrounded) is still awaited, not failed (AT-2921).
    const pendingMessage =
        !hasLegacyLiveActivity &&
        localMessages.findLast(
            message =>
                (message.running || message.status === 'confirming') &&
                message.status !== 'queued' &&
                !repliedMessageIds.has(message.id)
        )
    const workStateKey = JSON.stringify(getAnnaWorkspaceWorkState(messages))
    useEffect(() => {
        if (current) onWorkStateChange?.({ projectId: thread.projectId, chatId, ...JSON.parse(workStateKey) })
    }, [current, thread.projectId, chatId, workStateKey, onWorkStateChange])
    useAnnaMessageReadState(thread.projectId, chatId, scroll, messages, visible)
    const savedMessageIds = JSON.stringify(messages.map(message => message.id))
    const localMessageIds = JSON.stringify(localMessages.map(message => [message.id, message.status]))
    const replyStates = JSON.stringify(getAssistantReplies(messages))
    useEffect(() => {
        onAcknowledge(thread.projectId, chatId, JSON.parse(savedMessageIds), JSON.parse(replyStates))
    }, [thread.projectId, chatId, savedMessageIds, localMessageIds, replyStates, onAcknowledge])
    const replies = JSON.parse(replyStates)
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
        viewNotice?.id,
        pendingMessage?.key,
        pendingMessage?.status,
        onChange,
    ])
    // AT-3036: the conversation scrolls to the bottom after a project switch once this (current)
    // thread's messages are rendered, which is now: after this commit's layout.
    const loadedKey = `${thread.projectId}/${chatId}`
    useLayoutEffect(() => {
        if (!current || !onLoaded) return
        onLoaded(loadedKey, !!messages.loaded)
        return () => onLoaded(loadedKey, false)
    }, [current, loadedKey, messages.loaded, onLoaded])
    const timeline = groupAnnaTimeline(
        [
            ...displayedMessages.map(message => ({
                message,
                // AT-2922: a queued message is not part of the history yet; it stays at the end,
                // after the answer it is waiting for.
                created:
                    message.submission?.status === 'queued'
                        ? Number.MAX_SAFE_INTEGER // sort() is stable: queued messages keep their order
                        : getTimestampInMilliseconds(message.created || message.lastChangeDate),
            })),
            ...contextNotices.map(notice => ({ notice, created: notice.created })),
        ].sort((a, b) => a.created - b.created)
    )
    const expandEarlier = () => {
        onLoadEarlier()
        setLimit(value => value + MESSAGES_PER_PAGE)
    }
    return (
        <section aria-label={thread.dateKey || translate('Earlier conversation')}>
            {(thread.dateKey || projectName) && (
                <div className="anna-date-divider">
                    {[
                        thread.dateKey && thread.dateKey.replace(/^(....)(..)(..)$/, '$1-$2-$3'),
                        projectName,
                        projectName && assistantName,
                    ]
                        .filter(Boolean)
                        .join(' · ')}
                </div>
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
            {timeline.map(({ message, notice, notices }) => {
                if (notices)
                    return (
                        <AnnaActivityGroup
                            key={`context-${notices[0].id}`}
                            notices={notices}
                            onChange={onChange}
                            unread={!!unreadActivityIds && notices.some(item => unreadActivityIds.has(item.id))}
                            context={activityContext}
                        />
                    )
                if (notice)
                    return (
                        <p
                            className="anna-context-notice anna-project-switch-notice"
                            key={`context-${notice.id}`}
                            data-anna-project-switch={notice.projectId}
                        >
                            <span>
                                {translate('Switched to project:')} {notice.title}
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
                        className={`anna-message ${own ? 'anna-message-user' : ''}${
                            message.submission?.status === 'queued' ? ' anna-message-queued' : ''
                        }`}
                    >
                        <AnnaMessageAuthor
                            message={message}
                            creator={creator}
                            own={own}
                            onSendNow={() => onSendNow?.(message.submission?.key)}
                            onRemove={() => onRemoveQueued?.(message.submission?.key)}
                        />
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
                        {message.submission?.error && !replyConfirmsProcessing(replies[message.id]) && (
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
            {viewNotice && (
                <p className="anna-context-notice anna-view-notice" key="view-notice">
                    <span>
                        {translate('Looking at:')} {viewNotice.title}
                    </span>
                    <AnnaTimestamp timestamp={viewNotice.created} />
                </p>
            )}
        </section>
    )
}
