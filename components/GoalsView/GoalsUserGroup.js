import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import {
    getWorkstreamInProject,
    setWorkstreamLastVisitedBoardDate,
    WORKSTREAM_ID_PREFIX,
} from '../Workstreams/WorkstreamHelper'
import store from '../../redux/store'
import { PROJECT_TYPE_ACTIVE } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper, { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import ContactsHelper from '../ContactsView/Utils/ContactsHelper'
import { DV_TAB_ROOT_GOALS } from '../../utils/TabNavigationConstants'
import { setSelectedSidebarTab, setSelectedTypeOfProject, storeCurrentUser, switchProject } from '../../redux/actions'
import ShowMoreButton from '../UIControls/ShowMoreButton'
import GoalsUserGroupHeader from './GoalsUserGroupHeader'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import GoalsList from './GoalsList'
import GoalListDroppable from '../DragGoalsSystem/GoalListDroppable'

export default function GoalsUserGroup({
    projectId,
    milestoneId,
    setDismissibleRefs,
    openEdition,
    closeEdition,
    inDoneMilestone,
    goals,
    assigneeId,
    activeDragGoalMode,
    milestoneGoals,
}) {
    const dispatch = useDispatch()
    const currentUserId = useSelector(state => state.currentUser.uid)
    const numberGoalsAllTeams = useSelector(state => state.loggedUser.numberGoalsAllTeams)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const navigateToSection = e => {
        e?.preventDefault()
        const { loggedUser } = store.getState()
        let projectType = PROJECT_TYPE_ACTIVE

        const user = TasksHelper.getPeopleById(assigneeId, projectId) || getWorkstreamInProject(projectId, assigneeId)

        if (user.uid.startsWith(WORKSTREAM_ID_PREFIX)) {
            setWorkstreamLastVisitedBoardDate(projectId, user, 'lastVisitBoardInGoals')
        } else {
            projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
            ContactsHelper.setUserLastVisitedBoardDate(projectId, user, 'lastVisitBoardInGoals')
        }

        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_GOALS),
            storeCurrentUser(user),
            setSelectedTypeOfProject(projectType),
            switchProject(projectIndex),
        ])
    }

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    const needLimitGoals =
        (assigneeId !== currentUserId || inAllProjects) && !!numberGoalsAllTeams && numberGoalsAllTeams < goals.length
    const goalsToShow = needLimitGoals ? goals.slice(0, numberGoalsAllTeams) : goals

    return (
        <>
            {assigneeId !== currentUserId && (
                <GoalsUserGroupHeader projectId={projectId} navigateToSection={navigateToSection} userId={assigneeId} />
            )}
            {activeDragGoalMode ? (
                <GoalListDroppable
                    key={assigneeId}
                    projectId={projectId}
                    milestoneId={milestoneId}
                    goalsList={goalsToShow}
                    userId={assigneeId}
                    milestoneGoals={milestoneGoals}
                />
            ) : (
                <GoalsList
                    projectId={projectId}
                    milestoneId={milestoneId}
                    setDismissibleRefs={setDismissibleRefs}
                    openEdition={openEdition}
                    closeEdition={closeEdition}
                    inDoneMilestone={inDoneMilestone}
                    assigneeId={assigneeId}
                    goals={goalsToShow}
                />
            )}
            {((inAllProjects && needLimitGoals) ||
                (assigneeId !== currentUserId && !TasksHelper.getContactInProject(projectId, assigneeId))) && (
                <ShowMoreButton expand={navigateToSection} style={{ marginBottom: 0 }} />
            )}
        </>
    )
}
