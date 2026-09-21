import store from '../../redux/store'
import { getGlobalAssistants } from '../backends/Assistants/assistantsFirestore'
import { getAdministratorUser, getProjectData } from '../backends/firestore'
import { initAnonymousSesion, setAnonymousSesionData } from '../../redux/actions'
import { getDateFormatFromCurrentLocation } from '../Geolocation/GeolocationHelper'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../NavigationService'
import { watchAdministratorUser, watchGlobalAssistants, watchProjectData } from './initialLoadHelper'
import { ANONYMOUS_USER_DATA } from '../SharedHelper'

async function loadInitialData(projectId, projectUsers) {
    const promises = []
    // Public shared-resource views must not enumerate private project people or
    // related collections. The project document and the specifically authorized
    // resource are sufficient; keep the other Redux collection slots present but empty.
    promises.push(getProjectData(projectId))
    promises.push(getGlobalAssistants())
    // Administrator data is optional for a shared anonymous view. A transient
    // inability to verify it must not prevent the shared project itself from opening.
    promises.push(
        getAdministratorUser().catch(error => {
            console.warn('[GlobalData] Administrator unavailable in anonymous session:', error)
            return {}
        })
    )
    const [project, globalAssistants, administratorUser] = await Promise.all(promises)
    store.dispatch(setAnonymousSesionData(project, projectUsers, [], [], [], globalAssistants, administratorUser))

    watchGlobalAssistants()
    if (administratorUser?.uid && !administratorUser.roleOnly) {
        watchAdministratorUser(administratorUser.uid)
    }
    watchProjectData(projectId, false, false)
}

const updateUserDateData = async loggedUser => {
    if (!loggedUser.dateFormat) {
        const { dateFormat, mondayFirstInCalendar } = await getDateFormatFromCurrentLocation()
        loggedUser.dateFormat = dateFormat
        loggedUser.mondayFirstInCalendar = mondayFirstInCalendar
    }
}

const addAnonymousData = (user, projectId) => {
    const sourceUser = user || {}
    const guideProjectIds = Array.isArray(sourceUser.guideProjectIds) ? sourceUser.guideProjectIds : []
    const templateProjectIds = Array.isArray(sourceUser.templateProjectIds) ? sourceUser.templateProjectIds : []
    const archivedProjectIds = Array.isArray(sourceUser.archivedProjectIds) ? sourceUser.archivedProjectIds : []
    return {
        ...sourceUser,
        ...ANONYMOUS_USER_DATA,
        projectIds: [projectId],
        guideProjectIds: guideProjectIds.includes(projectId) ? [projectId] : [],
        templateProjectIds: templateProjectIds.includes(projectId) ? [projectId] : [],
        archivedProjectIds: archivedProjectIds.includes(projectId) ? [projectId] : [],
    }
}

export async function loadInitialDataForAnonymous(projectId, URL, users) {
    let { projectUser, currentUser } = users || {}
    projectUser = projectUser || currentUser || { uid: '' }
    currentUser = currentUser || projectUser

    const loggedUser = addAnonymousData(projectUser, projectId)
    if (projectUser.uid === currentUser.uid) currentUser = loggedUser

    await updateUserDateData(loggedUser)
    store.dispatch(initAnonymousSesion(loggedUser, currentUser))
    await loadInitialData(projectId, [projectUser])
    URLTrigger.processUrl(NavigationService, URL)
}
