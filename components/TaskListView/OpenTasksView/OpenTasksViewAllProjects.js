import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import OpenTasksByProject from './OpenTasksByProject'
import { resetLoadingData, setLaterTasksExpandState } from '../../../redux/actions'
import { getProjectIdsForAllProjectsTasks } from './openTasksViewProjectScope'
import AssistantLine from '../../MyDayView/AssistantLine/AssistantLine'
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

export const ALL_PROJECTS_TASK_REVEAL_ROOT_MARGIN = '0px'
export const ALL_PROJECTS_TASK_GHOST_MIN_VISIBLE_MS = 1500

function DeferredProjectBlock({ projectIndex, mounted, observe, onNearViewport, children }) {
    const { placeholderRef, isNearViewport } = useNearViewportMount({
        eager: mounted,
        enabled: observe,
        rootMargin: ALL_PROJECTS_TASK_REVEAL_ROOT_MARGIN,
        trackVisibility: true,
    })

    useEffect(() => {
        if (observe) onNearViewport(projectIndex, isNearViewport)
    }, [isNearViewport, observe, onNearViewport, projectIndex])

    return (
        <View ref={placeholderRef} style={!mounted && localStyles.deferredProjectPlaceholder}>
            {mounted ? children : observe ? <TaskListSkeleton rowCount={6} showDateHeader showProjectHeader /> : null}
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
    const todayEmptyGoalsTotal = useSelector(state => state.todayEmptyGoalsTotalAmountInOpenTasksView.total)
    const inFocusTaskProjectId = useSelector(state => state.loggedUser.inFocusTaskProjectId)
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const [projectsHaveTasksInFirstDay, setProjectsHaveTasksInFirstDay] = useState({})

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
    const { mountedProjectCount, nextProjectIndex, markProjectNearViewport } = useRateLimitedProjectMountQueue({
        projectIds: sortedLoggedUserProjectIds,
        projectReadyStates,
        minIntervalMs: ALL_PROJECTS_TASK_GHOST_MIN_VISIBLE_MS,
    })

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

    const needToShowEmptyBoardPicture = !openTasksAmount && !todayEmptyGoalsTotal

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
            <AssistantLine useAssistantProjectContext={false} />
            {/* AT-2262: the empty-inbox congrats sits directly UNDER the assistant line
                (which also renders the latest comment) and above the email line and the
                task filters. The assistant composer + last comment must keep the top of
                the page — the congrats is a reward, not the primary control — but it is
                still high enough to be visible without scrolling when the inbox is empty. */}
            {needToShowEmptyBoardPicture && <AllProjectsEmptyInbox showEmptyInboxOverview />}
            {EMAIL_LINE_ENABLED && <EmailLine />}
            <TaskFiltersLine projectId={null} />
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
                        mounted={index < mountedProjectCount}
                        observe={index === nextProjectIndex}
                        onNearViewport={markProjectNearViewport}
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
})
