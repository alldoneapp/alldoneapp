import React, { useState, useEffect, useRef } from 'react'
import { StyleSheet } from 'react-native'
import { View } from 'react-native'
import { useSelector } from 'react-redux'
import { sortBy } from 'lodash'
import v4 from 'uuid/v4'

import { DV_TAB_ROOT_GOALS } from '../../../../utils/TabNavigationConstants'
import UserItem from '../../Items/UserItem'
import ShowMoreButton from '../../../UIControls/ShowMoreButton'
import WorkstreamItem from '../../Items/WorkstreamItem'
import { WORKSTREAM_ID_PREFIX } from '../../../Workstreams/WorkstreamHelper'
import { getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import ProjectHelper, { checkIfSelectedProject } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import Backend from '../../../../utils/BackendBridge'
import { ALL_GOALS_ID, allGoals } from '../../../AllSections/allSectionHelper'
import AllGoalsItem from '../../Items/AllGoalsItem'
import { ALL_USERS } from '../../../GoalsView/GoalsHelper'

export default function GoalsBoards({ projectId, projectColor, projectIndex, projectType, isShared, selected }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const numberUsersSidebar = useSelector(state => state.loggedUser.numberUsersSidebar)
    const currentUserId = useSelector(state => state.currentUser.uid)

    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const workstreamsInProject = useSelector(state => state.projectWorkstreams[projectId])

    const isGuide = !!ProjectHelper.getProjectById(projectId).parentTemplateId

    const projectItems = isGuide ? usersInProject : usersInProject.concat(workstreamsInProject)
    if (!isGuide) projectItems.push(allGoals)

    const users = sortBy(projectItems, [
        user => user.uid !== ALL_GOALS_ID,
        user => (user.lastVisitBoardInGoals?.[projectId]?.[loggedUserId] || 0) * -1,
    ])

    let numberOfUsersToShow =
        numberUsersSidebar >= users.length || numberUsersSidebar === 0 ? users.length : numberUsersSidebar

    const [pressedShowMore, setPressedShowMore] = useState(false)
    const [goalsDate, setGoalsDate] = useState({ start: null, end: null })
    const [milestones, setMilestones] = useState([])
    const [goalsFilteredByMilestone, setGoalsFilteredByMilestone] = useState([])
    const goalsRef = useRef([])

    const theme = getTheme(
        Themes,
        themeName,
        'CustomSideMenu.ProjectList.ProjectItem.ProjectSectionList.ProjectSectionItem'
    )

    const currentUserIndex = users.findIndex(user => user.uid === currentUserId)

    const contractGoals = e => {
        e?.preventDefault()
        setPressedShowMore(false)
    }
    const expandGoals = e => {
        e?.preventDefault()
        setPressedShowMore(true)
    }

    const getActiveMilestoneAndGoalsInWorkstream = () => {
        const activeMilestoneData = { milestone: null, goals: [] }
        for (let i = 0; i < goalsFilteredByMilestone.length; i++) {
            const { milestone, goals } = goalsFilteredByMilestone[i]
            if (goals.length > 0) {
                activeMilestoneData.goals = goals
                activeMilestoneData.milestone = milestone
                break
            }
        }
        return activeMilestoneData
    }

    const filterGoalsByMilestone = (milestones, goals) => {
        if (milestones.length && goals.length) {
            const goalsFilteredByMilestone = []
            milestones.forEach(milestone => {
                const { date } = milestone
                goalsFilteredByMilestone.push({ milestone, goals: [] })
                goals.forEach(goal => {
                    const { completionMilestoneDate, startingMilestoneDate } = goal
                    if (startingMilestoneDate <= date && completionMilestoneDate >= date) {
                        goalsFilteredByMilestone[goalsFilteredByMilestone.length - 1].goals.push(goal)
                    }
                })
            })
            setGoalsFilteredByMilestone(goalsFilteredByMilestone)
        } else {
            setGoalsFilteredByMilestone([])
        }
    }

    const updateGoals = goals => {
        goalsRef.current = goals
        filterGoalsByMilestone(milestones, goals)
    }

    useEffect(() => {
        const { start, end } = goalsDate
        if (start && end) {
            const watcherKey = v4()
            Backend.watchGoalsInDateRange(projectId, start, end, watcherKey, updateGoals, ALL_USERS)
            return () => {
                Backend.unwatch(watcherKey)
                updateGoals([])
            }
        }
    }, [goalsDate.start, goalsDate.end])

    const updateMilestones = (projectId, milestones) => {
        const goalsDate = milestones.length
            ? { start: milestones[0].date, end: milestones[milestones.length - 1].date }
            : { start: null, end: null }
        setMilestones(milestones)
        setGoalsDate(goalsDate)
        filterGoalsByMilestone(milestones, goalsRef.current)
    }

    useEffect(() => {
        if (selected && checkIfSelectedProject(selectedProjectIndex)) {
            const watcherKey = v4()
            Backend.watchMilestones(projectId, updateMilestones, false, watcherKey, ALL_USERS)
            return () => {
                Backend.unwatch(watcherKey)
                updateMilestones(null, [])
            }
        }
    }, [selectedProjectIndex, selected])

    return (
        <View style={[localStyles.userList, theme.userList(projectColor)]}>
            {users.length > 0 &&
                users.map((item, index) => {
                    const shortcut =
                        !isShared && users.length > 1
                            ? index === currentUserIndex - 1 || (index === users.length - 1 && currentUserIndex === 0)
                                ? '>'
                                : index === currentUserIndex + 1 ||
                                  (index === 0 && currentUserIndex === users.length - 1)
                                ? '<'
                                : null
                            : null
                    const isWorkstream = item.uid.startsWith(WORKSTREAM_ID_PREFIX)
                    const isAllGoalsSection = item.uid === ALL_GOALS_ID
                    const activeMilestoneData = isWorkstream
                        ? getActiveMilestoneAndGoalsInWorkstream()
                        : { milestone: null, goals: null }
                    return (
                        (pressedShowMore || index < numberOfUsersToShow) &&
                        (!isShared || item.uid === currentUserId) &&
                        (isAllGoalsSection ? (
                            <AllGoalsItem
                                key={item.uid}
                                section={item}
                                projectType={projectType}
                                projectColor={projectColor}
                                isShared={isShared}
                            />
                        ) : isWorkstream ? (
                            <WorkstreamItem
                                key={item.uid}
                                workstream={item}
                                projectType={projectType}
                                isShared={isShared}
                                shortcut={shortcut}
                                navItem={DV_TAB_ROOT_GOALS}
                                projectId={projectId}
                                projectColor={projectColor}
                                milestone={activeMilestoneData.milestone}
                                goals={activeMilestoneData.goals}
                            />
                        ) : (
                            <UserItem
                                key={item.uid}
                                user={item}
                                projectType={projectType}
                                isShared={isShared}
                                shortcut={shortcut}
                                navItem={DV_TAB_ROOT_GOALS}
                                showIndicator={isGuide && loggedUserId === item.uid}
                                projectId={projectId}
                                projectColor={projectColor}
                                projectIndex={projectIndex}
                            />
                        ))
                    )
                })}

            {users.length > numberOfUsersToShow && (
                <View style={theme.showMore(projectColor)}>
                    <ShowMoreButton
                        expanded={pressedShowMore}
                        contract={contractGoals}
                        expand={expandGoals}
                        style={{ opacity: 0.48 }}
                    />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    userList: {
        borderTopWidth: 2,
        borderBottomWidth: 2,
    },
})
