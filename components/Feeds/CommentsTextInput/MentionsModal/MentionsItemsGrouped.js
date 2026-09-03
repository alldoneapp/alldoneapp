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

    // Group items by project, with current project first.
    //
    // AT-2497 — this GROUPS, it does not REORDER. `items` arrives already ordered: the
    // engine sorts notes by `lastEditionDate:desc` and the modal puts the current project
    // in front, so "the most recent notes" is a property of the list handed in here.
    // Sorting the other projects by their sidebar `index` instead threw that away — with
    // three projects interleaved in the page, the single most recently edited note rendered
    // EIGHTH, under a project header, because its project happened to sit third in the
    // sidebar. Project order now follows first appearance, so reading the list top to
    // bottom is reading it newest first.
    const groupedItems = {}
    const projectIdsInOrder = []

    items.forEach(item => {
        const pId = item.projectId
        if (!groupedItems[pId]) {
            groupedItems[pId] = []
            projectIdsInOrder.push(pId)
        }
        groupedItems[pId].push(item)
    })

    const currentProjectItems = groupedItems[currentProjectId] || []
    const otherProjectIds = projectIdsInOrder.filter(pId => pId !== currentProjectId)

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
