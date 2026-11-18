import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import Icon from '../Icon'
import { pickNewFocusTask } from '../../utils/backends/Tasks/tasksFirestore'
import { annaActivityPreview } from './annaActivityText'
import { rerollFocusTask } from './annaFocusReroll'
import { translate } from '../../i18n/TranslationService'
import { selectTodayInboxState, TODAY_INBOX_EMPTY } from '../../utils/Tasks/todayInboxState'

const NOTICE_MS = 4000

// AT-3067: the slot-machine roll while a focus task is being searched. It rolls fast for at least
// MIN_TICKS, keeps rolling until the pick has answered and (for a pick) the new task is shown, at
// most LAND_WAIT_TICKS after the answer, then slows down over SLOW_TICKS_MS and lands.
// AT-3085: the names flickered by every 70 ms, too fast to read; they now change every 130 ms with
// about the same overall length (MIN_TICKS ≈ 1 s, LAND_WAIT_TICKS ≈ 3.1 s). The reel item's CSS
// slide-in (anna-focus-reel-fast in anna.css) lasts one tick, so keep the two in step.
export const FAST_TICK_MS = 130
export const MIN_TICKS = 8
export const LAND_WAIT_TICKS = 24
export const SLOW_TICKS_MS = [170, 230, 300, 380]
export const LANDING_MS = 700
const MAX_REEL_NAMES = 30

const prefersReducedMotion = () => {
    try {
        return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    } catch (_) {
        return false
    }
}

const reelName = name => annaActivityPreview(name || '', 80)

/**
 * Assistant mode: the middle of the chat header's row. It shows the user's focus task
 * (`loggedUser.inFocusTaskId`, read through InFocusTaskWatcher's `taskInFocus`): the focus icon, a
 * tag of its project (color dot and name, cut off at a maximum width in anna.css), the task's name.
 * A click calls
 * `onOpen({ taskId, projectId })`: AnnaShell leaves the chat for the app's open task list and
 * scrolls it to the task.
 * The link's own target is the task, for a modified click (a new tab); AnnaShell's link
 * interception skips it (`data-anna-open-in-app`). With no focus task it offers to pick one, the
 * same pick as after completing the focus task.
 *
 * AT-3067: a round "Show a different focus task" button at the pill's right end swaps the focus
 * task for the next one the pick would choose, skipping every task already passed over in this
 * session and starting over once all of today's tasks have been shown (annaFocusReroll.js). While
 * a pick or a swap searches, the pill rolls through the candidates' names like a slot machine
 * (static text under reduced motion) and lands on the new task. One search at a time; with no
 * alternative, offline or on an error the current task stays and a short notice says why.
 *
 * AT-3057: when nothing is left for today across all projects (Empty Inbox), it celebrates that
 * instead of asking for more work. The decision comes from the authoritative today count
 * (`selectTodayInboxState`), never from the missing focus task: while that count is loading or
 * incomplete, or while a focus task id is set but its task is not loaded yet, the header keeps its
 * normal behaviour. As soon as a task is due today again the pick button is back.
 */
