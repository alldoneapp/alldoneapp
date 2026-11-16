import { findWorkspaceObject, scrollWorkspaceObject, workspaceContentTop } from './annaWorkspaceRevealTargets'

// The person taking over the list: from then on it never moves under them.
const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown']

/**
 * After the header's focus task opens the task list (AnnaFocusTask): waits until the list shows the
 * task's row, which mounts some time after the navigation, and scrolls Alldone to it (only inside
 * Alldone, like the assistant's reveal), centred even when the row is already in view: the person
 * asked to see it. The list keeps loading after that (sections above the row arrive later and push
 * it down), so it keeps the row centred until its place in the list has held still for `settle` ms,
 * at most `follow` ms. It stops as soon as the person scrolls, clicks or types in Alldone, gives up
 * when the row does not show within `timeout`, and returns a cancel function for a newer click or an
 * unmount.
 */
export function scrollToTaskWhenShown(
    root,
    { taskId, projectId },
    { timeout = 8000, interval = 100, settle = 1000, follow = 5000 } = {}
) {
    const started = Date.now()
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
    let timer = null
    let stopped = false
    let shownAt = 0
    let stillSince = 0
    let lastTop = null
    const stop = () => {
        if (stopped) return
        stopped = true
        clearTimeout(timer)
        TAKEOVER_EVENTS.forEach(type => root?.removeEventListener?.(type, stop, true))
    }
    TAKEOVER_EVENTS.forEach(type => root?.addEventListener?.(type, stop, { capture: true, passive: true }))
    const attempt = () => {
        if (stopped) return
        const now = Date.now()
        const node = root && findWorkspaceObject(root, { type: 'task', objectId: taskId, projectId })
        if (node) {
            const top = workspaceContentTop(node, root)
            if (lastTop === null || Math.abs(top - lastTop) > 4) {
                scrollWorkspaceObject(node, root, reducedMotion, { center: true })
                lastTop = top
                stillSince = now
                if (!shownAt) shownAt = now
            }
            if (now - stillSince >= settle || now - shownAt >= follow) return stop()
        } else if (shownAt ? now - shownAt >= follow : now - started >= timeout) {
            return stop()
        }
        timer = setTimeout(attempt, interval)
    }
    timer = setTimeout(attempt, 0)
    return stop
}
