import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import MentionProjectHeader from '../../../Feeds/CommentsTextInput/MentionsModal/MentionProjectHeader'
import MentionsItems from '../../../Feeds/CommentsTextInput/MentionsModal/MentionsItems'
import { MENTION_MODAL_GOALS_TAB } from '../../../Feeds/CommentsTextInput/textInputHelper'

function GoalsByProject({
    project,
    goals,
    selectItemToMention,
    activeItemIndex,
    itemsComponentsRefs,
    currentlyAssignedGoal,
    showHeader,
}) {
    if (goals.length === 0) return null

    return (
        <View>
            {showHeader && <MentionProjectHeader project={project} amount={goals.length} />}
            <MentionsItems
                selectItemToMention={selectItemToMention}
                items={goals}
                activeItemIndex={activeItemIndex}
                itemsComponentsRefs={itemsComponentsRefs}
                projectId={project.id}
                activeTab={MENTION_MODAL_GOALS_TAB}
                currentlyAssignedGoal={currentlyAssignedGoal}
            />
        </View>
    )
}

export default function MentionsGoalsGrouped({
    currentProjectId,
    goals,
    selectItemToMention,
    activeItemIndex,
    itemsComponentsRefs,
    currentlyAssignedGoal,
    showCurrentProjectHeader = true,
}) {
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)

    // Group goals by project, with current project first
    const groupedGoals = {}

    // Initialize groups
    goals.forEach(goal => {
        const pId = goal.projectId
        if (!groupedGoals[pId]) {
            groupedGoals[pId] = []
        }
        groupedGoals[pId].push(goal)
    })

    // Get sorted list of project IDs - current project first, then others sorted by project index
    const projectIds = Object.keys(groupedGoals)

    // Separate current project from others
    const currentProjectGoals = groupedGoals[currentProjectId] || []
    const otherProjectIds = projectIds.filter(pId => pId !== currentProjectId)

    // Sort other projects by their index
    otherProjectIds.sort((a, b) => {
        const projectA = loggedUserProjectsMap[a]
        const projectB = loggedUserProjectsMap[b]
        const indexA = projectA ? projectA.index : 999
        const indexB = projectB ? projectB.index : 999
        return indexA - indexB
    })

    // Build ordered list: current project first (if has goals), then others
    const orderedProjectIds = []
    if (currentProjectGoals.length > 0) {
        orderedProjectIds.push(currentProjectId)
    }
    orderedProjectIds.push(...otherProjectIds)

    // Calculate active index for each project
    let runningIndex = 0
    const activeIndexByProject = {}
    orderedProjectIds.forEach(pId => {
        const projectGoals = groupedGoals[pId] || []
        const endIndex = runningIndex + projectGoals.length - 1
        if (activeItemIndex >= runningIndex && activeItemIndex <= endIndex) {
            activeIndexByProject[pId] = activeItemIndex - runningIndex
        } else {
            activeIndexByProject[pId] = -1
        }
        runningIndex += projectGoals.length
    })

    return (
        <View>
            {orderedProjectIds.map(pId => {
                const project = loggedUserProjectsMap[pId]
                if (!project) return null
                const projectGoals = groupedGoals[pId] || []
                if (projectGoals.length === 0) return null

                return (
                    <GoalsByProject
                        key={pId}
                        project={project}
                        goals={projectGoals}
                        selectItemToMention={selectItemToMention}
                        activeItemIndex={activeIndexByProject[pId]}
                        itemsComponentsRefs={itemsComponentsRefs}
                        currentlyAssignedGoal={currentlyAssignedGoal}
                        showHeader={showCurrentProjectHeader || pId !== currentProjectId}
                    />
                )
            })}
        </View>
    )
}
