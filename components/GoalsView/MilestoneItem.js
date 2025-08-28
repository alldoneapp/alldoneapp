import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import DismissibleItem from '../UIComponents/DismissibleItem'
import EditMilestone from './EditMilestone'
import MilestonePresentation from './MilestonePresentation'
import { useSelector } from 'react-redux'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import useSelectorHashtagFilters from '../HashtagFilters/UseSelectorHashtagFilters'
import { filterGoals } from '../HashtagFilters/FilterHelpers/FilterGoals'
import AddGoals from './AddGoals'
import GoalsByAssignee from './GoalsByAssignee'
import { filterGoalsByAssignee, getAssigneesIdsToShowInBoard } from './GoalsHelper'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function MilestoneItem({
    projectId,
    milestone,
    setDismissibleRefs,
    unsetDismissibleRefs,
    openEdition,
    closeEdition,
    firstMilestoneId,
    previousMilestoneDate,
    isActiveMilestone,
}) {
    const activeDragGoalMode = useSelector(state => state.activeDragGoalMode === milestone.id)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const userWorkstreamsIdsInProject = useSelector(state =>
        state.currentUser.workstreams ? state.currentUser.workstreams[projectId] : null
    )
    const projectUsersAmount = useSelector(state => state.projectUsers[projectId].length)
    const projectWorkstreamsAmount = useSelector(state => state.projectWorkstreams[projectId].length)
    const projectContactsAmount = useSelector(state => state.projectContacts[projectId].length)
    const boardGoals = useSelector(state => state.boardGoalsByMilestoneByProject[projectId][milestone.id])
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)

    const [goalsByAssigneeArray, setGoalsByAssigneeArray] = useState([])
    const [filteredGoals, setFilteredGoals] = useState([])

    const [filters, filtersArray] = useSelectorHashtagFilters()

    const { id: milestoneId } = milestone
    const setRef = ref => {
        setDismissibleRefs(ref, milestoneId)
    }

    const openEditionMode = () => {
        openEdition(milestoneId)
        setTimeout(() => {
            dismissAllPopups()
        })
    }

    const closeEditionMode = () => {
        closeEdition(milestoneId)
    }

    useEffect(() => {
        return () => {
            unsetDismissibleRefs(milestoneId)
        }
    }, [])

    useEffect(() => {
        if (currentUserId) {
            const newGoals = filtersArray.length > 0 ? filterGoals(boardGoals) : boardGoals
            const assigneesIdsToShow = getAssigneesIdsToShowInBoard(
                currentUserId,
                userWorkstreamsIdsInProject,
                projectId
            )

            const goalsByAssigneeArray = filterGoalsByAssignee(
                newGoals,
                currentUserId,
                milestone.id,
                assigneesIdsToShow
            )
            setFilteredGoals(newGoals)
            setGoalsByAssigneeArray(goalsByAssigneeArray)
        }
    }, [
        JSON.stringify(filtersArray),
        boardGoals,
        currentUserId,
        projectUsersAmount,
        projectWorkstreamsAmount,
        projectContactsAmount,
        projectId,
    ])

    const isTemplateProject = templateProjectIds.includes(projectId)

    const loggedUserIsMilestoneOwner = loggedUserId === milestone.ownerId
    const loggedUserCanUpdateObject =
        loggedUserIsMilestoneOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        (filtersArray.length === 0 || filteredGoals.length > 0) && (
            <View style={localStyles.container} pointerEvents={activeDragGoalMode ? 'none' : 'auto'}>
                <DismissibleItem
                    ref={setRef}
                    defaultComponent={
                        <MilestonePresentation
                            projectId={projectId}
                            onPress={openEditionMode}
                            milestone={milestone}
                            goals={filteredGoals}
                            firstMilestoneId={firstMilestoneId}
                            previousMilestoneDate={previousMilestoneDate}
                            isActiveMilestone={isActiveMilestone}
                            loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                        />
                    }
                    modalComponent={
                        <EditMilestone projectId={projectId} onCancelAction={closeEditionMode} milestone={milestone} />
                    }
                />
                {loggedUserCanUpdateObject && !milestone.done && !isTemplateProject && (
                    <AddGoals
                        activeDragGoalMode={activeDragGoalMode}
                        projectId={projectId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        milestoneId={milestoneId}
                        milestoneDate={milestone.date}
                        refId={`Add${milestoneId}`}
                        inDone={milestone.done}
                    />
                )}
                <GoalsByAssignee
                    projectId={projectId}
                    milestoneId={milestoneId}
                    setDismissibleRefs={setDismissibleRefs}
                    openEdition={openEdition}
                    closeEdition={closeEdition}
                    inDoneMilestone={milestone.done}
                    activeDragGoalMode={activeDragGoalMode}
                    goalsByAssigneeArray={goalsByAssigneeArray}
                    milestoneGoals={boardGoals}
                />
                {loggedUserCanUpdateObject && !milestone.done && isTemplateProject && (
                    <AddGoals
                        activeDragGoalMode={activeDragGoalMode}
                        projectId={projectId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        milestoneId={milestoneId}
                        milestoneDate={milestone.date}
                        refId={`Add${milestoneId}`}
                        inDone={milestone.done}
                    />
                )}
            </View>
        )
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 50,
    },
})
