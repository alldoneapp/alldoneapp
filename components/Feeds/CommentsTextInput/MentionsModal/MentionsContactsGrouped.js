import React, { useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import MentionsContacts from './MentionsContacts'
import ColoredCircleSmall from '../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import styles, { colors } from '../../../styles/global'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { MENTION_MODAL_CONTACTS_TAB } from '../textInputHelper'

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

function ContactsByProject({ project, contacts, selectUserToMention, activeUserIndex, usersComponentsRefs }) {
    if (contacts.length === 0) return null

    return (
        <View>
            <ProjectHeader project={project} amount={contacts.length} />
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
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)

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

    // If only one project has contacts, don't show headers
    const showHeaders = orderedProjectIds.length > 1

    if (!showHeaders) {
        return (
            <MentionsContacts
                projectId={currentProjectId}
                selectUserToMention={selectUserToMention}
                users={contacts}
                activeUserIndex={activeUserIndex}
                usersComponentsRefs={usersComponentsRefs}
            />
        )
    }

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
