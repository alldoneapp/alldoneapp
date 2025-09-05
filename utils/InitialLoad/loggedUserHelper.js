import momentTz from 'moment-timezone'
import moment from 'moment-timezone'

import store from '../../redux/store'
import { getUserData, updateUserData } from '../backends/Users/usersFirestore'
import {
    initFCMonLoad,
    initGoogleTagManager,
    proccessAssistantDialyTopicIfNeeded,
    resetTimesDoneInExpectedDayPropertyInTasksIfNeeded,
    unwatch,
    updateLastLoggedUserDate,
    watchForceReload,
} from '../backends/firestore'
import { initLogInForLoggedUser, setProjectsInitialData, updateLoadingStep } from '../../redux/actions'
import { getDateFormatFromCurrentLocation } from '../Geolocation/GeolocationHelper'
import { getDeviceLanguage } from '../../i18n/TranslationService'
import {
    convertAnonymousProjectsIntoSharedProjects,
    getInitialProjectData,
    handleCookies,
    loadGlobalData,
    unwatchProjectsData,
    watchLoggedUserData,
    watchProjectData,
    watchProjectsChatNotifications,
} from './initialLoadHelper'
import { getProjectData } from '../backends/firestore'
import { getProjectUsers } from '../backends/Users/usersFirestore'
import { getProjectContacts } from '../backends/Contacts/contactsFirestore'
import { getProjectWorkstreams } from '../backends/Workstreams/workstreamsFirestore'
import { getProjectAssistants } from '../backends/Assistants/assistantsFirestore'
import { storeVersion } from '../Observers'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../NavigationService'
import { checkUserPremiumStatusStripe } from '../backends/Premium/stripePremiumFirestore'

function watchProjectsData(projectIds) {
    // Stagger watcher initialization to reduce initial Firebase load
    projectIds.forEach((projectId, index) => {
        setTimeout(() => {
            watchProjectData(projectId, true, false)
        }, index * 50) // 50ms delay between each watcher
    })
}

async function getInitialProjectsData(projectIds) {
    // Create batched promises for all projects to load data in parallel
    const allPromises = []

    projectIds.forEach(projectId => {
        // For each project, batch all its data requests
        allPromises.push(
            Promise.all([
                getProjectData(projectId),
                getProjectUsers(projectId, false),
                getProjectContacts(projectId),
                getProjectWorkstreams(projectId),
                getProjectAssistants(projectId),
            ]).then(([project, users, contacts, workstreams, assistants]) => ({
                project,
                users,
                contacts,
                workstreams,
                assistants,
            }))
        )
    })

    const projectsInitialData = await Promise.all(allPromises)

    const projects = []
    const projectsMap = {}
    const projectUsers = {}
    const projectContacts = {}
    const projectWorkstreams = {}
    const projectAssistants = {}

    projectIds.forEach((projectId, index) => {
        const { project, users, contacts, workstreams, assistants } = projectsInitialData[index]

        project.index = index
        projects.push(project)
        projectsMap[project.id] = project
        projectUsers[projectId] = users
        projectContacts[projectId] = contacts
        projectWorkstreams[projectId] = workstreams
        projectAssistants[projectId] = assistants
    })

    return { projects, projectsMap, projectUsers, projectContacts, projectWorkstreams, projectAssistants }
}

async function loadInitialData() {
    const { loggedUser } = store.getState()
    store.dispatch(updateLoadingStep(3, 'Loading projects...'))
    const projectsInitialData = await getInitialProjectsData(loggedUser.projectIds)

    const {
        projects,
        projectsMap,
        projectUsers,
        projectContacts,
        projectWorkstreams,
        projectAssistants,
    } = projectsInitialData

    convertAnonymousProjectsIntoSharedProjects(
        projects,
        projectsMap,
        projectUsers,
        projectContacts,
        projectWorkstreams,
        projectAssistants
    )

    unwatchProjectsData(loggedUser.projectIds)

    store.dispatch(updateLoadingStep(4, 'Setting up workspace...'))
    store.dispatch(
        setProjectsInitialData(
            projects,
            projectsMap,
            projectUsers,
            projectWorkstreams,
            projectContacts,
            projectAssistants
        )
    )

    watchLoggedUserData(loggedUser)

    // Defer non-critical watchers to improve initial load time
    setTimeout(() => {
        watchProjectsData(loggedUser.projectIds)
        watchProjectsChatNotifications()
    }, 200)

    store.dispatch(updateLoadingStep(5, 'Finalizing...'))
}

const getDataForUpdateUser = async loggedUser => {
    const userData = {}

    if (!loggedUser.dateFormat) {
        const { dateFormat, mondayFirstInCalendar } = await getDateFormatFromCurrentLocation()
        userData.dateFormat = dateFormat
        userData.mondayFirstInCalendar = mondayFirstInCalendar
    }

    if (!loggedUser.language) userData.language = getDeviceLanguage()

    const isFirstLoginInDay = !moment().isSame(moment(loggedUser.firstLoginDateInDay), 'day')
    if (isFirstLoginInDay) {
        const dateNow = moment().valueOf()
        userData.firstLoginDateInDay = dateNow
        userData.activeTaskStartingDate = dateNow
        userData.activeTaskInitialEndingDate = dateNow
        userData.activeTaskId = ''
        userData.activeTaskProjectId = ''
    }

    userData.timezone = parseInt(momentTz().format('Z'))
    userData.lastLogin = Date.now()

    return userData
}

export async function loadInitialDataForLoggedUser(loggedUser) {
    unwatch('loggedUser')

    store.dispatch(updateLoadingStep(1, 'Loading user data...'))

    initGoogleTagManager(loggedUser.uid)
    watchForceReload(loggedUser.uid, true)
    storeVersion()

    ProjectHelper.processInactiveProjectsWhenLoginUser(loggedUser)

    const userData = await getDataForUpdateUser(loggedUser)

    // Check premium status with Stripe in background (non-blocking)
    checkUserPremiumStatusStripe()
        .then(() => {
            console.log('Premium status check completed (background)')
        })
        .catch(error => {
            console.warn('Premium status check failed during login:', error)
        })

    store.dispatch(initLogInForLoggedUser({ ...loggedUser, ...userData }))

    updateUserData(loggedUser.uid, userData, null)

    store.dispatch(updateLoadingStep(2, 'Loading project data...'))
    await loadInitialData()

    initFCMonLoad()
    updateLastLoggedUserDate()
    proccessAssistantDialyTopicIfNeeded()
    resetTimesDoneInExpectedDayPropertyInTasksIfNeeded()

    //handleCookies()

    const { initialUrl } = store.getState()
    const url = initialUrl !== '/' ? initialUrl : window.location.pathname
    URLTrigger.processUrl(NavigationService, url)
}

export const loadGlobalDataAndGetUser = async userId => {
    const promises = []
    promises.push(getUserData(userId, true))
    promises.push(loadGlobalData())
    const [user] = await Promise.all(promises)
    return user
}
