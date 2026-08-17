import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_TYPE_GUIDE } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import { FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import ContactsHelper from './Utils/ContactsHelper'

const emptyFollowedPeople = { userIds: [], contactIds: [] }

export const buildContactsViewData = ({
    loggedUser,
    loggedUserProjects,
    projectUsers,
    projectContacts,
    followedPeopleByProject,
    selectedTypeOfProject,
    selectedProjectIndex,
    contactsActiveTab,
    inAllProjects,
}) => {
    const filteredProjectsUsers = {}
    const filteredProjectsContacts = {}
    const amounts = {
        users: 0,
        contacts: 0,
        followedUsers: 0,
        followedContacts: 0,
    }

    loggedUserProjects.forEach((project, projectIndex) => {
        if (!project) return

        const projectType = ProjectHelper.getTypeOfProject(loggedUser, project.id)
        const matchesProjectType =
            projectType === selectedTypeOfProject || (inAllProjects && projectType === PROJECT_TYPE_GUIDE)

        if (!matchesProjectType) {
            filteredProjectsUsers[project.id] = []
            filteredProjectsContacts[project.id] = []
            return
        }

        const users = projectUsers[project.id] || []
        const contacts = projectContacts[project.id] || []
        const followedPeople = followedPeopleByProject[project.id] || emptyFollowedPeople
        const inFollowedTab = contactsActiveTab === FOLLOWED_TAB
        const followedUserIds = inFollowedTab ? new Set(followedPeople.userIds) : null
        const followedContactIds = inFollowedTab ? new Set(followedPeople.contactIds) : null
        const projectIsVisible = selectedProjectIndex < 0 || selectedProjectIndex === projectIndex

        if (projectIsVisible) {
            amounts.users += users.filter(user => !ContactsHelper.isPrivateContact(user)).length
            amounts.contacts += contacts.filter(contact => !ContactsHelper.isPrivateContact(contact)).length
            if (inFollowedTab) {
                amounts.followedUsers += users.filter(
                    user => followedUserIds.has(user.uid) && !ContactsHelper.isPrivateContact(user)
                ).length
                amounts.followedContacts += contacts.filter(
                    contact => followedContactIds.has(contact.uid) && !ContactsHelper.isPrivateContact(contact)
                ).length
            }
        }

        filteredProjectsUsers[project.id] = inFollowedTab ? users.filter(user => followedUserIds.has(user.uid)) : users
        filteredProjectsContacts[project.id] = inFollowedTab
            ? contacts.filter(contact => followedContactIds.has(contact.uid))
            : contacts
    })

    return { filteredProjectsUsers, filteredProjectsContacts, amounts }
}
