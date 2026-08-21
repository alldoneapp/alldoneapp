import React, { useState, useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import OpenTasksByProject from './OpenTasksByProject'
import { resetLoadingData, setLaterTasksExpandState } from '../../../redux/actions'
import { getProjectIdsForAllProjectsTasks } from './openTasksViewProjectScope'
import AssistantLine from '../../MyDayView/AssistantLine/AssistantLine'
import AllProjectsEmptyInbox from './AllProjectsEmptyInbox'
import AllProjectsShowMoreButtonContainer from './AllProjectsShowMoreButtonContainer'
import AllProjectsLine from '../Header/AllProjectsLine/AllProjectsLine'
import TaskFiltersLine from '../PriorityFilters/TaskFiltersLine'
import EmailLine from '../EmailLine/EmailLine'
import { EMAIL_LINE_ENABLED } from '../EmailLine/emailLineFeature'
import useProgressiveReveal from '../../../hooks/useProgressiveReveal'

// Each project block mounts a sizeable UI tree plus its task/milestone/goal watchers.
// Keep the tab-switch commit to one project, then yield a paint between later projects.
export const INITIAL_PROJECTS_TO_RENDER = 1
export const PROJECT_RENDER_BATCH_SIZE = 1

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
    const { visibleAmount: visibleProjectCount, complete: projectRenderComplete } = useProgressiveReveal(
        sortedLoggedUserProjectIds.length,
        {
            initialAmount: INITIAL_PROJECTS_TO_RENDER,
            batchSize: PROJECT_RENDER_BATCH_SIZE,
            // The project map can get a new object identity while watcher snapshots arrive.
            // Reset only when the ordered ids really changed, not on those unrelated updates.
            resetKey: sortedLoggedUserProjectIds.join('\u001f'),
        }
    )
    const visibleProjectIds = sortedLoggedUserProjectIds.slice(0, visibleProjectCount)

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
            {visibleProjectIds.map(projectId => {
                let thisProjectIsTheFirstProject = false
                if (projectsHaveTasksInFirstDay[projectId] && !areFirstProject) {
                    areFirstProject = true
                    thisProjectIsTheFirstProject = true
                }

                return (
                    <OpenTasksByProject
                        key={projectId}
                        projectId={projectId}
                        firstProject={thisProjectIsTheFirstProject}
                        sortedLoggedUserProjectIds={sortedLoggedUserProjectIds}
                        setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                    />
                )
            })}

            {projectRenderComplete && (
                <AllProjectsShowMoreButtonContainer
                    projectIds={sortedLoggedUserProjectIds}
                    setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                />
            )}
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
})
