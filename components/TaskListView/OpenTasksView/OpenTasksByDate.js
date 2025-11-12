import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch, shallowEqual } from 'react-redux'

import OpenTasksDateHeader from '../Header/OpenTasksDateHeader'
import UpcomingMilestoneRow from '../Header/UpcomingMilestoneRow'
import { removeActiveDragTaskModeInDate, setSelectedTasks } from '../../../redux/actions'
import { AMOUNT_TASKS_INDEX, DATE_TASK_INDEX, EMPTY_SECTION_INDEX, TODAY_DATE } from '../../../utils/backends/openTasks'
import TopShowMoreButton from './TopShowMoreButton'
import MiddleShowMoreButton from './MiddleShowMoreButton'
import SelectedProjectEmptyInbox from './SelectedProjectEmptyInbox'
import TasksSections from './TasksSections'
import { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import AllProjectsShowMoreButtonContainer from './AllProjectsShowMoreButtonContainer'

export default function OpenTasksByDate({
    projectId,
    dateIndex,
    projectIndex,
    instanceKey,
    setProjectsHaveTasksInFirstDay,
    sortedLoggedUserProjectIds,
    pressedShowMoreMainSection,
    setPressedShowMoreMainSection,
}) {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const activeDragTaskModeInDate = useSelector(state => state.activeDragTaskModeInDate)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const loggedUserProjectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const dateFormated = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][DATE_TASK_INDEX])
    const amountTasks = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][AMOUNT_TASKS_INDEX])
    const emptyGoalsAmount = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][EMPTY_SECTION_INDEX].length
    )
    const laterTasksExpanded = useSelector(state => state.laterTasksExpanded)
    const laterTasksExpandState = useSelector(state => state.laterTasksExpandState)
    const somedayTasksExpanded = useSelector(state => state.somedayTasksExpanded)
    const lastFormatedDate = useSelector(
        state =>
            state.filteredOpenTasksStore[instanceKey][state.filteredOpenTasksStore[instanceKey].length - 1][
                DATE_TASK_INDEX
            ]
    )

    const thereAreLaterOpenTasksInProject = useSelector(state => state.thereAreLaterOpenTasks[projectId])
    const thereAreLaterEmptyGoalsInProject = useSelector(state => state.thereAreLaterEmptyGoals[projectId])
    const thereAreSomedayOpenTasksInProject = useSelector(state => state.thereAreSomedayOpenTasks[projectId])
    const thereAreSomedayEmptyGoalsInProject = useSelector(state => state.thereAreSomedayEmptyGoals[projectId])
    const initialLoadingEndOpenTasks = useSelector(state =>
        state.initialLoadingEndOpenTasks[instanceKey] ? state.initialLoadingEndOpenTasks[instanceKey] : false
    )
    const initialLoadingEndObservedTasks = useSelector(state =>
        state.initialLoadingEndObservedTasks[instanceKey] ? state.initialLoadingEndObservedTasks[instanceKey] : false
    )

    const accessGranted = !isAnonymous && loggedUserProjectIds.includes(projectId)

    const dateIsToday = dateFormated === TODAY_DATE

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    // Determine if we should show the "show more" button
    // For All Projects view: button appears after the last visible date based on expand state
    // For Selected Project view: button appears after today if not expanded
    const isLastVisibleDate = sortedLoggedUserProjectIds
        ? laterTasksExpandState === 0
            ? dateIsToday
            : dateFormated === lastFormatedDate
        : dateIsToday

    const shouldShowButtonInCurrentExpandState = sortedLoggedUserProjectIds
        ? laterTasksExpandState < 2 // In All Projects: show if not fully expanded (state 0 or 1)
        : !laterTasksExpanded // In Selected Project: show if not expanded

    const showTopShowMoreButton =
        isLastVisibleDate &&
        (thereAreLaterOpenTasksInProject ||
            thereAreLaterEmptyGoalsInProject ||
            thereAreSomedayOpenTasksInProject ||
            thereAreSomedayEmptyGoalsInProject) &&
        (inSelectedProject || shouldShowButtonInCurrentExpandState)

    const showMiddleContractShowMoreButton =
        dateFormated === lastFormatedDate && laterTasksExpanded && !somedayTasksExpanded

    const showMiddleExpandShowMoreButton =
        dateFormated === lastFormatedDate &&
        laterTasksExpanded &&
        !somedayTasksExpanded &&
        (thereAreSomedayOpenTasksInProject || thereAreSomedayEmptyGoalsInProject)

    useEffect(() => {
        return () => {
            dispatch(removeActiveDragTaskModeInDate())
            dispatch(setSelectedTasks(null, true))
        }
    }, [])

    const isActiveOrganizeMode =
        activeDragTaskModeInDate &&
        activeDragTaskModeInDate.projectId === projectId &&
        activeDragTaskModeInDate.dateIndex === dateIndex

    const isFirstDate = dateIndex === 0

    const showAllProjectsShowMoreButtonContainer = sortedLoggedUserProjectIds && isFirstDate && laterTasksExpanded

    return (
        <View>
            {(dateIsToday || isFirstDate) && <UpcomingMilestoneRow projectId={projectId} />}
            <OpenTasksDateHeader
                projectId={projectId}
                dateIndex={dateIndex}
                instanceKey={instanceKey}
                accessGranted={accessGranted}
            />

            <TasksSections
                projectId={projectId}
                dateIndex={dateIndex}
                projectIndex={projectIndex}
                instanceKey={instanceKey}
                isActiveOrganizeMode={isActiveOrganizeMode}
                pressedShowMoreMainSection={pressedShowMoreMainSection}
                setPressedShowMoreMainSection={setPressedShowMoreMainSection}
            />
            {amountTasks === 0 &&
                emptyGoalsAmount === 0 &&
                initialLoadingEndOpenTasks &&
                initialLoadingEndObservedTasks && (
                    <SelectedProjectEmptyInbox projectId={projectId} instanceKey={instanceKey} />
                )}
            {showTopShowMoreButton && (
                <TopShowMoreButton
                    instanceKey={instanceKey}
                    projectIndex={projectIndex}
                    setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                />
            )}
            {false && showAllProjectsShowMoreButtonContainer && (
                <AllProjectsShowMoreButtonContainer
                    projectIds={sortedLoggedUserProjectIds}
                    setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                />
            )}

            {inSelectedProject && (
                <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                    {showMiddleExpandShowMoreButton && (
                        <MiddleShowMoreButton
                            instanceKey={instanceKey}
                            projectIndex={projectIndex}
                            setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                            expanded={false}
                        />
                    )}
                    {showMiddleContractShowMoreButton && (
                        <MiddleShowMoreButton
                            instanceKey={instanceKey}
                            projectIndex={projectIndex}
                            setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                            expanded={true}
                        />
                    )}
                </View>
            )}
        </View>
    )
}
