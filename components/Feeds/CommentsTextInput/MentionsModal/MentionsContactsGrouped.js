import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import MentionProjectHeader from './MentionProjectHeader'
import MentionsContacts from './MentionsContacts'

function ContactsByProject({ project, contacts, selectUserToMention, activeUserIndex, usersComponentsRefs }) {
    if (contacts.length === 0) return null

    return (
        <View>
            <MentionProjectHeader project={project} amount={contacts.length} />
            <MentionsContacts
                projectId={project.id}
                selectUserToMention={selectUserToMention}
                users={contacts}
                activeUserIndex={activeUserIndex}
                usersComponentsRefs={usersComponentsRefs}
            />
        </View>
    )
}

export default function MentionsContactsGrouped({
    currentProjectId,
    contacts,
    selectUserToMention,
    activeUserIndex,
    usersComponentsRefs,
}) {
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)

    // Group contacts by project, with current project first
    const groupedContacts = {}

    // Initialize groups
    contacts.forEach(contact => {
        const pId = contact.projectId
        if (!groupedContacts[pId]) {
            groupedContacts[pId] = []
        }
        groupedContacts[pId].push(contact)
    })

    // Get sorted list of project IDs - current project first, then others sorted by project index
    const projectIds = Object.keys(groupedContacts)

    // Separate current project from others
    const currentProjectContacts = groupedContacts[currentProjectId] || []
    const otherProjectIds = projectIds.filter(pId => pId !== currentProjectId)

    // Sort other projects by their index
    otherProjectIds.sort((a, b) => {
        const projectA = loggedUserProjectsMap[a]
        const projectB = loggedUserProjectsMap[b]
        const indexA = projectA ? projectA.index : 999
        const indexB = projectB ? projectB.index : 999
        return indexA - indexB
    })

    // Build ordered list: current project first (if has contacts), then others
    const orderedProjectIds = []
    if (currentProjectContacts.length > 0) {
        orderedProjectIds.push(currentProjectId)
    }
    orderedProjectIds.push(...otherProjectIds)

    // Calculate active index for each project
    let runningIndex = 0
    const activeIndexByProject = {}
    orderedProjectIds.forEach(pId => {
        const projectContacts = groupedContacts[pId] || []
        const endIndex = runningIndex + projectContacts.length - 1
        if (activeUserIndex >= runningIndex && activeUserIndex <= endIndex) {
            activeIndexByProject[pId] = activeUserIndex - runningIndex
        } else {
            activeIndexByProject[pId] = -1
        }
        runningIndex += projectContacts.length
    })

    return (
        <View>
            {orderedProjectIds.map(pId => {
                const project = loggedUserProjectsMap[pId]
                if (!project) return null
                const projectContacts = groupedContacts[pId] || []
                if (projectContacts.length === 0) return null

                return (
                    <ContactsByProject
                        key={pId}
                        project={project}
                        contacts={projectContacts}
                        selectUserToMention={selectUserToMention}
                        activeUserIndex={activeIndexByProject[pId]}
                        usersComponentsRefs={usersComponentsRefs}
                    />
                )
            })}
        </View>
    )
}
