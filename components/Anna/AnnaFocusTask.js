import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import Icon from '../Icon'
import { pickNewFocusTask } from '../../utils/backends/Tasks/tasksFirestore'
import { annaActivityPreview } from './annaActivityText'
import { translate } from '../../i18n/TranslationService'

const NOTICE_MS = 4000

/**
 * Assistant mode: the middle of the chat header's row. It shows the user's focus task
 * (`loggedUser.inFocusTaskId`, read through InFocusTaskWatcher's `taskInFocus`). A click calls
 * `onOpen({ taskId, projectId })`: AnnaShell leaves the chat for the app's open task list and
 * scrolls it to the task.
 * The link's own target is the task, for a modified click (a new tab); AnnaShell's link
 * interception skips it (`data-anna-open-in-app`). With no focus task it offers to pick one, the
 * same pick as after completing the focus task.
 */
export default function AnnaFocusTask({ onOpen }) {
    const userId = useSelector(state => state.loggedUser.uid)
    const focusTaskId = useSelector(state => state.loggedUser.inFocusTaskId)
    const focusProjectId = useSelector(state => state.loggedUser.inFocusTaskProjectId)
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const firstProjectId = useSelector(state => state.loggedUserProjects?.[0]?.id)
    const task = useSelector(state => state.taskInFocus)
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState('')
    const mounted = useRef(true)
    useEffect(
        () => () => {
            mounted.current = false
        },
        []
    )
    useEffect(() => {
        if (!notice) return
        const timer = setTimeout(() => setNotice(''), NOTICE_MS)
        return () => clearTimeout(timer)
    }, [notice])

    const focused = focusTaskId && focusProjectId && task?.id === focusTaskId && !task.done ? task : null
    if (focused) {
        const name = annaActivityPreview(focused.name || '', 160) || translate('Task')
        const label = translate('Open focus task: %{taskName}', { taskName: name })
        const path = `/projects/${focusProjectId}/tasks/${focused.id}/properties`
        const open = event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            onOpen?.({ taskId: focused.id, projectId: focusProjectId })
        }
        return (
            <a
                className="anna-focus-task"
                href={path}
                data-anna-open-in-app=""
                aria-label={label}
                title={label}
                onClick={open}
            >
                <Icon name="crosshair" size={16} color="currentColor" />
                <span className="anna-focus-task-name">{name}</span>
            </a>
        )
    }

    const pick = async () => {
        const projectId = focusProjectId || defaultProjectId || firstProjectId
        if (busy || !userId || !projectId) return
        setBusy(true)
        setNotice('')
        try {
            const found = await pickNewFocusTask(projectId, userId)
            if (mounted.current && !found) setNotice(translate('No open task for today'))
        } catch (_) {
            if (mounted.current) setNotice(translate('The focus task could not be picked. Please try again.'))
        } finally {
            if (mounted.current) setBusy(false)
        }
    }
    return (
        <button type="button" className="anna-focus-get" disabled={busy} aria-busy={busy} onClick={pick}>
            <Icon name={busy ? 'loader' : 'crosshair'} size={16} color="currentColor" />
            <span className="anna-focus-task-name" role={notice ? 'status' : undefined}>
                {notice || translate('Get a focus task')}
            </span>
        </button>
    )
}
