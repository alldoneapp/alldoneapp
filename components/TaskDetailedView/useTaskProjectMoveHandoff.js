import { useCallback, useEffect, useRef, useState } from 'react'
import v4 from 'uuid/v4'

import URLsTasks, {
    URL_TASK_DETAILS_BACKLINKS_NOTES,
    URL_TASK_DETAILS_BACKLINKS_TASKS,
    URL_TASK_DETAILS_CHAT,
    URL_TASK_DETAILS_ESTIMATION,
    URL_TASK_DETAILS_FEED,
    URL_TASK_DETAILS_NOTE,
    URL_TASK_DETAILS_PROPERTIES,
    URL_TASK_DETAILS_SUBTASKS,
    REPLACE_NEXT_TASK_DETAIL_PUSH,
} from '../../URLSystem/Tasks/URLsTasks'
import {
    DV_TAB_TASK_BACKLINKS,
    DV_TAB_TASK_CHAT,
    DV_TAB_TASK_ESTIMATIONS,
    DV_TAB_TASK_NOTE,
    DV_TAB_TASK_PROPERTIES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_TASK_SUBTASKS,
    DV_TAB_TASK_UPDATES,
} from '../../utils/TabNavigationConstants'
import { getTaskData, unwatch } from '../../utils/backends/firestore'
import { watchTask } from '../../utils/backends/Tasks/tasksFirestore'
import NavigationService from '../../utils/NavigationService'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import {
    resetFloatPopup,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    showConfirmPopup,
    switchProject,
} from '../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_INFO } from '../UIComponents/ConfirmPopup'

export const TASK_PROJECT_MOVE_HANDOFF_TIMEOUT_MS = 90 * 1000

const URL_BY_TASK_TAB = {
    [DV_TAB_TASK_PROPERTIES]: URL_TASK_DETAILS_PROPERTIES,
    [DV_TAB_TASK_ESTIMATIONS]: URL_TASK_DETAILS_ESTIMATION,
    [DV_TAB_TASK_SUBTASKS]: URL_TASK_DETAILS_SUBTASKS,
    [DV_TAB_TASK_NOTE]: URL_TASK_DETAILS_NOTE,
    [DV_TAB_TASK_CHAT]: URL_TASK_DETAILS_CHAT,
    [DV_TAB_TASK_UPDATES]: URL_TASK_DETAILS_FEED,
}

export function getTaskMoveHandoffUrl(selectedTab, pathname = '') {
    if (selectedTab === DV_TAB_TASK_BACKLINKS) {
        return pathname.endsWith('/backlinks/notes')
            ? URL_TASK_DETAILS_BACKLINKS_NOTES
            : URL_TASK_DETAILS_BACKLINKS_TASKS
    }
    return URL_BY_TASK_TAB[selectedTab] || URL_TASK_DETAILS_PROPERTIES
}

export function taskHasMatchingProjectMove(task, handoff) {
    const projectMove = task?.projectMove
    if (!projectMove) return false
    if (projectMove.sourceProjectId !== handoff.sourceProjectId) return false
    if (projectMove.targetProjectId !== handoff.targetProjectId) return false
    return !handoff.requestId || !projectMove.requestId || projectMove.requestId === handoff.requestId
}

export function taskMatchesProjectMove(task, handoff, status) {
    return task?.projectMove?.status === status && taskHasMatchingProjectMove(task, handoff)
}

/**
 * Keeps an open task DV alive while its Cloud Tasks project move crosses the
 * create-marker-delete boundary. The destination is watched independently of
 * the source, because a Firestore listener may coalesce the source marker and
 * deletion into a single missing-document snapshot.
 */
