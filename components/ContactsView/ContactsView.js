import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { orderBy, sortBy } from 'lodash'
import { useSelector, useDispatch } from 'react-redux'

import store from '../../redux/store'
import ContactsHeader from './ContactsHeader'
import ContactListByProject from './ContactListByProject'
import ProjectHelper, {
    ALL_PROJECTS_INDEX,
    checkIfSelectedAllProjects,
} from '../SettingsView/ProjectsSettings/ProjectHelper'
import URLsPeople, {
    URL_ALL_PROJECTS_PEOPLE_ALL,
    URL_ALL_PROJECTS_PEOPLE_FOLLOWED,
    URL_PROJECT_PEOPLE_ALL,
    URL_PROJECT_PEOPLE_FOLLOWED,
} from '../../URLSystem/People/URLsPeople'
import MultiToggleSwitch from '../UIControls/MultiToggleSwitch/MultiToggleSwitch'
import { setNavigationRoute, updateContactsActiveTab } from '../../redux/actions'
import { FOLLOWER_CONTACTS_TYPE, FOLLOWER_USERS_TYPE } from '../Followers/FollowerConstants'
import Backend from '../../utils/BackendBridge'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import { DV_TAB_ROOT_CONTACTS } from '../../utils/TabNavigationConstants'
import ContactsHelper from './Utils/ContactsHelper'
import NothingToShow from '../UIComponents/NothingToShow'
import HashtagFiltersView from '../HashtagFilters/HashtagFiltersView'
import { PROJECT_TYPE_GUIDE } from '../SettingsView/ProjectsSettings/ProjectsSettings'

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
    const [followedUsers, setFollowedUsers] = useState([])
    const [followedContacts, setFollowedContacts] = useState([])
    const [filteredProjectsUsers, setFilteredProjectsUsers] = useState([])
    const [filteredProjectsContacts, setFilteredProjectsContacts] = useState({})
    const [amounts, setAmounts] = useState({
        users: 0,
        contacts: 0,
        followedUsers: 0,
        followedContacts: 0,
    })

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

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

    const watchContacts = () => {
        if (selectedProjectIndex >= 0) {
            const project = loggedUserProjects[selectedProjectIndex]
            Backend.watchFollowedUsers(project.id, loggedUser.uid, (projectId, users) => {
                setFollowedUsers(followedUsers => {
                    return { ...followedUsers, [selectedProjectIndex]: Object.keys(users) }
                })
            })
            Backend.watchFollowedContacts(project.id, loggedUser.uid, (projectId, contacts) => {
                setFollowedContacts(followedContacts => {
                    return { ...followedContacts, [selectedProjectIndex]: Object.keys(contacts) }
                })
            })
        } else {
            for (let i = 0; i < loggedUserProjects.length; i++) {
                const project = loggedUserProjects[i]
                Backend.watchFollowedUsers(project.id, loggedUser.uid, (projectId, users) => {
                    setFollowedUsers(followedUsers => {
                        return { ...followedUsers, [i]: Object.keys(users) }
                    })
                })
                Backend.watchFollowedContacts(project.id, loggedUser.uid, (projectId, contacts) => {
                    setFollowedContacts(followedContacts => {
                        return { ...followedContacts, [i]: Object.keys(contacts) }
                    })
                })
            }
        }
    }

    const unwatchContacts = () => {
        const projects = selectedProjectIndex >= 0 ? [loggedUserProjects[selectedProjectIndex]] : loggedUserProjects
        for (let i = 0; i < projects.length; i++) {
            const project = projects[i]
            Backend.unwatchFollowedUsers(project.id, loggedUser.uid)
            Backend.unwatchFollowedContacts(project.id, loggedUser.uid)
        }
    }

    const filterUsers = () => {
        let filteredUsers = {}
        let filteredContacts = {}

        let amounts = {
            users: 0,
            contacts: 0,
            followedUsers: 0,
            followedContacts: 0,
        }

        const countByFollowed = (type = FOLLOWER_USERS_TYPE, pIndex, users) => {
            const followedList = type === FOLLOWER_USERS_TYPE ? followedUsers : followedContacts
            const list = users.filter(
                user => followedList[pIndex]?.includes(user.uid) && !ContactsHelper.isPrivateContact(user)
            )
            return list.length
        }

        const countBy = users => {
            const list = users.filter(user => !ContactsHelper.isPrivateContact(user))
            return list.length
        }

        for (let pIdx = 0; pIdx < loggedUserProjects.length; pIdx++) {
            const project = loggedUserProjects[pIdx]
            if (
                project &&
                (ProjectHelper.getTypeOfProject(loggedUser, project.id) === selectedTypeOfProject ||
                    (inAllProjects && ProjectHelper.getTypeOfProject(loggedUser, project.id) === PROJECT_TYPE_GUIDE))
            ) {
                filteredUsers[project.id] = projectUsers[project.id]
                filteredContacts[project.id] = projectContacts[project.id]

                amounts.users +=
                    (selectedProjectIndex < 0 || selectedProjectIndex === pIdx) && filteredUsers[project.id]
                        ? countBy(filteredUsers[project.id])
                        : 0
                amounts.contacts +=
                    (selectedProjectIndex < 0 || selectedProjectIndex === pIdx) && filteredContacts[project.id]
                        ? countBy(filteredContacts[project.id])
                        : 0

                amounts.followedUsers +=
                    (selectedProjectIndex < 0 || selectedProjectIndex === pIdx) && filteredUsers[project.id]
                        ? countByFollowed(FOLLOWER_USERS_TYPE, pIdx, filteredUsers[project.id])
                        : 0
                amounts.followedContacts +=
                    (selectedProjectIndex < 0 || selectedProjectIndex === pIdx) && filteredContacts[project.id]
                        ? countByFollowed(FOLLOWER_CONTACTS_TYPE, pIdx, filteredContacts[project.id])
                        : 0

                if (contactsActiveTab === 0) {
                    filteredUsers[project.id] = filteredUsers[project.id].filter(user =>
                        followedUsers[pIdx]?.includes(user.uid)
                    )
                    filteredContacts[project.id] = filteredContacts[project.id].filter(contact =>
                        followedContacts[pIdx]?.includes(contact.uid)
                    )
                }
            } else {
                filteredUsers[project.id] = []
                filteredContacts[project.id] = []
            }
        }

        return { filteredProjectsUsers: filteredUsers, filteredProjectsContacts: filteredContacts, amounts: amounts }
    }

    useEffect(() => {
        const { filteredProjectsUsers, filteredProjectsContacts, amounts } = filterUsers()
        setFilteredProjectsUsers(filteredProjectsUsers)
        setFilteredProjectsContacts(filteredProjectsContacts)
        setAmounts(amounts)
    }, [
        followedUsers,
        followedContacts,
        loggedUserProjects,
        JSON.stringify(projectUsers), // Without the Stringify, the component does not detect the removed items
        JSON.stringify(projectContacts), // Without the Stringify, the component does not detect the removed items
        contactsActiveTab,
    ])

    useEffect(() => {
        dispatch(setNavigationRoute(DV_TAB_ROOT_CONTACTS))
    }, [])

    useEffect(() => {
        watchContacts()
        return () => {
            unwatchContacts()
        }
    }, [loggedUserProjects.length])

    useEffect(() => {
        writeBrowserURL()
    }, [contactsActiveTab, selectedProjectIndex])

    const project = inAllProjects ? ALL_PROJECTS_INDEX : loggedUserProjects[selectedProjectIndex]

    const normalProjects = loggedUserProjects.filter(project => !project.parentTemplateId)
    const guides = loggedUserProjects.filter(project => !!project.parentTemplateId)

    const sortedLoggedUserProjects = [
        ...orderBy(sortBy(normalProjects, [project => project.name.toLowerCase()]), 'lastUserInteractionDate', 'desc'),
        ...orderBy(sortBy(guides, [project => project.name.toLowerCase()]), 'lastUserInteractionDate', 'desc'),
    ]

    let contactsAmount = amounts.users + amounts.contacts
    let fContactsAmount = amounts.followedUsers + amounts.followedContacts

    return (
        <View
            style={[
                localStyles.container,
                inAllProjects && localStyles.containerSpace,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            <ContactsHeader
                contactAmount={contactsActiveTab === 0 ? fContactsAmount : contactsAmount}
                projectId={project?.id}
                selectedUser={loggedUser}
            />

            <View style={localStyles.toggleSwitch}>
                <MultiToggleSwitch
                    options={[
                        { icon: 'eye', text: 'Followed', badge: null },
                        { icon: 'users', text: 'All', badge: null },
                    ]}
                    currentIndex={contactsActiveTab}
                    onChangeOption={index => {
                        store.dispatch(updateContactsActiveTab(index === 0 ? FOLLOWED_TAB : ALL_TAB))
                    }}
                />
            </View>

            <HashtagFiltersView />

            {contactsAmount > 0 ? (
                inAllProjects ? (
                    sortedLoggedUserProjects.map((project, index) => {
                        if (filteredProjectsUsers[project.id]) {
                            const matchTypeOfProject =
                                ProjectHelper.getTypeOfProject(loggedUser, project.id) === selectedTypeOfProject ||
                                (inAllProjects &&
                                    ProjectHelper.getTypeOfProject(loggedUser, project.id) === PROJECT_TYPE_GUIDE)

                            return (
                                matchTypeOfProject && (
                                    <ContactListByProject
                                        key={project.index}
                                        projectIndex={project.index}
                                        projectId={project.id}
                                        members={filteredProjectsUsers[project.id]}
                                        contacts={filteredProjectsContacts[project.id]}
                                        onlyMembers={false}
                                        firstProject={index === 0}
                                        maxContactsToRender={3}
                                    />
                                )
                            )
                        }
                    })
                ) : (
                    <ContactListByProject
                        projectIndex={selectedProjectIndex}
                        projectId={project.id}
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
    toggleSwitch: {
        position: 'absolute',
        right: 0,
        top: 44,
        zIndex: 10,
    },
})
