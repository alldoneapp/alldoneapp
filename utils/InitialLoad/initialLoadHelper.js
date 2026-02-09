import store from '../../redux/store'
import { getGlobalAssistants, getProjectAssistants, watchAssistants } from '../backends/Assistants/assistantsFirestore'
import { getProjectContacts, watchProjectContacts } from '../backends/Contacts/contactsFirestore'
import { getProjectUsers, removeCopyProjectIdFromUser, watchProjectUsers } from '../backends/Users/usersFirestore'
import { getProjectWorkstreams, watchProjectWorkstreams } from '../backends/Workstreams/workstreamsFirestore'
import {
    getAdministratorUser,
    getProjectData,
    unwatch,
    watchProject,
    watchProjectInvitations,
    watchProjectMeetings,
    watchUserData,
} from '../backends/firestore'
import {
    removeProjectData,
    setAdministratorAndGlobalAssistants,
    setAdministratorUser,
    setAssistantsInProject,
    setContactsInProject,
    setGlobalAssistants,
    setInvitationsInProject,
    setMeetingsInProject,
    setUsersInProject,
    setWorkstreamsInProject,
    setShowEndCopyProjectPopup,
    storeLoggedUser,
    updateUserProject,
    navigateToAllProjectsTasks,
    setChatNotificationsInProject,
} from '../../redux/actions'
import { GLOBAL_PROJECT_ID } from '../../components/AdminPanel/Assistants/assistantsHelper'
import SharedHelper, { ANONYMOUS_USER_DATA } from '../SharedHelper'
import { forceCloseModals } from '../HelperFunctions'
import { ROOT_ROUTES } from '../TabNavigationConstants'
import NavigationService from '../NavigationService'
import { watchChatNotifications } from '../backends/Chats/chatsComments'

export async function getInitialProjectData(projectId) {
    const promises = []
    promises.push(getProjectData(projectId))
    promises.push(getProjectUsers(projectId, false))
    promises.push(getProjectContacts(projectId))
    promises.push(getProjectWorkstreams(projectId))
    promises.push(getProjectAssistants(projectId))
    const [project, users, contacts, workstreams, assistants] = await Promise.all(promises)

    return { project, users, workstreams, contacts, assistants }
}

export function watchProjectData(projectId, likeProjectMember, watchChatNotifications) {
    const updateProject = project => {
        if (project) {
            store.dispatch(updateUserProject(project))
        } else {
            const { loggedUser, selectedProjectIndex, loggedUserProjectsMap, route } = store.getState()

            if (loggedUserProjectsMap[projectId] && loggedUserProjectsMap[projectId].index === selectedProjectIndex) {
                if (loggedUser.isAnonymous) {
                    SharedHelper.redirectToPrivateResource()
                } else {
                    if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')
                    store.dispatch(navigateToAllProjectsTasks())
                }
                forceCloseModals(true)
            }

            unwatchProjectData(projectId)
            store.dispatch(removeProjectData(projectId))
        }
    }
    const updateUsers = users => {
        if (users.length > 0) store.dispatch(setUsersInProject(projectId, users))
    }
    const updateContacts = contacts => {
        store.dispatch(setContactsInProject(projectId, contacts))
    }
    const updateWorkstreams = workstreams => {
        store.dispatch(setWorkstreamsInProject(projectId, workstreams))
    }
    const updateAssistants = assistants => {
        store.dispatch(setAssistantsInProject(projectId, assistants))
    }

    watchProject(projectId, updateProject, `${projectId}Project`)
    watchProjectUsers(projectId, updateUsers, `${projectId}Users`)
    watchProjectContacts(projectId, updateContacts, `${projectId}Contacts`)
    watchAssistants(projectId, `${projectId}Assistants`, updateAssistants)
    watchProjectWorkstreams(projectId, updateWorkstreams, `${projectId}Workstreams`)

    if (likeProjectMember) watchProjectDataThatIsOnlyForProjectMembers(projectId, watchChatNotifications)
}

export const watchProjectDataThatIsOnlyForProjectMembers = (projectId, watchChatNotifications) => {
    const updateInvitations = invitations => {
        store.dispatch(setInvitationsInProject(projectId, invitations))
    }
    const updateMeetings = meetings => {
        store.dispatch(setMeetingsInProject(projectId, meetings))
    }

    watchProjectInvitations(projectId, updateInvitations, `${projectId}Invitations`)
    watchProjectMeetings(projectId, updateMeetings, `${projectId}Mettings`)
    if (watchChatNotifications) watchProjectChatNotifications(projectId)
}

export function watchProjectChatNotifications(projectId) {
    const { loggedUser } = store.getState()

    const updateChatNotifications = notifications => {
        store.dispatch(setChatNotificationsInProject(projectId, notifications))
    }
    watchChatNotifications(projectId, loggedUser.uid, `${projectId}ChatNotifications`, updateChatNotifications)
}

export function watchProjectsChatNotifications() {
    const { loggedUser } = store.getState()
    loggedUser.projectIds.forEach(projectId => {
        watchProjectChatNotifications(projectId)
    })
}

