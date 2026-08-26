import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import OpenTasksByProject from './OpenTasksByProject'
import { resetLoadingData, setLaterTasksExpandState } from '../../../redux/actions'
import { getProjectIdsForAllProjectsTasks } from './openTasksViewProjectScope'
import AllProjectsAssistantLine from '../../MyDayView/AssistantLine/AllProjectsAssistantLine'
import AllProjectsEmptyInbox from './AllProjectsEmptyInbox'
import AllProjectsShowMoreButtonContainer from './AllProjectsShowMoreButtonContainer'
import AllProjectsShowMoreAvailability from './AllProjectsShowMoreAvailability'
import AllProjectsLine from '../Header/AllProjectsLine/AllProjectsLine'
import TaskFiltersLine from '../PriorityFilters/TaskFiltersLine'
import EmailLine from '../EmailLine/EmailLine'
import { EMAIL_LINE_ENABLED } from '../EmailLine/emailLineFeature'
import useNearViewportMount from '../../../hooks/useNearViewportMount'
import useRateLimitedProjectMountQueue from '../../../hooks/useRateLimitedProjectMountQueue'
import TaskListSkeleton from '../TaskListSkeleton'

// Start a bounded two-project preload roughly two deferred blocks ahead. This
// overlaps network latency without mounting the full All Projects board.
export const ALL_PROJECTS_TASK_PRELOAD_ROOT_MARGIN = '720px 0px'
export const ALL_PROJECTS_TASK_PRELOAD_CONCURRENCY = 2
export const ALL_PROJECTS_TASK_GHOST_MIN_VISIBLE_MS = 200
export const SKIPPED_PROJECT_GHOST_HIDE_DELAY_MS = 120

const uniqueProjectIndexes = indexes => [...new Set(indexes.filter(index => index !== null))]

export const getViewportPriorityProjectState = ({
    projectNodes,
    mountedProjectIndexes,
    projectCount,
    viewportTop = 56,
    viewportBottom,
}) => {
    const mountedSet = new Set(mountedProjectIndexes)
    const measuredProjects = [...projectNodes.entries()]
        .filter(([index]) => index < projectCount)
        .map(([index, node]) => ({ index, bounds: node?.getBoundingClientRect?.() }))
        .filter(({ bounds }) => bounds)
        .sort((first, second) => first.bounds.top - second.bounds.top)
    const visibleProjects = measuredProjects.filter(
        ({ bounds }) => bounds.bottom > viewportTop && bounds.top < viewportBottom
    )
    const visibleUnloadedIndexes = visibleProjects.map(({ index }) => index).filter(index => !mountedSet.has(index))

    if (visibleProjects.length === 0) {
        return { projectIndexes: [], hasVisibleProject: false }
    }

    const lastVisibleIndex = visibleProjects[visibleProjects.length - 1].index
    let nextUnloadedIndex = lastVisibleIndex + 1
    while (nextUnloadedIndex < projectCount && mountedSet.has(nextUnloadedIndex)) nextUnloadedIndex += 1

    return {
        projectIndexes: uniqueProjectIndexes([
            ...visibleUnloadedIndexes,
            nextUnloadedIndex < projectCount ? nextUnloadedIndex : null,
        ]),
        hasVisibleProject: true,
    }
}

function DeferredProjectBlock({
    projectIndex,
    mounted,
    preloading,
    observe,
    showGhost,
    onNearViewport,
    onPlaceholderRef,
    children,
}) {
    const { placeholderRef, isNearViewport, hasPassedViewport } = useNearViewportMount({
        eager: mounted,
        enabled: observe,
        rootMargin: ALL_PROJECTS_TASK_PRELOAD_ROOT_MARGIN,
        trackVisibility: true,
        activateWhenPassed: true,
    })

    useEffect(() => {
        if (observe) onNearViewport(projectIndex, isNearViewport, hasPassedViewport)
    }, [hasPassedViewport, isNearViewport, observe, onNearViewport, projectIndex])

    const setPlaceholderRef = useCallback(
        node => {
            placeholderRef.current = node
            onPlaceholderRef(projectIndex, node)
        },
        [onPlaceholderRef, placeholderRef, projectIndex]
    )

    return (
        <View ref={setPlaceholderRef} style={!mounted && localStyles.deferredProjectPlaceholder}>
            {(mounted || preloading) && <View style={!mounted && localStyles.preloadedProject}>{children}</View>}
            {!mounted && showGhost && <TaskListSkeleton rowCount={6} showDateHeader showProjectHeader />}
        </View>
    )
}

