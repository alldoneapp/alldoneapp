import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import MentionProjectHeader from './MentionProjectHeader'
import MentionsItems from './MentionsItems'

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
            {showHeader && <MentionProjectHeader project={project} amount={items.length} />}
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
    showCurrentProjectHeader = true,
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

                return (
                    <ItemsByProject
                        key={pId}
                        project={project}
                        items={projectItems}
                        selectItemToMention={selectItemToMention}
                        activeItemIndex={activeIndexByProject[pId]}
                        itemsComponentsRefs={itemsComponentsRefs}
                        activeTab={activeTab}
                        showHeader={showCurrentProjectHeader || pId !== currentProjectId}
                    />
                )
            })}
        </View>
    )
}
