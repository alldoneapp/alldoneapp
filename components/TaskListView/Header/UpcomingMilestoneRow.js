import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import MilestonePresentation from '../../GoalsView/MilestonePresentation'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { setSelectedSidebarTab, switchProject } from '../../../redux/actions'
import { DV_TAB_ROOT_GOALS } from '../../../utils/TabNavigationConstants'

export default function UpcomingMilestoneRow({ projectId }) {
    // Call all hooks unconditionally to preserve hook order between renders
    const dispatch = useDispatch()
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const projectIndex = useSelector(state => state.loggedUserProjectsMap[projectId]?.index)

    const nextUpcoming = useMemo(() => {
        if (!openMilestones || openMilestones.length === 0) return null
        // openMilestones are ordered asc by date; show the first defined milestone regardless of past/future
        return openMilestones[0] || null
    }, [openMilestones])

    const goals = useMemo(() => {
        if (!goalsById || !nextUpcoming) return []
        const milestoneDate = nextUpcoming.date
        return Object.values(goalsById).filter(goal => {
            const start = goal.startingMilestoneDate
            const end = goal.completionMilestoneDate
            return start <= milestoneDate && milestoneDate <= end
        })
    }, [goalsById, nextUpcoming])

    const previousMilestoneDate = useMemo(() => {
        if (!openMilestones || !nextUpcoming) return 0
        const idx = openMilestones.findIndex(m => m.id === nextUpcoming.id)
        return idx > 0 ? openMilestones[idx - 1].date : 0
    }, [openMilestones, nextUpcoming])

    const firstMilestoneId = useMemo(() => (openMilestones && openMilestones[0] ? openMilestones[0].id : null), [
        openMilestones,
    ])

    const loggedUserIsBoardOwner = loggedUserId === currentUserId
    const loggedUserCanUpdateObject =
        loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    if (!nextUpcoming || !usersInProject) return null

    const goToGoalsTab = () => {
        if (typeof projectIndex === 'number') {
            dispatch([switchProject(projectIndex), setSelectedSidebarTab(DV_TAB_ROOT_GOALS)])
        } else {
            dispatch(setSelectedSidebarTab(DV_TAB_ROOT_GOALS))
        }
    }

    return (
        <View style={{ paddingBottom: 8 }}>
            <MilestonePresentation
                onPress={goToGoalsTab}
                milestone={nextUpcoming}
                projectId={projectId}
                goals={goals}
                firstMilestoneId={firstMilestoneId}
                previousMilestoneDate={previousMilestoneDate}
                isActiveMilestone={false}
                loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                hideMoreButton={true}
            />
        </View>
    )
}