export default function useTaskProjectMoveHandoff({
    sourceProjectId,
    taskId,
    selectedTab,
    loggedUser,
    loggedUserProjectsMap,
    dispatch,
}) {
    const [handoff, setHandoffState] = useState(null)
    const handoffRef = useRef(null)
    const completedRef = useRef(false)

    const setHandoff = useCallback(value => {
        handoffRef.current = value
        setHandoffState(value)
    }, [])

    const showMoveFeedback = useCallback(
        (headerText, headerQuestion) => {
            dispatch(
                showConfirmPopup({
                    trigger: CONFIRM_POPUP_TRIGGER_INFO,
                    object: { headerText, headerQuestion },
                })
            )
        },
        [dispatch]
    )

    const startTaskProjectMove = useCallback(
        (targetProject, origin = 'project_picker') => {
            if (!targetProject?.id || targetProject.id === sourceProjectId || handoffRef.current) return false
            completedRef.current = false
            setHandoff({
                sourceProjectId,
                targetProjectId: targetProject.id,
                targetProject,
                taskId,
                requestId: null,
                origin,
                status: 'pending',
                startedAt: Date.now(),
            })
            return true
        },
        [setHandoff, sourceProjectId, taskId]
    )

    const taskProjectMoveEnqueued = useCallback(
        result => {
            const active = handoffRef.current
            if (!active || result?.targetProjectId !== active.targetProjectId) return
            setHandoff({ ...active, requestId: result.requestId || null })
        },
        [setHandoff]
    )

    const taskProjectMoveEnqueueFailed = useCallback(() => {
        setHandoff(null)
    }, [setHandoff])

    const finishHandoff = useCallback(
        movedTask => {
            const active = handoffRef.current
            if (!active || completedRef.current) return
            const targetProject = loggedUserProjectsMap[active.targetProjectId] || active.targetProject
            if (!targetProject) return

            completedRef.current = true
            const pathname = typeof window === 'undefined' ? '' : window.location?.pathname || ''
            const urlConstant = getTaskMoveHandoffUrl(selectedTab, pathname)
            const routeData = {
                noHistory: true,
                projectId: active.targetProjectId,
                task: movedTask.id,
                [REPLACE_NEXT_TASK_DETAIL_PUSH]: true,
            }
            URLsTasks.replace(urlConstant, routeData, active.targetProjectId, movedTask.id)

            dispatch([
                resetFloatPopup(),
                setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                switchProject(targetProject.index),
                setSelectedTypeOfProject(ProjectHelper.getTypeOfProject(loggedUser, active.targetProjectId)),
            ])
            setHandoff(null)
            NavigationService.navigate('TaskDetailedView', {
                task: { ...movedTask, projectId: active.targetProjectId, movingToOtherProjectId: null },
                projectId: active.targetProjectId,
            })
        },
        [dispatch, loggedUser, loggedUserProjectsMap, selectedTab, setHandoff]
    )

    const failBackgroundMove = useCallback(() => {
        setHandoff(null)
        showMoveFeedback('Task move failed', 'The task is still in its current project. Please try again.')
    }, [setHandoff, showMoveFeedback])

    useEffect(() => {
        if (!handoff) return undefined
        const watcherKey = `task-project-move-${v4()}`
        let pollTimer = null
        let stopped = false
        const inspectTargetTask = targetTask => {
            const active = handoffRef.current
            if (!active || active.targetProjectId !== handoff.targetProjectId || !targetTask) return
            if (
                taskMatchesProjectMove(targetTask, active, 'completed') ||
                (active.origin === 'source_marker' && !taskHasMatchingProjectMove(targetTask, active))
            ) {
                finishHandoff(targetTask)
            } else if (taskMatchesProjectMove(targetTask, active, 'failed')) {
                failBackgroundMove()
            }
        }
        const pollTarget = async () => {
            if (stopped || !handoffRef.current) return
            try {
                inspectTargetTask(await getTaskData(handoff.targetProjectId, taskId))
            } catch (error) {
                console.warn('[task project move] Destination fallback read failed', {
                    targetProjectId: handoff.targetProjectId,
                    taskId,
                    code: error?.code,
                })
            }
            if (!stopped && handoffRef.current) pollTimer = setTimeout(pollTarget, 1000)
        }
        watchTask(handoff.targetProjectId, taskId, watcherKey, inspectTargetTask, error => {
            console.warn('[task project move] Destination listener failed; falling back to reads', {
                targetProjectId: handoff.targetProjectId,
                taskId,
                code: error?.code,
            })
            if (!pollTimer) pollTarget()
        })
        return () => {
            stopped = true
            if (pollTimer) clearTimeout(pollTimer)
            unwatch(watcherKey)
        }
    }, [failBackgroundMove, finishHandoff, handoff?.targetProjectId, taskId])

    useEffect(() => {
        if (!handoff || handoff.status !== 'pending') return undefined
        const timer = setTimeout(() => {
            const active = handoffRef.current
            if (!active || active.status !== 'pending') return
            // Stop the spinner and restore the source project label, but retain
            // the handoff guard/listener: Cloud Tasks may still be retrying and
            // a late source deletion must not become a privacy error.
            setHandoff({ ...active, status: 'timed_out' })
            showMoveFeedback(
                'Task move is taking longer than expected',
                'We are still checking the move. This view will switch projects automatically when it completes.'
            )
        }, TASK_PROJECT_MOVE_HANDOFF_TIMEOUT_MS)
        return () => clearTimeout(timer)
    }, [handoff?.status, handoff?.targetProjectId, setHandoff, showMoveFeedback])

    const handleSourceTaskChange = useCallback(
        sourceTask => {
            let active = handoffRef.current

            if (sourceTask?.movingToOtherProjectId && !active) {
                const targetProjectId = sourceTask.movingToOtherProjectId
                const targetProject = loggedUserProjectsMap[targetProjectId] || { id: targetProjectId }
                startTaskProjectMove(targetProject, 'source_marker')
                active = handoffRef.current
            }

            if (active && taskMatchesProjectMove(sourceTask, active, 'failed')) {
                failBackgroundMove()
                return true
            }

            // A missing source is expected throughout the handoff, including
            // after the visible timeout. The destination listener is the sole
            // authority for completing the navigation.
            return !sourceTask && !!active
        },
        [failBackgroundMove, loggedUserProjectsMap, startTaskProjectMove]
    )

    return {
        handoff,
        isHandoffActive: !!handoff,
        isMovePending: handoff?.status === 'pending',
        startTaskProjectMove,
        taskProjectMoveEnqueued,
        taskProjectMoveEnqueueFailed,
        handleSourceTaskChange,
    }
}
