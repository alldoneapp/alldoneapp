import store from '../../redux/store'
import { getGlobalAssistants } from '../backends/Assistants/assistantsFirestore'
import { getAdministratorUser } from '../backends/firestore'
import { initAnonymousSesion, setAnonymousSesionData } from '../../redux/actions'
import { getDateFormatFromCurrentLocation } from '../Geolocation/GeolocationHelper'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../NavigationService'
import {
    getInitialProjectData,
    handleCookies,
    watchAdministratorUser,
    watchGlobalAssistants,
    watchLoggedUserData,
    watchProjectData,
} from './initialLoadHelper'
import { ANONYMOUS_USER_DATA } from '../SharedHelper'

async function loadInitialData(projectId) {
    const { loggedUser } = store.getState()

    const promises = []
    promises.push(getInitialProjectData(projectId))
    promises.push(getGlobalAssistants())
    promises.push(getAdministratorUser())
    const [projectInitialData, globalAssistants, administratorUser] = await Promise.all(promises)

    const { project, users, workstreams, contacts, assistants } = projectInitialData
    store.dispatch(
        setAnonymousSesionData(project, users, workstreams, contacts, assistants, globalAssistants, administratorUser)
    )

    watchGlobalAssistants()
    watchAdministratorUser(administratorUser.uid)
    watchLoggedUserData(loggedUser)
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
    const { guideProjectIds, templateProjectIds, archivedProjectIds } = user
    return {
        ...user,
        ...ANONYMOUS_USER_DATA,
        projectIds: [projectId],
        guideProjectIds: guideProjectIds.includes(projectId) ? [projectId] : [],
        templateProjectIds: templateProjectIds.includes(projectId) ? [projectId] : [],
        archivedProjectIds: archivedProjectIds.includes(projectId) ? [projectId] : [],
    }
}

export async function loadInitialDataForAnonymous(projectId, URL, users) {
    let { projectUser, currentUser } = users

    const loggedUser = addAnonymousData(projectUser, projectId)
    if (projectUser.uid === currentUser.uid) currentUser = loggedUser

    await updateUserDateData(loggedUser)
    store.dispatch(initAnonymousSesion(loggedUser, currentUser))
    await loadInitialData(projectId)
    //handleCookies()
    URLTrigger.processUrl(NavigationService, URL)
}