export function watchLoggedUserData(loggedUser) {
    const setAnonymousUser = user => {
        store.dispatch(
            storeLoggedUser({
                ...user,
                ...ANONYMOUS_USER_DATA,
                projectIds: loggedUser.projectIds,
                guideProjectIds: loggedUser.guideProjectIds,
                templateProjectIds: loggedUser.templateProjectIds,
                archivedProjectIds: loggedUser.archivedProjectIds,
            })
        )
    }

    const setLoggedUser = user => {
        if (user) {
            if (user.copyProjectIds.length > 0) {
                const { loggedUser } = store.getState()
                const newProjectId = difference(user.projectIds, loggedUser.projectIds)[0]
                if (newProjectId && user.copyProjectIds.includes(newProjectId)) {
                    // If there is a new project in the User data, then occurs a duplication in the background
                    getProjectData(newProjectId).then(project => {
                        if (project) {
                            removeCopyProjectIdFromUser(loggedUser.uid, newProjectId)
                            store.dispatch(setShowEndCopyProjectPopup(true, project.name, project.color))
                        }
                    })
                }
            }
            store.dispatch(storeLoggedUser(user))
        }
    }

    watchUserData(loggedUser.uid, true, loggedUser.isAnonymous ? setAnonymousUser : setLoggedUser, 'loggedUser')
}

export function watchGlobalAssistants() {
    watchAssistants(GLOBAL_PROJECT_ID, 'globalAssistants', assistants => {
        store.dispatch(setGlobalAssistants(assistants))
    })
}

export function watchAdministratorUser(userId) {
    if (!userId) return
    watchUserData(
        userId,
        false,
        user => {
            store.dispatch(setAdministratorUser(user))
        },
        'administratorUser'
    )
}

export const loadGlobalData = async () => {
    const { globalAssistants: currentGlobalAssistants, administratorUser: currentAdministratorUser } = store.getState()

    const areGlobalAssistantsLoaded = currentGlobalAssistants.length > 0
    const isAdminUserLoaded = !!currentAdministratorUser.uid

    if (!areGlobalAssistantsLoaded || !isAdminUserLoaded) {
        try {
            const promises = []
            promises.push(getAdministratorUser())
            promises.push(getGlobalAssistants())
            const [administratorUser, globalAssistants] = await Promise.all(promises)
            store.dispatch(setAdministratorAndGlobalAssistants(administratorUser, globalAssistants))

            watchGlobalAssistants()
            if (administratorUser?.uid) {
                watchAdministratorUser(administratorUser.uid)
            }
        } catch (error) {
            console.error('Failed to load global data:', error)
            store.dispatch(setAdministratorAndGlobalAssistants({}, []))
        }
    }
}

export const unwatchProjectData = projectId => {
    unwatch(`${projectId}Project`)
    unwatch(`${projectId}Users`)
    unwatch(`${projectId}Contacts`)
    unwatch(`${projectId}Workstreams`)
    unwatch(`${projectId}Assistants`)
    unwatch(`${projectId}Invitations`)
    unwatch(`${projectId}Mettings`)
    unwatch(`${projectId}ChatNotifications`)
}

export const unwatchProjectsData = projectIds => {
    projectIds.forEach(projectId => {
        unwatchProjectData(projectId)
    })
}

export function handleCookies() {
    const { loggedUser } = store.getState()

    const cookie = JSON.parse(localStorage.getItem('alldone_cookie')) || {}
    if (!loggedUser || loggedUser.isAnonymous) {
        cookie.loggedIn = false
    } else if (!cookie || !cookie.loggedIn) {
        cookie.loggedIn = true
    }
    localStorage.setItem('alldone_cookie', JSON.stringify(cookie))
}

export function convertAnonymousProjectsIntoSharedProjects(
    projects,
    projectsMap,
    projectUsers,
    projectContacts,
    projectWorkstreams,
    projectAssistants
) {
    const {
        loggedUserProjects: anonymousLoggedUserProjects,
        projectUsers: anonymousProjectUsers,
        projectContacts: anonymousProjectContacts,
        projectWorkstreams: anonymousProjectWorkstreams,
        projectAssistants: anonymousProjectAssistants,
    } = store.getState()

    let nextIndex = projects.length
    anonymousLoggedUserProjects.forEach(project => {
        const sharedProject = { ...project, index: nextIndex }
        if (!projectsMap[sharedProject.id]) {
            projects.push(sharedProject)
            projectsMap[sharedProject.id] = sharedProject
            projectUsers[sharedProject.id] = anonymousProjectUsers[sharedProject.id]
            projectContacts[sharedProject.id] = anonymousProjectContacts[sharedProject.id]
            projectWorkstreams[sharedProject.id] = anonymousProjectWorkstreams[sharedProject.id]
            projectAssistants[sharedProject.id] = anonymousProjectAssistants[sharedProject.id]
            nextIndex++
        }
    })
}
