import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { orderBy, sortBy } from 'lodash'
import { useSelector, useDispatch } from 'react-redux'

import ContactsHeader from './ContactsHeader'
import ContactListByProject from './ContactListByProject'
import { ALL_PROJECTS_INDEX, checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import URLsPeople, {
    URL_ALL_PROJECTS_PEOPLE_ALL,
    URL_ALL_PROJECTS_PEOPLE_FOLLOWED,
    URL_PROJECT_PEOPLE_ALL,
    URL_PROJECT_PEOPLE_FOLLOWED,
} from '../../URLSystem/People/URLsPeople'
import { setNavigationRoute } from '../../redux/actions'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import { DV_TAB_ROOT_CONTACTS } from '../../utils/TabNavigationConstants'
import NothingToShow from '../UIComponents/NothingToShow'
import HashtagFiltersView from '../HashtagFilters/HashtagFiltersView'
import ContactStatusFiltersView from '../ContactStatusFilters/ContactStatusFiltersView'
import AllProjectsLine from '../TaskListView/Header/AllProjectsLine/AllProjectsLine'
import { watchFollowedPeople } from '../../utils/backends/Contacts/followedPeopleFirestore'
import { createFollowedPeopleBatcher, getProjectsForFollowedPeopleWatch } from './followedPeopleBatcher'
import { buildContactsViewData } from './contactsViewData'
import { getProjectsForContactsView } from './contactsViewProjectScope'
import { useProjectsData } from '../../hooks/useProjectData'
import { PROJECT_DATA_CONTACTS } from '../../utils/InitialLoad/projectDataLoader'

export default function ContactsView() {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const contactsActiveTab = useSelector(state => state.contactsActiveTab)
    const selectedTypeOfProject = useSelector(state => state.selectedTypeOfProject)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const projectUsers = useSelector(state => state.projectUsers)
    const projectContacts = useSelector(state => state.projectContacts)
    const [followedPeopleByProject, setFollowedPeopleByProject] = useState({})

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const projectsForContactsView = useMemo(
        () => getProjectsForContactsView(inAllProjects, loggedUserProjects, loggedUser),
        [inAllProjects, loggedUserProjects, loggedUser]
    )

    // AT-2386: this is THE view that enumerates contacts across projects, so it is the one place
    // that has to ask for all of them up front - a lookup-miss heal cannot help a list that is
    // built by iterating whatever happens to be in redux. Scope is already narrowed for us:
    // `getProjectsForContactsView` returns `getActiveProjects2(...)` in all-projects mode, so
    // guides, templates and archived projects are not pulled in by opening this board.
    const contactsViewProjectIds = useMemo(
        () => projectsForContactsView.map(project => project.id),
        [projectsForContactsView]
    )
    useProjectsData(contactsViewProjectIds, PROJECT_DATA_CONTACTS)

    const writeBrowserURL = () => {
        if (inAllProjects) {
            URLsPeople.push(
                contactsActiveTab === ALL_TAB ? URL_ALL_PROJECTS_PEOPLE_ALL : URL_ALL_PROJECTS_PEOPLE_FOLLOWED
            )
        } else {
            const project = loggedUserProjects[selectedProjectIndex]
            URLsPeople.push(
                contactsActiveTab === ALL_TAB ? URL_PROJECT_PEOPLE_ALL : URL_PROJECT_PEOPLE_FOLLOWED,
                { projectId: project.id, userId: loggedUser.uid },
                project.id,
                loggedUser.uid
            )
        }
    }

    const { filteredProjectsUsers, filteredProjectsContacts, amounts } = useMemo(
        () =>
            buildContactsViewData({
                loggedUser,
                loggedUserProjects: projectsForContactsView,
                projectUsers,
                projectContacts,
                followedPeopleByProject,
                selectedTypeOfProject,
                selectedProjectIndex,
                contactsActiveTab,
                inAllProjects,
            }),
        [
            loggedUser,
            projectsForContactsView,
            projectUsers,
            projectContacts,
            followedPeopleByProject,
            selectedTypeOfProject,
            selectedProjectIndex,
            contactsActiveTab,
            inAllProjects,
        ]
    )

    useEffect(() => {
        dispatch(setNavigationRoute(DV_TAB_ROOT_CONTACTS))
    }, [])

    const projectIdsKey = projectsForContactsView.map(project => project.id).join('|')

    useEffect(() => {
        const projects = getProjectsForFollowedPeopleWatch(
            contactsActiveTab === FOLLOWED_TAB,
            selectedProjectIndex,
            projectsForContactsView
        )
        if (projects.length === 0) return

        const batcher = createFollowedPeopleBatcher(updates => {
            setFollowedPeopleByProject(current => ({ ...current, ...updates }))
        })
        const unsubscribes = projects.map(project =>
            watchFollowedPeople(project.id, loggedUser.uid, (projectId, followedPeople) => {
                batcher.add(projectId, followedPeople)
            })
        )

        return () => {
            batcher.cancel()
            unsubscribes.forEach(unsubscribe => unsubscribe())
        }
    }, [contactsActiveTab, loggedUser.uid, projectIdsKey, selectedProjectIndex])

    useEffect(() => {
        writeBrowserURL()
    }, [contactsActiveTab, selectedProjectIndex])

    const project = inAllProjects ? ALL_PROJECTS_INDEX : loggedUserProjects[selectedProjectIndex]

    const sortedLoggedUserProjects = useMemo(() => {
        const normalProjects = projectsForContactsView.filter(project => !project.parentTemplateId)
        const guides = projectsForContactsView.filter(project => !!project.parentTemplateId)
        const getLastEditedContactDate = projectId => {
            const contacts = projectContacts[projectId] || []
            return contacts.reduce((maxDate, contact) => Math.max(maxDate, contact?.lastEditionDate || 0), 0)
        }
        const sortProjects = projects =>
            orderBy(
                sortBy(projects, [project => project.name.toLowerCase()]),
                [project => getLastEditedContactDate(project.id)],
                ['desc']
            )

        return [...sortProjects(normalProjects), ...sortProjects(guides)]
    }, [projectsForContactsView, projectContacts])

    const contactsAmount = amounts.users + amounts.contacts
    const followedContactsAmount = amounts.followedUsers + amounts.followedContacts

    return (
        <View
            style={[
                localStyles.container,
                inAllProjects && localStyles.containerSpace,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            {inAllProjects && <AllProjectsLine showActions={false} />}
            {inAllProjects && (
                <ContactsHeader
                    contactAmount={contactsActiveTab === FOLLOWED_TAB ? followedContactsAmount : contactsAmount}
                />
            )}
            {inAllProjects && <ContactStatusFiltersView projectContacts={projectContacts} />}

            <HashtagFiltersView />

            {contactsAmount > 0 ? (
                inAllProjects ? (
                    sortedLoggedUserProjects.map((project, index) => {
                        if (filteredProjectsUsers[project.id]) {
                            return (
                                <ContactListByProject
                                    key={project.index}
                                    projectIndex={project.index}
                                    members={filteredProjectsUsers[project.id]}
                                    contacts={filteredProjectsContacts[project.id]}
                                    onlyMembers={false}
                                    firstProject={index === 0}
                                    maxContactsToRender={3}
                                />
                            )
                        }
                    })
                ) : (
                    <ContactListByProject
                        projectIndex={selectedProjectIndex}
                        members={filteredProjectsUsers[project.id]}
                        contacts={filteredProjectsContacts[project.id]}
                        onlyMembers={false}
                        maxContactsToRender={10}
                    />
                )
            ) : (
                <NothingToShow />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginHorizontal: 104,
    },
    containerSpace: {
        marginBottom: 32,
    },
    containerMobile: {
        marginHorizontal: 16,
    },
    containerTablet: {
        marginHorizontal: 56,
    },
})
