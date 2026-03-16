import React, { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector, shallowEqual } from 'react-redux'

import GoalsBacklog from './GoalsBacklog'
import MilestoneItem from './MilestoneItem'
import ProjectHeader from '../TaskListView/Header/ProjectHeader'
import { BACKLOG_MILESTONE_ID, filterMilestonesAndGoalsInCurrentUser, GOALS_OPEN_TAB_INDEX } from './GoalsHelper'
import ShowMoreButton from '../UIControls/ShowMoreButton'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import {
    hideFloatPopup,
    hideWebSideBar,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    switchProject,
    storeCurrentUser,
    setGoalsShowMoreExpanded,
    setBoardMilestonesInProject,
    setBoardGoalsByMilestoneInProject,
    setOpenGoalsAmount,
    setDoneGoalsAmount,
    setBoardNeedShowMoreInProject,
} from '../../redux/actions'
import { DV_TAB_ROOT_GOALS } from '../../utils/TabNavigationConstants'
import ProjectHelper, { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../redux/store'
import EmptyGoalsSelectedProject from './EmptyGoalsSelectedProject'
import { BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'
import AddGoals from './AddGoals'
import { allGoals } from '../AllSections/allSectionHelper'
import useShowNewCommentsBubbleInBoard from '../../hooks/Chats/useShowNewCommentsBubbleInBoard'
import MilestonesListEmptyProject from './MilestonesListEmptyProject'

export default function MilestonesListByProject({
    projectIndex,
    projectId,
    milestones,
    goalsActiveTab,
    firstMilestoneId,
    setDismissibleRefs,
    unsetDismissibleRefs,
    closeEdition,
    openEdition,
    canShowProject,
}) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const numberGoalsAllTeams = useSelector(state => state.loggedUser.numberGoalsAllTeams)
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const goalsShowMoreExpanded = useSelector(state => state.goalsShowMoreExpanded)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const userWorkstreamsIdsInProject = useSelector(
        state => (state.currentUser.workstreams ? state.currentUser.workstreams[projectId] : null),
        shallowEqual
    )

    const goals = useSelector(state => state.goalsByProject[projectId])
    const openMilestones = useSelector(state => state.openMilestonesByProject[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProject[projectId])
    const boardNeedShowMore = useSelector(state => state.boardNeedShowMoreByProject[projectId])
    const { showFollowedBubble, showUnfollowedBubble } = useShowNewCommentsBubbleInBoard(projectId)

    const navigatingToProjectAndExpandingGoals = useRef(false)

    const backlogId = `${BACKLOG_MILESTONE_ID}${projectId}`
    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    useEffect(() => {
        if (currentUserId) {
            filterMilestonesAndGoalsInCurrentUser(
                inAllProjects,
                numberGoalsAllTeams,
                projectId,
                openMilestones || [],
                doneMilestones || [],
                goals || []
            )
            return () => {
                dispatch([
                    setBoardMilestonesInProject(projectId, null),
                    setBoardGoalsByMilestoneInProject(projectId, null),
                    setBoardNeedShowMoreInProject(projectId, null),
                    setOpenGoalsAmount(projectId, null),
                    setDoneGoalsAmount(projectId, null),
                ])
            }
        }
    }, [
        userWorkstreamsIdsInProject,
        currentUserId,
        goalsShowMoreExpanded,
        goalsActiveTab,
        goals,
        openMilestones,
        doneMilestones,
        inAllProjects,
        numberGoalsAllTeams,
    ])

    useEffect(() => {
        return () => {
            if (!navigatingToProjectAndExpandingGoals.current) dispatch(setGoalsShowMoreExpanded(false))
        }
    }, [])

    const contractMilestones = () => {
        dispatch(setGoalsShowMoreExpanded(false))
    }

    const expandMilestones = () => {
        if (inAllProjects) {
            const { loggedUser } = store.getState()

            const isGuide = ProjectHelper.checkIfProjectIsGuide(selectedProjectIndex)

            let newCurrentUser = loggedUser
            if (!isGuide) newCurrentUser = allGoals

            navigatingToProjectAndExpandingGoals.current = true
            const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
            dismissAllPopups(true, true, true)
            const actionsToDispatch = [
                hideFloatPopup(),
                setSelectedSidebarTab(DV_TAB_ROOT_GOALS),
                switchProject(projectIndex),
                setSelectedTypeOfProject(projectType),
                storeCurrentUser(newCurrentUser),
                setGoalsShowMoreExpanded(true),
            ]

            if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())

            dispatch(actionsToDispatch)
        } else {
            dispatch(setGoalsShowMoreExpanded(true))
        }
    }

    const loggedUserIsBoardOwner = loggedUserId === currentUserId
    const loggedUserCanUpdateObject =
        loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)
    const inOpenTab = goalsActiveTab === GOALS_OPEN_TAB_INDEX

    return canShowProject ? (
        <View>
            <ProjectHeader projectIndex={project.index} projectId={project.id} showAddGoal={inOpenTab} />
            {loggedUserCanUpdateObject && inOpenTab && !isAnonymous && milestones.length === 0 && (
                <AddGoals
                    projectId={projectId}
                    setDismissibleRefs={setDismissibleRefs}
                    openEdition={openEdition}
                    closeEdition={closeEdition}
                    milestoneId={backlogId}
                    milestoneDate={BACKLOG_DATE_NUMERIC}
                    refId={`MainAdd${backlogId}_backlog`}
                />
            )}
            {milestones.map((milestone, index) => {
                let previousMilestoneDate
                if (inOpenTab) {
                    previousMilestoneDate = index === 0 ? 0 : milestones[index - 1].date
                } else {
                    const lastIndex = milestones.length - 1
                    previousMilestoneDate = index === lastIndex ? 0 : milestones[index + 1].date
                }
                const isActiveMilestone = index === 0 && inOpenTab
                return milestone.date === BACKLOG_DATE_NUMERIC ? (
                    <GoalsBacklog
                        key={'milestone_backlog'}
                        projectId={projectId}
                        projectIndex={projectIndex}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        milestoneId={backlogId}
                        previousMilestoneDate={previousMilestoneDate}
                    />
                ) : (
                    <MilestoneItem
                        key={milestone.id}
                        projectId={projectId}
                        milestone={milestone}
                        setDismissibleRefs={setDismissibleRefs}
                        unsetDismissibleRefs={unsetDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        firstMilestoneId={firstMilestoneId}
                        previousMilestoneDate={previousMilestoneDate}
                        isActiveMilestone={isActiveMilestone}
                    />
                )
            })}

            {boardNeedShowMore && (
                <ShowMoreButton
                    expandText="later goals"
                    contractText="hide later goals"
                    expanded={goalsShowMoreExpanded}
                    contract={contractMilestones}
                    expand={expandMilestones}
                    style={{
                        marginTop:
                            milestones.length > 0 && milestones[milestones.length - 1].date === BACKLOG_DATE_NUMERIC
                                ? 0
                                : -24,
                        marginBottom: 24,
                    }}
                />
            )}
            {!inAllProjects && milestones.length === 0 && <EmptyGoalsSelectedProject />}
        </View>
    ) : showFollowedBubble || showUnfollowedBubble ? (
        <MilestonesListEmptyProject
            projectId={projectId}
            projectIndex={projectIndex}
            setDismissibleRefs={setDismissibleRefs}
            closeEdition={closeEdition}
            openEdition={openEdition}
            backlogId={backlogId}
            goalsActiveTab={goalsActiveTab}
        />
    ) : null
}
