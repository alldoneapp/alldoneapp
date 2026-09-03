import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import MentionsItems from './MentionsItems'
import ColoredCircleSmall from '../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import styles, { colors } from '../../../styles/global'

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

function ItemsByProject({
    project,
    items,
    selectItemToMention,
    activeItemIndex,
    itemsComponentsRefs,
    activeTab,
    showHeader,
}) {
    if (items.length === 0) return null

    return (
        <View>
            {showHeader && <ProjectHeader project={project} amount={items.length} />}
            <MentionsItems
                selectItemToMention={selectItemToMention}
                items={items}
                activeItemIndex={activeItemIndex}
                itemsComponentsRefs={itemsComponentsRefs}
                projectId={project.id}
                activeTab={activeTab}
            />
        </View>
    )
}

export default function MentionsItemsGrouped({
    currentProjectId,
    items,
    selectItemToMention,
    activeItemIndex,
    itemsComponentsRefs,
    activeTab,
}) {
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)

    // Group items by project, with current project first
    const groupedItems = {}

    items.forEach(item => {
        const pId = item.projectId
        if (!groupedItems[pId]) {
            groupedItems[pId] = []
        }
        groupedItems[pId].push(item)
    })

    const projectIds = Object.keys(groupedItems)

    const currentProjectItems = groupedItems[currentProjectId] || []
    const otherProjectIds = projectIds.filter(pId => pId !== currentProjectId)

    // Sort other projects by their index
    otherProjectIds.sort((a, b) => {
        const projectA = loggedUserProjectsMap[a]
        const projectB = loggedUserProjectsMap[b]
        const indexA = projectA ? projectA.index : 999
        const indexB = projectB ? projectB.index : 999
        return indexA - indexB
    })

    // Build ordered list: current project first (if has items), then others
    const orderedProjectIds = []
    if (currentProjectItems.length > 0) {
        orderedProjectIds.push(currentProjectId)
    }
    orderedProjectIds.push(...otherProjectIds)

    // Calculate active index for each project
    let runningIndex = 0
    const activeIndexByProject = {}
    orderedProjectIds.forEach(pId => {
        const projectItems = groupedItems[pId] || []
        const endIndex = runningIndex + projectItems.length - 1
        if (activeItemIndex >= runningIndex && activeItemIndex <= endIndex) {
            activeIndexByProject[pId] = activeItemIndex - runningIndex
        } else {
            activeIndexByProject[pId] = -1
        }
        runningIndex += projectItems.length
    })

    return (
        <View>
            {orderedProjectIds.map(pId => {
                const project = loggedUserProjectsMap[pId]
                if (!project) return null
                const projectItems = groupedItems[pId] || []
                if (projectItems.length === 0) return null

                // Show header for items from other projects (not the current project)
                const isOtherProject = pId !== currentProjectId

                return (
                    <ItemsByProject
                        key={pId}
                        project={project}
                        items={projectItems}
                        selectItemToMention={selectItemToMention}
                        activeItemIndex={activeIndexByProject[pId]}
                        itemsComponentsRefs={itemsComponentsRefs}
                        activeTab={activeTab}
                        showHeader={isOtherProject}
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
