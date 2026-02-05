import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import MentionsItems from '../../../Feeds/CommentsTextInput/MentionsModal/MentionsItems'
import ColoredCircleSmall from '../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import styles, { colors } from '../../../styles/global'
import { MENTION_MODAL_GOALS_TAB } from '../../../Feeds/CommentsTextInput/textInputHelper'

function ProjectHeader({ project, amount }) {
    return (
        <View style={localStyles.headerContainer}>
            <View style={localStyles.titleContainer}>
                {project.color ? (
                    <ColoredCircleSmall
                        size={16}
                        color={project.color}
                        isGuide={!!project.parentTemplateId}
                        containerStyle={{ marginHorizontal: 4 }}
                        projectId={project.id}
                    />
                ) : (
                    <View style={[localStyles.colorDot, { backgroundColor: colors.Text03 }]} />
                )}
                <Text style={localStyles.projectName} numberOfLines={1}>
                    {project.name}
                </Text>
                <Text style={localStyles.dot}>•</Text>
                <View style={localStyles.badge}>
                    <Text style={localStyles.badgeText}>{amount}</Text>
                </View>
            </View>
        </View>
    )
}

function GoalsByProject({
    project,
    goals,
    selectItemToMention,
    activeItemIndex,
    itemsComponentsRefs,
    currentlyAssignedGoal,
}) {
    if (goals.length === 0) return null

    return (
        <View>
            <ProjectHeader project={project} amount={goals.length} />
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

    // If only one project has goals, don't show headers
    const showHeaders = orderedProjectIds.length > 1

    if (!showHeaders) {
        return (
            <MentionsItems
                selectItemToMention={selectItemToMention}
                items={goals}
                activeItemIndex={activeItemIndex}
                itemsComponentsRefs={itemsComponentsRefs}
                projectId={currentProjectId}
                activeTab={MENTION_MODAL_GOALS_TAB}
                currentlyAssignedGoal={currentlyAssignedGoal}
            />
        )
    }

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
                    />
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    headerContainer: {
        height: 40,
        justifyContent: 'flex-end',
        paddingBottom: 4,
        borderBottomColor: colors.Grey400,
        borderBottomWidth: 1,
        marginTop: 8,
    },
    titleContainer: {
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexDirection: 'row',
    },
    colorDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
        marginHorizontal: 4,
    },
    projectName: {
        ...styles.subtitle2,
        paddingLeft: 8,
        color: '#ffffff',
        flex: 1,
    },
    dot: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginHorizontal: 6,
    },
    badge: {
        backgroundColor: colors.Primary200,
        borderRadius: 10,
        paddingHorizontal: 6,
        paddingVertical: 2,
        minWidth: 20,
        alignItems: 'center',
    },
    badgeText: {
        ...styles.caption2,
        color: colors.Text03,
    },
})
