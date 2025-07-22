import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import GoalsBacklogHeader from './GoalsBacklogHeader'
import { BACKLOG_MILESTONE_ID, filterGoalsByAssignee, getAssigneesIdsToShowInBoard } from './GoalsHelper'
import { BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'
import useSelectorHashtagFilters from '../HashtagFilters/UseSelectorHashtagFilters'
import { filterGoals } from '../HashtagFilters/FilterHelpers/FilterGoals'
import AddGoals from './AddGoals'
import GoalsByAssignee from './GoalsByAssignee'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function GoalsBacklog({
    projectId,
    projectIndex,
    milestoneId,
    setDismissibleRefs,
    openEdition,
    closeEdition,
    previousMilestoneDate,
}) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const userWorkstreamsIdsInProject = useSelector(state =>
        state.currentUser.workstreams ? state.currentUser.workstreams[projectId] : null
    )
    const projectUsersAmount = useSelector(state => state.projectUsers[projectId].length)
    const projectWorkstreamsAmount = useSelector(state => state.projectWorkstreams[projectId].length)
    const projectContactsAmount = useSelector(state => state.projectContacts[projectId].length)
    const boardGoals = useSelector(state => state.boardGoalsByMilestoneByProject[projectId][milestoneId])
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)

    const activeDragGoalMode = useSelector(state =>
        typeof state.activeDragGoalMode === 'string'
            ? state.activeDragGoalMode.startsWith(BACKLOG_MILESTONE_ID)
            : state.activeDragGoalMode
    )

    const [goalsByAssigneeArray, setGoalsByAssigneeArray] = useState([])
    const [filteredGoals, setFilteredGoals] = useState([])

    const [filters, filtersArray] = useSelectorHashtagFilters()

    useEffect(() => {
        if (currentUserId) {
            const newGoals = filtersArray.length > 0 ? filterGoals(boardGoals) : boardGoals
            const assigneesIdsToShow = getAssigneesIdsToShowInBoard(
                currentUserId,
                userWorkstreamsIdsInProject,
                projectId
            )
            const goalsByAssigneeArray = filterGoalsByAssignee(newGoals, currentUserId, milestoneId, assigneesIdsToShow)
            setFilteredGoals(newGoals)
            setGoalsByAssigneeArray(goalsByAssigneeArray)
        }
    }, [
        JSON.stringify(filtersArray),
        boardGoals,
        currentUserId,
        projectIndex,
        projectUsersAmount,
        projectWorkstreamsAmount,
        projectContactsAmount,
    ])

    const isTemplateProject = templateProjectIds.includes(projectId)

    const loggedUserIsBoardOwner = loggedUserId === currentUserId
    const loggedUserCanUpdateObject =
        loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        (filtersArray.length === 0 || filteredGoals.length > 0) && (
            <View style={{ marginBottom: 24 }}>
                <GoalsBacklogHeader
                    projectId={projectId}
                    previousMilestoneDate={previousMilestoneDate}
                    milestoneId={milestoneId}
                    goals={filteredGoals}
                />
                {loggedUserCanUpdateObject && !isTemplateProject && (
                    <AddGoals
                        activeDragGoalMode={activeDragGoalMode}
                        projectId={projectId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        milestoneId={milestoneId}
                        milestoneDate={BACKLOG_DATE_NUMERIC}
                        refId={`Add${milestoneId}_backlog`}
                    />
                )}
                <GoalsByAssignee
                    projectId={projectId}
                    milestoneId={milestoneId}
                    setDismissibleRefs={setDismissibleRefs}
                    openEdition={openEdition}
                    closeEdition={closeEdition}
                    inDoneMilestone={false}
                    activeDragGoalMode={activeDragGoalMode}
                    goalsByAssigneeArray={goalsByAssigneeArray}
                    milestoneGoals={boardGoals}
                />
                {loggedUserCanUpdateObject && isTemplateProject && (
                    <AddGoals
                        activeDragGoalMode={activeDragGoalMode}
                        projectId={projectId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        milestoneId={milestoneId}
                        milestoneDate={BACKLOG_DATE_NUMERIC}
                        refId={`Add${milestoneId}_backlog`}
                    />
                )}
            </View>
        )
    )
}
