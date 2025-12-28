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
    getDb,
    getFirestoreTime,
    uploadNewProject,
} from '../backends/firestore'
import { addNewUserToAlldoneTemplate, uploadNewUser, updateUserData } from '../backends/Users/usersFirestore'
import { getAssistantData, copyPreConfigTasksToNewAssistant } from '../backends/Assistants/assistantsFirestore'
import { GLOBAL_PROJECT_ID } from '../../components/AdminPanel/Assistants/assistantsHelper'
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
import { createChat } from '../backends/Chats/chatsComments'
import { STAYWARD_COMMENT } from '../../components/Feeds/Utils/HelperFunctions'
import { FEED_PUBLIC_FOR_ALL } from '../../components/Feeds/Utils/FeedsConstants'
import { BatchWrapper } from '../../functions/BatchWrapper/batchWrapper'

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

const getDefaultGlobalAssistantId = () => {
    const hostname = window.location.hostname
    const isStaging = hostname.includes('staging') || hostname.includes('localhost')

    // Staging: -OfxnUeFjPmvyqk5gFQE
    // Production: -Ns4cpvpLDeygvV2cjcJ
    return isStaging ? '-OfxnUeFjPmvyqk5gFQE' : '-Ns4cpvpLDeygvV2cjcJ'
}

const generateInitialAssistant = (globalAssistant, userId) => {
    if (!globalAssistant) {
        const { defaultAssistant } = store.getState()
        if (!defaultAssistant || !defaultAssistant.uid) {
            console.warn('No default assistant found, skipping assistant creation')
            return null
        }
        globalAssistant = defaultAssistant
    }

    const assistant = {
        ...globalAssistant,
        uid: getId(),
        noteIdsByProject: {},
        lastVisitBoard: {},
        commentsData: null,
        creatorId: userId,
        createdDate: Date.now(),
        isDefault: true,
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

const createWelcomeChatAndMessage = async (project, assistant, userId) => {
    console.log('[NewUserWelcomeChat] Starting createWelcomeChatAndMessage', {
        projectId: project.id,
        assistantId: assistant?.uid,
        userId,
    })

    if (!assistant) {
        console.warn('[NewUserWelcomeChat] createWelcomeChatAndMessage aborted: No assistant provided')
        return
    }

    const chatId = getId()
    const message =
        "Welcome to Alldone! My name is Anna. Think of me as your AI Chief of staff. You can talk to me here or on Whatsapp to capture tasks, ask what's next, capture your ideas and many things more. What can I do for you today?"
    const title = 'Welcome'

    console.log('[NewUserWelcomeChat] Creating Welcome Chat/Topic...', { chatId, title })

    // 1. Create Chat (Topic)
    // We make the assistant the creator of the chat
    await createChat(
        chatId,
        project.id,
        assistant.uid, // creatorId
        message, // comment (sets lastComment data)
        'topics', // type
        title, // title
        [FEED_PUBLIC_FOR_ALL], // isPublicFor
        '#FFFFFF', // hasStar (color)
        null, // stickyData
        [userId], // followerIds
        '', // quickDateId
        assistant.uid, // assistantId
        STAYWARD_COMMENT, // commentType
        assistant.uid // parentObjectCreatorId
    )

    console.log('[NewUserWelcomeChat] Welcome Chat Created. Adding initial comment document...')

    // 2. Create the Comment Document (Since createChat doesn't do it)
    const commentId = getId()
    const batch = new BatchWrapper(getDb())

    batch.set(getDb().doc(`chatComments/${project.id}/topics/${chatId}/comments/${commentId}`), {
        commentText: message,
        lastChangeDate: getFirestoreTime(),
        created: Date.now(),
        creatorId: assistant.uid,
        fromAssistant: true,
        commentType: STAYWARD_COMMENT,
    })

    // 3. Create Chat Notification for the User
    batch.set(getDb().doc(`chatNotifications/${project.id}/${userId}/${commentId}`), {
        chatId: chatId,
        chatType: 'topics',
        followed: true,
        date: Date.now(),
        creatorId: assistant.uid,
        creatorType: 'assistant',
    })

    // 4. Update User's lastAssistantCommentData (to show in assistant line)
    const updateAssistantData = {
        objectType: 'topics',
        objectId: chatId,
        creatorId: assistant.uid,
        creatorType: 'assistant',
        date: Date.now(),
    }

    batch.update(getDb().doc(`users/${userId}`), {
        [`lastAssistantCommentData.${project.id}`]: updateAssistantData,
        [`lastAssistantCommentData.allProjects`]: { ...updateAssistantData, projectId: project.id },
    })

    await batch.commit()
    console.log('[NewUserWelcomeChat] createWelcomeChatAndMessage completed successfully', { commentId })
}

export const processNewUser = async firebaseUser => {
    unwatch('loggedUser')

    initGoogleTagManager(userId)
    watchForceReload(userId, false)
    storeVersion()

    await loadGlobalData()

    const { initialUrl } = store.getState()
    const { uid: userId, email } = firebaseUser

    // Fetch the specific global assistant to be used as default
    const globalAssistantId = getDefaultGlobalAssistantId()
    let globalAssistant = null
    try {
        globalAssistant = await getAssistantData(GLOBAL_PROJECT_ID, globalAssistantId)
        console.log('Found global assistant for new user:', globalAssistant?.displayName)
    } catch (error) {
        console.warn('Failed to fetch global assistant:', error)
        console.error('CRITICAL ERROR: Failed to fetch global assistant', error)
        alert('CRITICAL ERROR: Failed to fetch global assistant: ' + error.message)
    }

    // Generate assistant first to get its ID for the project
    const assistant = generateInitialAssistant(globalAssistant, userId)
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

    // Create "Work" project
    const workProject = generateInitialProject(userId, assistant?.uid)
    workProject.name = 'Work'
    await uploadNewProject(workProject, user, [userId], false, false)

    if (assistant && globalAssistant) {
        // Copy pre-configured tasks from the global assistant to the new assistant
        // We use the original globalAssistant.uid as the source
        copyPreConfigTasksToNewAssistant(GLOBAL_PROJECT_ID, globalAssistant.uid, project.id, assistant.uid).catch(err =>
            console.warn('Failed to copy pre-config tasks:', err)
        )
    }

    if (assistant) {
        createWelcomeChatAndMessage(project, assistant, userId).catch(err =>
            console.warn('Failed to create welcome chat:', err)
        )
    }

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
