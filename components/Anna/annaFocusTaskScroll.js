import { findWorkspaceObject, scrollWorkspaceObject } from './annaWorkspaceRevealTargets'

/**
 * After the header's focus task opens the task list (AnnaFocusTask): waits until the list shows the
 * task's row, which mounts some time after the navigation, and scrolls Alldone to it, the same way
 * the assistant's reveal does (only inside Alldone, centred). It gives up after `timeout`. Returns a
 * cancel function, for a newer click or an unmount.
 */
export function scrollToTaskWhenShown(root, { taskId, projectId }, { timeout = 4000, interval = 100 } = {}) {
    const started = Date.now()
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
    let timer = null
    const attempt = () => {
        const node = root && findWorkspaceObject(root, { type: 'task', objectId: taskId, projectId })
        if (node) {
            scrollWorkspaceObject(node, root, reducedMotion)
            return
        }
        if (Date.now() - started < timeout) timer = setTimeout(attempt, interval)
    }
    timer = setTimeout(attempt, 0)
    return () => clearTimeout(timer)
}
