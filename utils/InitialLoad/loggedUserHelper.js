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
import { initLogInForLoggedUser, setProjectsInitialData } from '../../redux/actions'
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
import { storeVersion } from '../Observers'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../NavigationService'
import { checkUserPremiumStatusStripe } from '../backends/Premium/stripePremiumFirestore'

function watchProjectsData(projectIds) {
    projectIds.forEach(projectId => {
        watchProjectData(projectId, true, false)
    })
}

async function getInitialProjectsData(projectIds) {
    const projectDataPromises = []
    projectIds.forEach(projectId => {
        projectDataPromises.push(getInitialProjectData(projectId))
    })

    const projectsInitialData = await Promise.all(projectDataPromises)

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
    watchProjectsData(loggedUser.projectIds)
    watchProjectsChatNotifications()
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

    initGoogleTagManager(loggedUser.uid)
    watchForceReload(loggedUser.uid, true)
    storeVersion()

    ProjectHelper.processInactiveProjectsWhenLoginUser(loggedUser)

    const userData = await getDataForUpdateUser(loggedUser)

    // Check premium status with Stripe during login
    try {
        console.log('Checking premium status with Stripe for user:', loggedUser.uid)

        // Debug: Check if tracking ID is available during login
        const trackingId = localStorage.getItem('alldone_trial_tracking_id')
        const timestamp = localStorage.getItem('alldone_trial_timestamp')
        console.log('🔑 Login - Tracking ID status before premium check:', {
            trackingId: trackingId ? `${trackingId.substring(0, 20)}...` : null,
            timestamp,
            age: timestamp ? `${Math.round((Date.now() - parseInt(timestamp)) / (1000 * 60))} minutes` : null,
            userId: loggedUser.uid,
        })

        await checkUserPremiumStatusStripe()
        console.log('Premium status check completed')
    } catch (error) {
        console.warn('Premium status check failed during login:', error)
        // Continue with login even if premium check fails
    }

    store.dispatch(initLogInForLoggedUser({ ...loggedUser, ...userData }))

    updateUserData(loggedUser.uid, userData, null)

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
