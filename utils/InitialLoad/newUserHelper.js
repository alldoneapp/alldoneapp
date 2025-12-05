import store from '../../redux/store'
import { setEndDataForNewUser, setInitialDataForNewUser, initLogInForLoggedUser } from '../../redux/actions'
import {
    mapUserData,
    addToMarketingList,
    getId,
    createUploadNewUserFeeds,
    logEvent,
    initGoogleTagManager,
    watchForceReload,
    initFCMonLoad,
    unwatch,
} from '../backends/firestore'
import { addNewUserToAlldoneTemplate, uploadNewUser, updateUserData } from '../backends/Users/usersFirestore'
import URLTrigger from '../../URLSystem/URLTrigger'
import { getNewDefaultUser } from '../../components/ContactsView/Utils/ContactsHelper'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../components/TaskListView/Utils/TasksHelper'
import { getDefaultMainWorkstream } from '../../components/Workstreams/WorkstreamHelper'
import {
    convertAnonymousProjectsIntoSharedProjects,
    handleCookies,
    loadGlobalData,
    watchLoggedUserData,
    watchProjectData,
    watchProjectsChatNotifications,
} from './initialLoadHelper'
import { getDateFormatFromCurrentLocation } from '../Geolocation/GeolocationHelper'
import { storeVersion } from '../Observers'
import NavigationService from '../NavigationService'
import { checkUserPremiumStatusStripe } from '../backends/Premium/stripePremiumFirestore'
import { PLAN_STATUS_PREMIUM } from '../../components/Premium/PremiumHelper'

const generateInitialWorkstream = (projectId, userId) => {
    return getDefaultMainWorkstream(projectId, userId)
}

const generateUser = async (firebaseUser, projectId) => {
    const { initialUrl } = store.getState()
    const { uid: userId, email, displayName, photoURL } = firebaseUser

    const user = getNewDefaultUser({
        uid: userId,
        displayName,
        email,
        photoURL,
        singUpUrl: initialUrl,
        defaultProjectId: projectId,
        projectIds: [projectId],
        lastEditionDate: Date.now(),
        lastEditorId: userId,
    })

    const { dateFormat, mondayFirstInCalendar } = await getDateFormatFromCurrentLocation()
    user.dateFormat = dateFormat
    user.mondayFirstInCalendar = mondayFirstInCalendar

    return user
}

const generateInitialProject = (userId, assistantId) => {
    const project = ProjectHelper.getNewDefaultProject()

    project.id = getId()
    project.index = 0
    project.creatorId = userId
    project.name = 'Private life'
    project.userIds = [userId]
    project.assistantId = assistantId || ''

    return project
}

const generateInitialAssistant = projectId => {
    const { defaultAssistant } = store.getState()

    if (!defaultAssistant || !defaultAssistant.uid) {
        console.warn('No default assistant found, skipping assistant creation')
        return null
    }

    const assistant = {
        ...defaultAssistant,
        uid: getId(),
        noteIdsByProject: {},
        lastVisitBoard: {},
        commentsData: null,
    }

    return assistant
}

const generateInitialTask = userId => {
    const task = TasksHelper.getNewDefaultTask()

    task.id = getId()
    task.name = 'Add your private tasks here :)'
    task.extendedName = task.name
    task.userId = userId
    task.creatorId = userId
    task.userIds = [userId]
    task.currentReviewerId = userId
    task.lastEditorId = userId

    return task
}

export const processNewUser = async firebaseUser => {
    unwatch('loggedUser')

    initGoogleTagManager(userId)
    watchForceReload(userId, false)
    storeVersion()

    await loadGlobalData()

    const { initialUrl } = store.getState()
    const { uid: userId, email } = firebaseUser

    // Generate assistant first to get its ID for the project
    const assistant = generateInitialAssistant()
    const project = generateInitialProject(userId, assistant?.uid)
    const workstream = generateInitialWorkstream(project.id, userId)
    const task = generateInitialTask(userId)
    const user = await generateUser(firebaseUser, project.id)

    const mappedUser = mapUserData(userId, user, true)

    const projects = [project]
    const projectsMap = { [project.id]: project }
    const projectUsers = { [project.id]: [mappedUser] }
    const projectContacts = { [project.id]: [] }
    const projectWorkstreams = { [project.id]: [workstream] }
    const projectAssistants = { [project.id]: assistant ? [assistant] : [] }

    convertAnonymousProjectsIntoSharedProjects(
        projects,
        projectsMap,
        projectUsers,
        projectContacts,
        projectWorkstreams,
        projectAssistants
    )

    store.dispatch(
        setInitialDataForNewUser(
            user,
            projects,
            projectsMap,
            projectUsers,
            projectContacts,
            projectWorkstreams,
            projectAssistants
        )
    )

    createUploadNewUserFeeds(mappedUser, userId, project.id, project, task.id, task)
    await uploadNewUser(userId, user, project, task, workstream, assistant)

    watchLoggedUserData(user)
    watchProjectData(project.id, true, false)
    watchProjectsChatNotifications()

    // Check premium status with Stripe during signup (same as login flow)
    try {
        console.log('Checking premium status with Stripe for new user:', userId)

        // Debug: Check if tracking ID is available during signup
        const trackingId = localStorage.getItem('alldone_trial_tracking_id')
        const timestamp = localStorage.getItem('alldone_trial_timestamp')
        console.log('🔑 Signup - Tracking ID status before premium check:', {
            trackingId: trackingId ? `${trackingId.substring(0, 20)}...` : null,
            timestamp,
            age: timestamp ? `${Math.round((Date.now() - parseInt(timestamp)) / (1000 * 60))} minutes` : null,
            userId: userId,
        })

        const premiumResult = await checkUserPremiumStatusStripe()
        console.log('Premium status check completed during signup:', premiumResult)

        // If user is premium, update their initial gold to 1000 instead of default 100
        if (premiumResult?.success && premiumResult?.premiumStatus === PLAN_STATUS_PREMIUM) {
            console.log('🥇 New premium user detected - updating initial gold to 1000')
            try {
                // Update in Firestore
                await updateUserData(userId, { gold: 1000 }, null)

                // Update in Redux store
                const currentState = store.getState()
                const updatedUser = { ...currentState.loggedUser, gold: 1000 }
                store.dispatch(initLogInForLoggedUser(updatedUser))

                console.log('✅ Premium user initial gold updated successfully')
            } catch (goldUpdateError) {
                console.warn('Failed to update premium user gold:', goldUpdateError)
            }
        }
    } catch (error) {
        console.warn('Premium status check failed during signup:', error)
        // Continue with signup even if premium check fails
    }

    // Temporarily deactivated: await addNewUserToAlldoneTemplate(userId)
    store.dispatch(setEndDataForNewUser())

    addToMarketingList(email, initialUrl)
    logEvent('new_user', { id: userId, email })

    initFCMonLoad()

    //handleCookies()

    const url = initialUrl !== '/' ? initialUrl : window.location.pathname
    // URLTrigger.processUrl(NavigationService, url)
    NavigationService.navigate('WhatsAppOnboarding', { nextUrl: url })
}