export default function AnnaFocusTask({ onOpen }) {
    const userId = useSelector(state => state.loggedUser.uid)
    const focusTaskId = useSelector(state => state.loggedUser.inFocusTaskId)
    const focusProjectId = useSelector(state => state.loggedUser.inFocusTaskProjectId)
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const firstProjectId = useSelector(state => state.loggedUserProjects?.[0]?.id)
    const task = useSelector(state => state.taskInFocus)
    const project = useSelector(state => (focusProjectId ? state.loggedUserProjectsMap?.[focusProjectId] : null))
    const todayInbox = useSelector(selectTodayInboxState)
    // 'idle' | 'rolling' (searching, the reel turns) | 'landing' (the new task drops in)
    const [phase, setPhase] = useState('idle')
    const [tick, setTick] = useState(0)
    const [notice, setNotice] = useState('')
    const runRef = useRef(null)
    const shownTaskIdRef = useRef(null)

    const focused = focusTaskId && focusProjectId && task?.id === focusTaskId && !task.done ? task : null
    shownTaskIdRef.current = focused?.id || null

    useEffect(() => {
        if (!notice) return
        const timer = setTimeout(() => setNotice(''), NOTICE_MS)
        return () => clearTimeout(timer)
    }, [notice])

    useEffect(() => {
        if (phase !== 'rolling') return
        const run = runRef.current
        if (!run) return
        if (run.slow > SLOW_TICKS_MS.length) {
            runRef.current = null
            setPhase(run.result?.status === 'picked' ? 'landing' : 'idle')
            if (run.result?.notice) setNotice(run.result.notice)
            return
        }
        const delay = run.slow > 0 ? SLOW_TICKS_MS[run.slow - 1] : FAST_TICK_MS
        const timer = setTimeout(() => {
            run.ticks += 1
            if (run.result) run.ticksSinceResult += 1
            if (run.slow > 0) run.slow += 1
            else if (readyToLand(run, shownTaskIdRef.current)) run.slow = 1
            setTick(value => value + 1)
        }, delay)
        return () => clearTimeout(timer)
    }, [phase, tick])

    useEffect(() => {
        if (phase !== 'landing') return
        const timer = setTimeout(() => setPhase('idle'), LANDING_MS)
        return () => clearTimeout(timer)
    }, [phase])

    const startRoll = (kind, seedNames, request) => {
        if (phase !== 'idle' || runRef.current) return
        const run = {
            kind,
            fromTaskId: focused?.id || null,
            names: seedNames.filter(Boolean),
            result: null,
            ticks: 0,
            ticksSinceResult: 0,
            slow: 0,
        }
        const addCandidates = candidates => {
            for (const candidate of candidates || []) {
                const name = reelName(candidate?.name)
                if (name && !run.names.includes(name) && run.names.length < MAX_REEL_NAMES) run.names.push(name)
            }
        }
        runRef.current = run
        setNotice('')
        setTick(0)
        setPhase('rolling')
        request(addCandidates).then(result => {
            run.result = result
        })
    }

    const reduced = prefersReducedMotion()
    const searching = translate('Finding a focus task…')
    const rerollLabel = translate('Show a different focus task')

    if (phase === 'rolling') {
        const run = runRef.current
        const names = run?.names || []
        const name = !reduced && names.length ? names[tick % names.length] : searching
        return (
            <div
                className={`anna-focus-pill anna-focus-rolling${run?.slow ? ' anna-focus-rolling-slow' : ''}`}
                aria-busy="true"
            >
                <span className="anna-focus-task anna-focus-task-rolling">
                    <span className="anna-focus-radar" aria-hidden="true">
                        <Icon name="crosshair" size={16} color="currentColor" />
                    </span>
                    <span className="anna-focus-reel" aria-hidden="true">
                        {/* AT-3085: keyed by the text, so the item only slides in when the text changes.
                            Keyed by the tick, the static "Finding a focus task…" restarted its slide-in
                            from above on every tick and so sat above the pill's middle most of the time. */}
                        <span key={name} className="anna-focus-reel-item">
                            {name}
                        </span>
                    </span>
                    <span className="anna-call-sr-only" role="status">
                        {searching}
                    </span>
                </span>
                {run?.kind === 'swap' && (
                    <button
                        type="button"
                        className="anna-focus-reroll"
                        disabled
                        aria-busy="true"
                        aria-label={rerollLabel}
                        title={rerollLabel}
                    >
                        <Icon name="refresh-cw" size={14} color="currentColor" />
                    </button>
                )}
            </div>
        )
    }

    if (focused) {
        const name = annaActivityPreview(focused.name || '', 160) || translate('Task')
        const projectName = project?.name?.trim() || ''
        const label = projectName
            ? translate('Open focus task in %{projectName}: %{taskName}', { projectName, taskName: name })
            : translate('Open focus task: %{taskName}', { taskName: name })
        const path = `/projects/${focusProjectId}/tasks/${focused.id}/properties`
        const open = event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            onOpen?.({ taskId: focused.id, projectId: focusProjectId })
        }
        const swap = () => {
            if (!userId) return
            const fromTaskId = focused.id
            const fromProjectId = focusProjectId
            startRoll('swap', [reelName(focused.name)], async onCandidates => {
                try {
                    const { status, startedOver } = await rerollFocusTask({
                        userId,
                        taskId: fromTaskId,
                        projectId: fromProjectId,
                        onCandidates,
                    })
                    if (status === 'picked' || status === 'offline') {
                        return {
                            status: 'picked',
                            notice: startedOver ? translate('You have seen every task for today – starting over') : '',
                        }
                    }
                    if (status === 'none') return { status, notice: translate('No other open task for today') }
                    return { status }
                } catch (error) {
                    return {
                        status: 'error',
                        notice:
                            error?.code === 'offline'
                                ? translate('You are offline. Reconnect to get a different focus task.')
                                : translate('The focus task could not be picked. Please try again.'),
                    }
                }
            })
        }
        return (
            <div className={`anna-focus-pill${phase === 'landing' ? ' anna-focus-landed' : ''}`}>
                <a
                    className="anna-focus-task"
                    href={path}
                    data-anna-open-in-app=""
                    aria-label={label}
                    title={label}
                    onClick={open}
                >
                    <Icon name="crosshair" size={16} color="currentColor" />
                    {!!projectName && (
                        <span className="anna-focus-task-project">
                            <span
                                aria-hidden="true"
                                className="anna-project-dot"
                                style={project.color ? { background: project.color } : undefined}
                            />
                            <span className="anna-focus-task-project-name">{projectName}</span>
                        </span>
                    )}
                    <span className="anna-focus-task-name">{name}</span>
                </a>
                <button
                    type="button"
                    className="anna-focus-reroll"
                    aria-label={rerollLabel}
                    title={rerollLabel}
                    onClick={swap}
                >
                    <Icon name="refresh-cw" size={14} color="currentColor" />
                </button>
                {!!notice && (
                    <span className="anna-focus-notice" role="status">
                        {notice}
                    </span>
                )}
            </div>
        )
    }

    // A focus id whose task has not arrived yet is unresolved, not "no focus task": keep the old UI.
    const focusSettled = !focusTaskId || (task?.id === focusTaskId && !!task.done)
    if (todayInbox === TODAY_INBOX_EMPTY && focusSettled) {
        const label = translate('Congrats - you have reached empty inbox across all your projects')
        return (
            <div className="anna-focus-empty-inbox" role="status" aria-label={label} title={label}>
                <span className="anna-focus-empty-inbox-icon" aria-hidden="true">
                    <Icon name="check-circle" size={16} color="currentColor" />
                </span>
                <span className="anna-focus-task-name">{translate('Empty inbox for today – well done!')}</span>
            </div>
        )
    }

    const pick = () => {
        const projectId = focusProjectId || defaultProjectId || firstProjectId
        if (!userId || !projectId) return
        startRoll('get', [], async onCandidates => {
            try {
                const found = await pickNewFocusTask(projectId, userId, { onCandidates })
                return found ? { status: 'picked' } : { status: 'none', notice: translate('No open task for today') }
            } catch (_) {
                return { status: 'error', notice: translate('The focus task could not be picked. Please try again.') }
            }
        })
    }
    return (
        <button type="button" className="anna-focus-get" onClick={pick}>
            <Icon name="crosshair" size={16} color="currentColor" />
            <span className="anna-focus-task-name" role={notice ? 'status' : undefined}>
                {notice || translate('Get a focus task')}
            </span>
        </button>
    )
}

/**
 * Whether the roll may start slowing down: the pick has answered, the reel has turned long enough to
 * be seen, and a picked task is on screen (or it has been waited for long enough).
 */
function readyToLand(run, shownTaskId) {
    if (!run.result || run.ticks < MIN_TICKS) return false
    if (run.result.status !== 'picked') return true
    if (shownTaskId && shownTaskId !== run.fromTaskId) return true
    return run.ticksSinceResult >= LAND_WAIT_TICKS
}