function SkippedProjectCatchUpSkeleton({ visible, style }) {
    const [rendered, setRendered] = useState(visible)

    useEffect(() => {
        if (visible) {
            setRendered(true)
            return undefined
        }

        const timer = setTimeout(() => setRendered(false), SKIPPED_PROJECT_GHOST_HIDE_DELAY_MS)
        return () => clearTimeout(timer)
    }, [visible])

    if (!rendered) return null

    return (
        <View testID="task-list-skipped-project-skeleton" style={style}>
            <TaskListSkeleton rowCount={6} showDateHeader showProjectHeader />
        </View>
    )
}

export default function OpenTasksViewAllProjects() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const guideProjectIds = useSelector(state => state.loggedUser.guideProjectIds)
    const projectIds = useSelector(state => state.loggedUser.projectIds)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const openTasksAmount = useSelector(state => state.openTasksAmount)
    const openTasksAmountLoaded = useSelector(state => state.openTasksAmountLoaded)
    const todayEmptyGoalsTotal = useSelector(state => state.todayEmptyGoalsTotalAmountInOpenTasksView.total)
    const inFocusTaskProjectId = useSelector(state => state.loggedUser.inFocusTaskProjectId)
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const [projectsHaveTasksInFirstDay, setProjectsHaveTasksInFirstDay] = useState({})
    const [viewportGhostProjectIndexes, setViewportGhostProjectIndexes] = useState([])
    const projectNodesRef = useRef(new Map())

    // AT-2337: this list is recomputed on every render of the all-projects board
    // (two lodash `orderBy` passes with a `name.toLowerCase()` key, over a filter
    // that scans the archived/template/guide arrays per project), and it is handed
    // to every `OpenTasksByProject` as a prop. Without memoisation each render
    // produced a NEW array identity, which defeats `React.memo` on the ~78 project
    // blocks below and re-rendered all of them for any unrelated store change.
    //
    // The scope itself is ACTIVE projects only (archived, template and guide projects
    // excluded) — see `openTasksViewProjectScope.js`.
    const sortedLoggedUserProjectIds = useMemo(
        () =>
            getProjectIdsForAllProjectsTasks({
                projectIds,
                guideProjectIds,
                archivedProjectIds,
                templateProjectIds,
                loggedUserProjectsMap,
                loggedUserId,
                inFocusTaskProjectId,
            }),
        [
            projectIds,
            guideProjectIds,
            archivedProjectIds,
            templateProjectIds,
            loggedUserProjectsMap,
            loggedUserId,
            inFocusTaskProjectId,
        ]
    )
    const projectReadyStates = useSelector(
        state =>
            sortedLoggedUserProjectIds.map(projectId => {
                const instanceKey = projectId + currentUserId
                return (
                    !!state.initialLoadingEndOpenTasks?.[instanceKey] &&
                    !!state.initialLoadingEndObservedTasks?.[instanceKey]
                )
            }),
        shallowEqual
    )
    const {
        mountedProjectIndexes,
        preloadingProjectIndexes,
        preloadingProjectSkipped,
        nextProjectIndex,
        markProjectNearViewport,
    } = useRateLimitedProjectMountQueue({
        projectIds: sortedLoggedUserProjectIds,
        projectReadyStates,
        minIntervalMs: ALL_PROJECTS_TASK_GHOST_MIN_VISIBLE_MS,
        preloadConcurrency: ALL_PROJECTS_TASK_PRELOAD_CONCURRENCY,
    })
    const mountedProjectIndexesSet = useMemo(() => new Set(mountedProjectIndexes), [mountedProjectIndexes])
    const viewportGhostProjectIndexesSet = useMemo(
        () => new Set(viewportGhostProjectIndexes),
        [viewportGhostProjectIndexes]
    )

    const registerProjectPlaceholder = useCallback((projectIndex, node) => {
        if (node) projectNodesRef.current.set(projectIndex, node)
        else projectNodesRef.current.delete(projectIndex)
    }, [])

    const handleProjectNearViewport = useCallback(
        (projectIndex, isNearViewport, hasPassedViewport) => {
            const viewportPriority = hasPassedViewport
                ? getViewportPriorityProjectState({
                      projectNodes: projectNodesRef.current,
                      mountedProjectIndexes,
                      projectCount: sortedLoggedUserProjectIds.length,
                      viewportBottom: typeof window === 'undefined' ? Number.MAX_SAFE_INTEGER : window.innerHeight,
                  })
                : { projectIndexes: [], hasVisibleProject: false }
            const viewportProjectIndexes = viewportPriority.projectIndexes
            if (hasPassedViewport && viewportProjectIndexes.length > 0) {
                setViewportGhostProjectIndexes(current =>
                    current.length === viewportProjectIndexes.length &&
                    current.every((index, position) => index === viewportProjectIndexes[position])
                        ? current
                        : viewportProjectIndexes
                )
            }
            markProjectNearViewport(
                projectIndex,
                isNearViewport,
                hasPassedViewport,
                viewportProjectIndexes,
                viewportPriority.hasVisibleProject
            )
        },
        [markProjectNearViewport, mountedProjectIndexes, sortedLoggedUserProjectIds.length]
    )

    useEffect(() => {
        dispatch(resetLoadingData())
        return () => {
            dispatch(resetLoadingData())
        }
    }, [])

    useEffect(() => {
        return () => {
            dispatch(setLaterTasksExpandState(0))
        }
    }, [])

    let areFirstProject = false

    // AT-2445: `openTasksAmount` is a running total accumulated across one Firestore listener per
    // project, and `unwatchOpenTasksAmount` forces it back to 0 every time those listeners are
    // rebuilt — which happens on every mount of this board (`TasksAmountContainers` registers an
    // empty project list for one pass first), and again on every Later/Someday toggle. So `!amount`
    // is true for the whole loading window and CANNOT mean "empty inbox" on its own.
    //
    // The cost of getting this wrong was not only the congrats flashing during load: that flash
    // mounted `EmptyInboxOverview celebrateNewDay`, whose `useLayoutEffect` spends the once-per-day
    // celebration marker. The day's celebration was therefore routinely consumed by a frame nobody
    // saw, and the real empty-inbox moment later that day showed no animation at all.
    //
    // My Day has always gated this the same way (`tasksLoaded && …` in `MyDayOpenTasks`); the
    // all-projects board was the outlier.
    const needToShowEmptyBoardPicture = openTasksAmountLoaded && !openTasksAmount && !todayEmptyGoalsTotal

    return (
        <View
            style={[
                localStyles.container,
                smallScreenNavigation
                    ? localStyles.containerForMobile
                    : isMiddleScreen && localStyles.containerForTablet,
            ]}
        >
            <AllProjectsLine showEmailLabels={true} />
            <AllProjectsAssistantLine />
            {/* AT-2262: the empty-inbox congrats sits directly UNDER the assistant line
                (which also renders the latest comment) and above the email line and the
                task filters. The assistant composer + last comment must keep the top of
                the page — the congrats is a reward, not the primary control — but it is
                still high enough to be visible without scrolling when the inbox is empty. */}
            {needToShowEmptyBoardPicture && <AllProjectsEmptyInbox showEmptyInboxOverview />}
            {EMAIL_LINE_ENABLED && <EmailLine />}
            <TaskFiltersLine projectId={null} />
            <SkippedProjectCatchUpSkeleton
                visible={preloadingProjectSkipped}
                style={[
                    localStyles.skippedProjectCatchUpSkeleton,
                    smallScreenNavigation
                        ? localStyles.skippedProjectCatchUpSkeletonMobile
                        : isMiddleScreen && localStyles.skippedProjectCatchUpSkeletonTablet,
                ]}
            />
            {sortedLoggedUserProjectIds.map((projectId, index) => {
                let thisProjectIsTheFirstProject = false
                if (projectsHaveTasksInFirstDay[projectId] && !areFirstProject) {
                    areFirstProject = true
                    thisProjectIsTheFirstProject = true
                }

                return (
                    <DeferredProjectBlock
                        key={projectId}
                        projectIndex={index}
                        mounted={mountedProjectIndexesSet.has(index)}
                        preloading={preloadingProjectIndexes.includes(index)}
                        observe={index === nextProjectIndex}
                        showGhost={
                            index === nextProjectIndex ||
                            preloadingProjectIndexes.includes(index) ||
                            viewportGhostProjectIndexesSet.has(index)
                        }
                        onNearViewport={handleProjectNearViewport}
                        onPlaceholderRef={registerProjectPlaceholder}
                    >
                        <OpenTasksByProject
                            projectId={projectId}
                            firstProject={thisProjectIsTheFirstProject}
                            sortedLoggedUserProjectIds={sortedLoggedUserProjectIds}
                            setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                        />
                    </DeferredProjectBlock>
                )
            })}

            <AllProjectsShowMoreAvailability projectIds={sortedLoggedUserProjectIds} />
            <AllProjectsShowMoreButtonContainer
                projectIds={sortedLoggedUserProjectIds}
                setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 104,
        backgroundColor: 'white',
        marginBottom: 32,
    },
    containerForMobile: {
        paddingHorizontal: 16,
    },
    containerForTablet: {
        paddingHorizontal: 56,
    },
    deferredProjectPlaceholder: {
        minHeight: 360,
    },
    preloadedProject: {
        display: 'none',
    },
    skippedProjectCatchUpSkeleton: {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: 10,
        top: 56,
        left: 104,
        right: 104,
        minHeight: 360,
        paddingTop: 16,
        backgroundColor: 'white',
    },
    skippedProjectCatchUpSkeletonMobile: {
        left: 16,
        right: 16,
    },
    skippedProjectCatchUpSkeletonTablet: {
        left: 56,
        right: 56,
    },
})
