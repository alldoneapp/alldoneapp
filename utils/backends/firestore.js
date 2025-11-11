// Config file
import moment from 'moment'
import v4 from 'uuid/v4'
import * as Y from 'yjs'
import { has as hasProperty, isEmpty, isEqual, set as setProperty, difference, uniq, chunk, get, forEach } from 'lodash'

import TasksHelper, {
    BACKLOG_DATE_NUMERIC,
    DONE_STEP,
    GENERIC_NOTE_TYPE,
    GENERIC_TASK_TYPE,
    OPEN_STEP,
    RECURRENCE_MAP,
    RECURRENCE_NEVER,
    RECURRENCE_DAILY,
    RECURRENCE_EVERY_WORKDAY,
    RECURRENCE_WEEKLY,
    RECURRENCE_EVERY_2_WEEKS,
    RECURRENCE_EVERY_3_WEEKS,
    RECURRENCE_MONTHLY,
    RECURRENCE_EVERY_3_MONTHS,
    RECURRENCE_EVERY_6_MONTHS,
    RECURRENCE_ANNUALLY,
    TASK_ASSIGNEE_USER_TYPE,
} from '../../components/TaskListView/Utils/TasksHelper'
// BEGIN-ENVS
import {
    GOOGLE_FIREBASE_WEB_API_KEY,
    GOOGLE_FIREBASE_WEB_APP_ID,
    GOOGLE_FIREBASE_WEB_AUTH_DOMAIN,
    GOOGLE_FIREBASE_WEB_CLIENT_ID,
    GOOGLE_FIREBASE_WEB_DATABASE_URL,
    GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID,
    GOOGLE_FIREBASE_WEB_PROJECT_ID,
    GOOGLE_FIREBASE_STORAGE_BUCKET,
    SENTRY_DSN,
    HOSTING_URL,
    CURRENT_ENVIORNMENT,
    NOTES_COLLABORATION_SERVER,
    ALGOLIA_APP_ID,
    ALGOLIA_SEARCH_ONLY_API_KEY,
    GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET,
    GOOGLE_ANALYTICS_KEY,
    GOOGLE_ADS_GUIDE_CONVERSION_TAG,
    IP_REGISTRY_API_KEY,
    SIB_API_KEY,
    SIB_MARKETING_SERVICE_LIST,
    GIPHY_API_KEY,
    PERPLEXITY_API_KEY,
} from 'react-native-dotenv'
// END-ENVS
import { updateXpByCreateProject } from '../Levels'
import store from '../../redux/store'

import HelperFunctions, { chronoEntriesOrder } from '../HelperFunctions'
import {
    FOLLOWER_ASSISTANTS_TYPE,
    FOLLOWER_CONTACTS_TYPE,
    FOLLOWER_GOALS_TYPE,
    FOLLOWER_NOTES_TYPE,
    FOLLOWER_PROJECTS_TYPE,
    FOLLOWER_SKILLS_TYPE,
    FOLLOWER_TASKS_TYPE,
    FOLLOWER_TOPICS_TYPE,
    FOLLOWER_USERS_TYPE,
} from '../../components/Followers/FollowerConstants'
import {
    ALL_TAB,
    BOTH_TABS,
    FEED_CONTACT_ADDED,
    FEED_CONTACT_GIVE_KARMA,
    FEED_CONTACT_OBJECT_TYPE,
    FEED_CONTACT_PICTURE_CHANGED,
    FEED_PROJECT_COLOR_CHANGED,
    FEED_PROJECT_GIVE_KARMA,
    FEED_PROJECT_KICKED_MEMBER,
    FEED_PROJECT_OBJECT_TYPE,
    FEED_PROJECT_GUIDE_CHANGED,
    FEED_PUBLIC_FOR_ALL,
    FEED_TASK_ASSIGNEE_CHANGED,
    FEED_TASK_GIVE_KARMA,
    FEED_TASK_MOVED_IN_WORKFLOW,
    FEED_TASK_OBJECT_TYPE,
    FEED_TASK_PROJECT_CHANGED_FROM,
    FEED_TASK_PROJECT_CHANGED_TO,
    FEED_TASK_TO_ANOTHER_USER,
    FEED_TASK_PARENT_GOAL,
    FEED_USER_ALL_MEMBERS_FOLLOWING,
    FEED_USER_FOLLOWING_ALL_MEMBERS,
    FEED_USER_GIVE_KARMA,
    FEED_USER_OBJECT_TYPE,
    FEED_USER_WORKFLOW_ADDED,
    FEED_USER_WORKFLOW_CHANGED,
    FEED_USER_WORKFLOW_REMOVE,
    FOLLOWED_TAB,
    FEED_SKILL_BACKLINK,
    FEED_ASSISTANT_BACKLINK,
} from '../../components/Feeds/Utils/FeedsConstants'
import { getFeedObjectTypes, STAYWARD_COMMENT } from '../../components/Feeds/Utils/HelperFunctions'
import {
    setAllFeeds,
    setFollowedFeeds,
    setHashtagsColors,
    setNewLocalFeedData,
    setShowNewDayNotification,
    startLoadingData,
    stopLoadingData,
    updateAllSelectedTasks,
    setTriggerGoldAnimation,
    setRegisteredNewUser,
    navigateToNewProject,
    setProjectInitialData,
    setChatNotificationsInProject,
} from '../../redux/actions'
import ProjectHelper, {
    checkIfSelectedAllProjects,
    PROJECT_PUBLIC,
} from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { ALL_USERS, CAPACITY_NONE, DYNAMIC_PERCENT } from '../../components/GoalsView/GoalsHelper'
import { getGoalData, updateGoalEditionData, updateGoalNote } from './Goals/goalsFirestore'
import {
    DAILY_GOLD_LIMIT,
    PHOTO_SIZE_300,
    PHOTO_SIZE_50,
    getUserPresentationDataInProject,
} from '../../components/ContactsView/Utils/ContactsHelper'

import { firebase } from '@firebase/app'
import { PLAN_STATUS_FREE } from '../../components/Premium/PremiumHelper'
import { COLOR_KEY_4 } from '../../components/NotesView/NotesDV/EditorView/HashtagInteractionPopup/HashtagsInteractionPopup'
import { processRestoredNote } from '../../components/NotesView/NotesDV/EditorView/notesHelper'
import { CURRENT_DAY_VERSION_ID } from '../../components/UIComponents/FloatModals/RevisionHistoryModal/RevisionHistoryModal'
import {
    DEFAULT_WORKSTREAM_ID,
    getDefaultMainWorkstream,
    getWorkstreamInProject,
    isWorkstream,
} from '../../components/Workstreams/WorkstreamHelper'
import { COLORS_THEME_MODERN } from '../../Themes/Themes'
import { SIDEBAR_COLLAPSED } from '../../components/SidebarMenu/Collapsible/CollapsibleHelper'
import GooleApi from '../../apis/google/GooleApi'
import { updateQuotaTraffic } from './Premium/premiumFirestore'
import {
    ESTIMATION_0_MIN,
    ESTIMATION_16_HOURS,
    ESTIMATION_TYPE_POINTS,
    ESTIMATION_TYPE_TIME,
    getEstimationIconByValue,
    getEstimationRealValue,
    getEstimationTagText,
} from '../EstimationHelper'
import Backend from '../BackendBridge'
import { getTaskTypeIndex, MAIN_TASK_INDEX } from './openTasks'

import {
    createBacklinkProjectFeed,
    createChangeProjectStatusFeed,
    createProjectCreatedFeed,
    createProjectDeclinedInvitationFeed,
    createProjectDescriptionChangedFeed,
    createProjectFollowedFeed,
    createProjectGuideIdChangedFeed,
    createProjectInvitationSentFeed,
    createProjectUnfollowedFeed,
    generateProjectObjectModel,
} from './Projects/projectUpdates'
import {
    createBacklinkNoteFeed,
    createNoteCreatedFeed,
    createNoteDeletedFeed,
    createNoteEditingFeed,
    createNoteFollowedFeed,
    createNoteHighlightedChangedFeed,
    createNoteNameChangedFeed,
    createNoteOwnerChangedFeed,
    createNotePrivacyChangedFeed,
    createNoteProjectChangedFeed,
    createNoteStickyFeed,
    createNoteUnfollowedFeed,
    generateNoteObjectModel,
} from './Notes/noteUpdates'
import {
    createBacklinkGoalFeed,
    createGoalAssigeesChangedFeed,
    createGoalCapacityChangedFeed,
    createGoalCreatedFeed,
    createGoalDeletedFeed,
    createGoalDescriptionChangedFeed,
    createGoalFollowedFeed,
    createGoalHighlightedChangedFeed,
    createGoalNameChangedFeed,
    createGoalPrivacyChangedFeed,
    createGoalProgressChangedFeed,
    createGoalProjectChangedFeed,
    createGoalUnfollowedFeed,
    generateGoalObjectModel,
} from './Goals/goalUpdates'
import {
    createBacklinkUserFeed,
    createUserFollowedFeed,
    createUserJoinedFeed,
    createUserUnfollowedFeed,
    createWorkflowStepFeed,
    generateUserObjectModel,
} from './Users/userUpdates'
import {
    createBacklinkContactFeed,
    createContactAddedFeed,
    createContactCompanyChangedFeed,
    createContactDescriptionChangedFeed,
    createContactEmailChangedFeed,
    createContactFollowedFeed,
    createContactHighlightChangedFeed,
    createContactPhoneNumberChangedFeed,
    createContactPictureChangedFeed,
    createContactPrivacyChangedFeed,
    createContactRoleChangedFeed,
    createContactUnfollowedFeed,
    generateContactObjectModel,
} from './Contacts/contactUpdates'
import {
    createBacklinkSkillFeed,
    createSkillFollowedFeed,
    createSkillUnfollowedFeed,
    generateSkillObjectModel,
} from './Skills/skillUpdates'
import {
    createBacklinkTaskFeed,
    createTaskAssigneeChangedFeed,
    createTaskAssigneeEstimationChangedFeed,
    createTaskCheckedDoneFeed,
    createTaskCreatedFeed,
    createTaskDeletedFeed,
    createTaskDescriptionChangedFeed,
    createTaskDueDateChangedFeed,
    createTaskAlertChangedFeed,
    createTaskFollowedFeed,
    createTaskHighlightedChangedFeed,
    createTaskMovedInWorkflowFeed,
    createTaskNameChangedFeed,
    createTaskObservedFeed,
    createTaskObserverEstimationChangedFeed,
    createTaskParentGoalChangedFeed,
    createTaskPrivacyChangedFeed,
    createTaskProjectChangedFeed,
    createTaskRecurrenceChangedFeed,
    createTaskReviewerEstimationChangedFeed,
    createTaskToAnotherUserFeed,
    createTaskUnObservedFeed,
    createTaskUncheckedDoneFeed,
    createTaskUnfollowedFeed,
    generateTaskObjectModel,
} from './Tasks/taskUpdates'
import { PROJECT_TYPE_ARCHIVED } from '../../components/SettingsView/ProjectsSettings/ProjectsSettings'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../NavigationService'
import { getUserLanguageIndexForSendinBlue } from '../../i18n/TranslationService'
import { PROJECT_COLOR_DEFAULT } from '../../Themes/Modern/ProjectColors'
import { BatchWrapper } from '../../functions/BatchWrapper/batchWrapper'
import { createBotDailyTopic } from '../assistantHelper'
import {
    addProjectInvitationToUser,
    addUserToProject,
    getUserData,
    getUsersByEmail,
    getUsersInvitedToProject,
    removeProjectInvitationFromUser,
    removeUserInvitationToProject,
    setDefaultProjectId,
    setUserDailyTopicDate,
    setUserNote,
    updateDefaultProjectIfNeeded,
    updateUserEditionData,
    updateUserData,
} from './Users/usersFirestore'
import { getContactData, updateContactEditionData, updateContactNote } from './Contacts/contactsFirestore'
import { getAssistantData, updateAssistantEditionData, updateAssistantNote } from './Assistants/assistantsFirestore'
import {
    GLOBAL_PROJECT_ID,
    getAssistant,
    isGlobalAssistant,
} from '../../components/AdminPanel/Assistants/assistantsHelper'
import {
    createGenericTaskWhenMention,
    setTaskDueDate,
    setTaskNote,
    setTaskParentGoal,
    setTaskStatus,
    setTaskToBacklog,
    updateTaskData,
    updateTaskEditionData,
    uploadNewSubTask,
} from './Tasks/tasksFirestore'
import { deleteNote, updateNoteEditionData, uploadNewNote } from './Notes/notesFirestore'
import { getSkillData, updateSkillEditionData, updateSkillNote } from './Skills/skillsFirestore'
import {
    createAssistantFollowedFeed,
    createAssistantUnfollowedFeed,
    createBacklinkAssistantFeed,
    generateAssistantObjectModel,
} from './Assistants/assistantUpdates'
import { getDvMainTabLink, getUrlParts } from '../LinkingHelper'
import { getWorkstreamData, uploadNewMainWorkstream } from './Workstreams/workstreamsFirestore'
import { updateChatEditionData, updateChatNote } from './Chats/chatsFirestore'
import { unwatchProjectData, watchProjectData } from '../InitialLoad/initialLoadHelper'
import { ROOT_ROUTES } from '../TabNavigationConstants'
import {
    addFollowerToChat,
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY,
    createObjectMessage,
    removeFollowerFromChat,
} from './Chats/chatsComments'

let firestore
let auth
let database
let storage
export let notesStorage
let functions
let messaging
let db
let somePrefix = 'Offline'
let someId = -1
let syncToBackend = true

let watchSubtaskList = {}
let karmaPointsUnsub = () => {}
let xpPointsUnsub = () => {}

let singleTaskUnsub = () => {}
let feedsUnsub = () => {}
let followersUnsubs = () => {}
let followersUnsubsList = {}
let userWorkflowUnsub = () => {}
let userChangeUnsub = () => {}
const feedsCountUnsub = { followed: {}, all: {} }
let sortKey = 0
let negativeSortTaskKey = 0
let feedsDetailedViewUnsub
const feedsReduxStoreUnsub = { followed: {}, all: {} }
let notesUnsubs = {}
const notesUnsubs2 = {}
const notesNeedsShowMoreUnsubs = {}
let stickyNotesUnsubs = () => {}
let noteUnsub = {}
const followedUsersUnsubs = {}
const followedContactsUnsubs = {}
const linkedNotesUnsubs = {}
const linkTagsUnsubs = {}
let linkedTasksUnsub = () => {}
const feedObjectsLastStates = {}
export const globalWatcherUnsub = {}
const backlinksCounterUnsub = {}
const unsubHastagsColors = {}
let noteRevisionHistoryCopiesUnsub = () => {}

const firebaseConfig = {
    apiKey: GOOGLE_FIREBASE_WEB_API_KEY,
    authDomain: GOOGLE_FIREBASE_WEB_AUTH_DOMAIN,
    databaseURL: GOOGLE_FIREBASE_WEB_DATABASE_URL,
    projectId: GOOGLE_FIREBASE_WEB_PROJECT_ID,
    storageBucket: GOOGLE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID,
    appId: GOOGLE_FIREBASE_WEB_APP_ID,
    measurementId: GOOGLE_ANALYTICS_KEY, // This is for production
}

// Helper function to determine if we should use Firebase Functions emulator
function shouldUseEmulator() {
    const forceEmulator = window.location.search.includes('emulator=true')

    return forceEmulator
}

// Helper function to delete all Firebase IndexedDB databases
async function clearAllFirebaseIndexedDB() {
    if (!window.indexedDB) {
        console.warn('IndexedDB not available')
        return
    }

    try {
        const databases = await window.indexedDB.databases()
        const firebaseDBs = databases.filter(
            db =>
                db.name &&
                (db.name.startsWith('firebaseLocalStorage') ||
                    db.name.startsWith('firebase-heartbeat') ||
                    db.name.startsWith('firebase-installations') ||
                    db.name.includes('firestore'))
        )

        console.log(
            '🗑️  Found Firebase IndexedDB databases to delete:',
            firebaseDBs.map(db => db.name)
        )

        const deletePromises = firebaseDBs.map(db => {
            return new Promise((resolve, reject) => {
                const request = window.indexedDB.deleteDatabase(db.name)
                request.onsuccess = () => {
                    console.log('✅ Deleted IndexedDB:', db.name)
                    resolve()
                }
                request.onerror = () => {
                    console.warn('⚠️  Failed to delete IndexedDB:', db.name)
                    resolve() // Still resolve to not block other deletions
                }
                request.onblocked = () => {
                    console.warn('⚠️  Blocked from deleting IndexedDB:', db.name)
                    resolve()
                }
            })
        })

        await Promise.all(deletePromises)
        console.log('✅ Finished clearing Firebase IndexedDB databases')
    } catch (error) {
        console.warn('⚠️  Error clearing Firebase IndexedDB:', error.message)
    }
}

export async function initFirebase(onComplete) {
    // Determine if we should use Firebase emulators BEFORE initializing
    const useEmulator = shouldUseEmulator()

    // Clear ALL Firebase IndexedDB databases BEFORE initializing Firebase
    if (useEmulator) {
        console.log('🧹 Clearing ALL Firebase IndexedDB databases for emulator (BEFORE init)')
        await clearAllFirebaseIndexedDB()
    }

    // Load only critical modules first for faster initialization
    require('firebase/auth')
    require('firebase/firestore')

    firebase.initializeApp(firebaseConfig)
    db = firebase.firestore()

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    const forceEmulator = window.location.search.includes('emulator=true')

    console.log('🔍 Firebase emulator connection check:', {
        hostname: window.location.hostname,
        isLocalhost,
        __DEV__: typeof __DEV__ !== 'undefined' ? __DEV__ : 'undefined',
        NODE_ENV: typeof process !== 'undefined' ? process.env.NODE_ENV : 'undefined',
        forceEmulator,
        useEmulator,
        environment: CURRENT_ENVIORNMENT,
    })

    if (useEmulator) {
        try {
            // Connect to Firestore emulator AFTER clearing persistence
            console.log('🔧 Connecting to Firestore emulator at 127.0.0.1:8080')
            db.useEmulator('127.0.0.1', 8080)
            console.log('✅ Connected to Firestore emulator')
        } catch (error) {
            console.warn('⚠️  Failed to connect to Firestore emulator:', error.message)
        }
        try {
            // Connect to Functions emulator only
            require('firebase/functions')
            // Initialize functions with the correct region for emulator
            const functionsInstance = firebase.app().functions('europe-west1')

            // Check if already connected to emulator
            console.log('🔍 Functions instance before emulator setup:', functionsInstance)

            functionsInstance.useEmulator('127.0.0.1', 5001)

            console.log('🔧 Connected to Firebase Functions emulator at 127.0.0.1:5001 (europe-west1)')

            // Set the global functions variable to the emulator instance
            functions = functionsInstance

            // Test the connection by getting a function reference
            const testFunction = functionsInstance.httpsCallable('generatePreConfigTaskResultSecondGen')
            console.log('🧪 Test function reference created:', typeof testFunction)
        } catch (error) {
            console.warn('⚠️  Failed to connect to Firebase Functions emulator:', error.message, error)
        }
    } else {
        console.log('🌐 Using production Firebase Functions')
    }

    firebase.auth().onAuthStateChanged(firebaseUser => {
        onComplete(firebaseUser)
    })

    // Load non-critical modules in background after authentication
    setTimeout(() => {
        loadDeferredFirebaseModules()
    }, 100)
}

function loadDeferredFirebaseModules() {
    try {
        // Load functions (but don't overwrite if emulator is already set)
        require('firebase/functions')
        if (!functions) {
            functions = firebase.app().functions('europe-west1')
            console.log('🌐 Using production Firebase Functions (europe-west1)')
        } else {
            console.log('🔧 Functions already configured (emulator), not overwriting')
        }

        // Load storage
        require('firebase/storage')
        notesStorage = firebase.app().storage(`gs://${GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET}`)

        // Load messaging
        require('firebase/messaging')
        if (firebase.messaging && firebase.messaging.isSupported && firebase.messaging.isSupported()) {
            messaging = firebase.messaging()
        }

        // Load analytics
        require('firebase/analytics')
        firebase.analytics()

        // Load database
        require('firebase/database')

        console.log('Deferred Firebase modules loaded')
    } catch (error) {
        console.warn('Error loading deferred Firebase modules:', error)
    }
}

export function initGoogleTagManager(userId) {
    gtag('config', GOOGLE_ANALYTICS_KEY, {
        user_id: userId,
    })
}

export function initFCM(userId) {
    const uid = userId ? userId : store.getState().loggedUser.uid
    const userRef = db.doc(`/users/${uid}`)
    if (firebase.messaging && firebase.messaging.isSupported && firebase.messaging.isSupported()) {
        messaging
            .requestPermission()
            .then(() => messaging.getToken())
            .then(token => {
                userRef.get().then(doc => {
                    const user = mapUserData(doc.id, doc.data())
                    if (!user.fcmToken.some(item => item === token)) {
                        doc.ref.update({
                            fcmToken: firebase.firestore.FieldValue.arrayUnion(token),
                        })
                    }
                })
            })
            .catch(console.error)
        messaging.onTokenRefresh(() => {
            messaging
                .getToken()
                .then(refreshedToken => {
                    userRef.get().then(doc => {
                        const user = mapUserData(doc.id, doc.data())
                        if (!user.fcmToken.some(item => item === token)) {
                            doc.ref.update({
                                fcmToken: firebase.firestore.FieldValue.arrayUnion(token),
                            })
                        }
                    })
                })
                .catch(err => {
                    console.log('Unable to retrieve refreshed token ', err)
                })
        })
    }
    userRef.update({ pushNotificationsStatus: true })
}

export function initFCMonLoad() {
    if (firebase.messaging && firebase.messaging.isSupported && firebase.messaging.isSupported()) {
        messaging
            .requestPermission()
            .then(() => messaging.getToken())
            .then(token => {
                const { fcmToken, uid } = store.getState().loggedUser
                if (!fcmToken.some(item => item === token)) {
                    db.doc(`/users/${uid}`).update({
                        fcmToken: firebase.firestore.FieldValue.arrayUnion(token),
                    })
                }
            })
            .catch(console.error)
        messaging.onTokenRefresh(() => {
            messaging
                .getToken()
                .then(refreshedToken => {
                    const { fcmToken, uid } = store.getState().loggedUser
                    if (!fcmToken.some(item => item === refreshedToken)) {
                        db.doc(`/users/${uid}`).update({
                            fcmToken: firebase.firestore.FieldValue.arrayUnion(refreshedToken),
                        })
                    }
                })
                .catch(err => {
                    console.error('Unable to retrieve refreshed token ', err)
                })
        })
    }
}

export function initGAPIWeb(handlerFunction) {
    // window.google
    // from Google Identity Services ( GSI )
    // is loaded in the web/index.html file
    // as a script tag
    onload = () => {
        window.google.accounts.id.initialize({
            client_id: GOOGLE_FIREBASE_WEB_CLIENT_ID,
            callback: handlerFunction || handleGSICredentialResponse,
            itp_support: true,
        })
        window.google.accounts.id.prompt()
    }
}

const handleGSICredentialResponse = response => {
    console.log('User already logged!')
}

export const getGoogleClientId = () => {
    return GOOGLE_FIREBASE_WEB_CLIENT_ID
}

export function loginWithGoogleWeb() {
    // window.google
    // from Google Identity Services ( GSI )
    return new Promise(() => {
        window.google.accounts.id.initialize({
            client_id: GOOGLE_FIREBASE_WEB_CLIENT_ID,
            callback: handleGSICredentialResponseOnLogin,
            itp_support: true,
        })
    })
}

export const handleGSICredentialResponseOnLogin = async response => {
    const credentials = await firebase.auth.GoogleAuthProvider.credential(response.credential)
    await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    firebase
        .auth()
        .signInWithCredential(credentials)
        .then(data => {
            if (data.additionalUserInfo && data.additionalUserInfo.isNewUser) {
                NavigationService.navigate('LoginScreen')

                store.dispatch(setRegisteredNewUser(true))
            }
        })
}

export function getDb() {
    if (!db) {
        console.warn('Firebase db not yet initialized, this may cause errors')
        return null
    }
    return db
}

export function getIsMessagingSupported() {
    return firebase.messaging && firebase.messaging.isSupported && firebase.messaging.isSupported()
}

export async function tryAddUserToProjectByUidOrEmail(uidOrEmail, projectId) {
    const project = await getProjectData(projectId)
    await addUserToProject(uidOrEmail, project, projectId, true, null, null)
}

export async function selectAndSetNewDefaultProject(user) {
    const { uid, projectIds, archivedProjectIds, defaultProjectId } = user
    const projectDocs = (
        await db
            .collection('projects')
            .where('userIds', 'array-contains', uid)
            .where('isTemplate', '==', false)
            .where('parentTemplateId', '==', '')
            .orderBy('created', 'asc')
            .get()
    ).docs
    let newDefaultProjectId = ''
    projectDocs.forEach(doc => {
        if (
            !newDefaultProjectId &&
            doc.id !== defaultProjectId &&
            projectIds.includes(doc.id) &&
            !archivedProjectIds.includes(doc.id)
        ) {
            newDefaultProjectId = doc.id
        }
    })
    await setDefaultProjectId(user.uid, newDefaultProjectId)
}

export async function inviteUserToProject(userEmail, projectId, inviterUserId) {
    const batch = new BatchWrapper(db)
    const { loggedUserProjectsMap } = store.getState()
    const project = loggedUserProjectsMap[projectId]
    await createProjectInvitationSentFeed(projectId, userEmail, project, batch)
    const followProjectData = {
        followObjectsType: FOLLOWER_PROJECTS_TYPE,
        followObjectId: projectId,
        followObject: project,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followProjectData, batch)
    batch.commit()

    const invitations = (
        await db.collection(`projectsInvitation/${projectId}/invitations`).where('userEmail', '==', userEmail).get()
    ).docs

    if (invitations.length === 0) {
        let invitedUserData = {
            userEmail: userEmail,
            inviterId: inviterUserId,
            userId: null,
            url: `${window.location.origin}/projects/${projectId}/contacts/${userEmail}/add`,
        }

        const matchedUser = (await getUsersByEmail(userEmail, true))[0]

        if (matchedUser) {
            invitedUserData.userId = matchedUser.id
        }

        db.collection(`projectsInvitation/${projectId}/invitations`).add(invitedUserData)

        if (invitedUserData.userId != null) {
            addProjectInvitationToUser(projectId, invitedUserData.userId)
        }
    }
}

export async function cancelInvitedUserFromProject(userEmail, projectId) {
    let user = null
    const matchedUser = (await getUsersByEmail(userEmail, true))[0]

    if (matchedUser) {
        user = mapUserData(matchedUser.id, matchedUser.data())
    } else {
        user = { email: userEmail }
    }
    removeInvitedUserFromProject(user, projectId)
}

export async function removeInvitedUserFromProject(user, projectId) {
    const invitations = (
        await db.collection(`projectsInvitation/${projectId}/invitations`).where('userEmail', '==', user.email).get()
    ).docs

    if (invitations.length > 0) {
        let key = invitations.shift().id
        firebase.firestore().doc(`projectsInvitation/${projectId}/invitations/${key}`).delete()

        if (user.uid !== undefined) {
            removeProjectInvitationFromUser(projectId, user.uid, null)
        }
    }
}

export async function getUserDataByUidOrEmail(uidOrEmail) {
    let user = null

    const emailRegex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/ // RegExp for email validation when getting the user data
    if (emailRegex.test(String(uidOrEmail).toLowerCase())) {
        const userObj = (await getUsersByEmail(uidOrEmail, true))[0]

        user = mapUserData(userObj.id, userObj.data())
    } else {
        user = await getUserData(uidOrEmail, false)
    }

    return user
}

export async function declineProjectInvitation(user, project) {
    createProjectDeclinedInvitationFeed(project.id, project)
    removeInvitedUserFromProject(user, project.id)
}

export async function addContactFeedsChain(projectId, contact, photoURL, contactId) {
    const followContactData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
        feedCreator: store.getState().loggedUser,
    }
    const batch = new BatchWrapper(db)
    await createContactAddedFeed(projectId, contact, contactId, photoURL, batch)
    if (contact.company) {
        await createContactCompanyChangedFeed(projectId, contact, contactId, contact.company, '', batch)
    }
    if (contact.role) {
        await createContactRoleChangedFeed(projectId, contact, contactId, contact.role, '', batch)
    }
    if (contact.extendedDescription) {
        await createContactDescriptionChangedFeed(projectId, contact, contactId, contact.extendedDescription, '', batch)
    }
    if (contact.hasStar !== '#FFFFFF') {
        await createContactHighlightChangedFeed(projectId, contact, contactId, contact.hasStar, batch)
    }
    if (!contact.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
        await createContactPrivacyChangedFeed(
            projectId,
            contact,
            contactId,
            contact.isPrivate,
            contact.isPublicFor,
            batch
        )
    }
    if (contact.phone) {
        await createContactPhoneNumberChangedFeed(projectId, contact, contactId, contact.phone, '', batch)
    }
    if (contact.email) {
        await createContactEmailChangedFeed(projectId, contact, contactId, contact.email, '', batch)
    }
    await addFollower(projectId, followContactData, batch)

    batch.commit()
}

export async function deleteFolderFilesInStorage(path) {
    const filesRef = firebase.storage().ref(path)
    const folder = await filesRef.listAll()
    const promises = []
    for (let file of folder.items) {
        promises.push(filesRef.child(file.name).delete())
    }
    await Promise.all(promises)
}

export async function uploadAvatarPhotos(pictures, picturesPath, feedPath) {
    let attachRef = firebase.storage().ref(picturesPath)
    let attach50Ref = firebase.storage().ref(`${picturesPath}_50x50`)
    let attach300Ref = firebase.storage().ref(`${picturesPath}_300x300`)
    let picFeed50Ref = feedPath ? firebase.storage().ref(`${feedPath}_50x50`) : ''

    let promises = []
    promises.push(attachRef.put(pictures[0], { contentType: 'image/png' }))
    promises.push(attach50Ref.put(pictures[1], { contentType: 'image/png' }))
    promises.push(attach300Ref.put(pictures[2], { contentType: 'image/png' }))
    if (feedPath) promises.push(picFeed50Ref.put(pictures[1], { contentType: 'image/png' }))
    await Promise.all(promises)

    promises = []
    promises.push(attachRef.getDownloadURL())
    promises.push(attach50Ref.getDownloadURL())
    promises.push(attach300Ref.getDownloadURL())
    if (feedPath) promises.push(picFeed50Ref.getDownloadURL())
    const urlList = await Promise.all(promises)
    return urlList
}

export async function proccessPictureForAvatar(pictureFile) {
    const src = typeof pictureFile === 'string' ? pictureFile : URL.createObjectURL(pictureFile)

    const resized50 = (await HelperFunctions.resizeImage(src, PHOTO_SIZE_50)).uri
    const resized300 = (await HelperFunctions.resizeImage(src, PHOTO_SIZE_300)).uri

    const photoURL = await HelperFunctions.convertURItoBlob(pictureFile)
    const photoURL50 = await HelperFunctions.convertURItoBlob(resized50)
    const photoURL300 = await HelperFunctions.convertURItoBlob(resized300)

    return [photoURL, photoURL50, photoURL300]
}

export async function updateContactPhotoFeedsChain(projectId, contact, contactId, urlList) {
    const batch = new BatchWrapper(db)
    const followContactData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
        feedCreator: store.getState().loggedUser,
    }

    await createContactPictureChangedFeed(projectId, contact, contactId, urlList[3], contact.photoURL50, batch)
    await tryAddFollower(projectId, followContactData, batch)

    batch.commit()
}

export async function watchFollowedUsers(projectId, userId, callback) {
    const unsub = db.doc(`usersFollowing/${projectId}/entries/${userId}`).onSnapshot(doc => {
        const users = doc.data()?.users || {}
        callback(projectId, users)
    })

    if (followedUsersUnsubs[projectId]) {
        followedUsersUnsubs[projectId][userId] = unsub
    } else {
        followedUsersUnsubs[projectId] = { [userId]: unsub }
    }

    return unsub
}

export async function unwatchFollowedUsers(projectId, userId) {
    if (followedUsersUnsubs && followedUsersUnsubs[projectId] && followedUsersUnsubs[projectId][userId]) {
        followedUsersUnsubs[projectId][userId]()
    }
}

export async function watchFollowedContacts(projectId, userId, callback) {
    const unsub = db.doc(`usersFollowing/${projectId}/entries/${userId}`).onSnapshot(doc => {
        const contacts = doc.data()?.contacts || {}
        callback(projectId, contacts)
    })

    if (followedContactsUnsubs[projectId]) {
        followedContactsUnsubs[projectId][userId] = unsub
    } else {
        followedContactsUnsubs[projectId] = { [userId]: unsub }
    }

    return unsub
}

export async function unwatchFollowedContacts(projectId, userId) {
    if (followedContactsUnsubs && followedContactsUnsubs[projectId] && followedContactsUnsubs[projectId][userId]) {
        followedContactsUnsubs[projectId][userId]()
    }
}

export async function watchProjectInvitations(projectId, callback, watcherKey) {
    globalWatcherUnsub[watcherKey] = firebase
        .firestore()
        .collection(`/projectsInvitation/${projectId}/invitations`)
        .onSnapshot(async invitationList => {
            const invitations = []
            invitationList.forEach(invitation => {
                invitations.push({ id: invitation.id, ...invitation.data() })
            })
            callback(invitations)
        })
}

export async function watchProjectMeetings(projectId, callback, watcherKey) {
    globalWatcherUnsub[watcherKey] = firebase
        .firestore()
        .collection(`events/${projectId}/rooms`)
        .onSnapshot(docs => {
            const meetings = []
            docs.forEach(doc => {
                meetings.push(doc.data())
            })
            callback(meetings)
        })
}

export function proccessAssistantDialyTopicIfNeeded() {
    const { loggedUser } = store.getState()
    const { dailyTopicDate, previousDailyTopicDate, defaultProjectId } = loggedUser

    const dateIsUpdated = moment(dailyTopicDate).isSame(moment(), 'day')
    if (dateIsUpdated) {
        createBotDailyTopic(defaultProjectId, previousDailyTopicDate)
    } else {
        setUserDailyTopicDate(dailyTopicDate)
        createBotDailyTopic(defaultProjectId, dailyTopicDate)
    }
}

export async function getAllUserProjects(userId) {
    const projectsDocs = (await db.collection('projects').where('userIds', 'array-contains', userId).get()).docs
    const projects = []
    projectsDocs.forEach(doc => {
        projects.push(mapProjectData(doc.id, doc.data()))
    })
    return projects
}

export async function getUserOrContactBy(projectId, userId) {
    if (isWorkstream(userId)) {
        const ws = await getWorkstreamData(projectId, userId)
        return ws
    }

    const promises = [
        getUserData(userId, false),
        getContactData(projectId, userId),
        getAssistantData(projectId, userId),
        getAssistantData(GLOBAL_PROJECT_ID, userId),
    ]
    const [user, contact, assistant, globalAssistant] = await Promise.all(promises)

    return user || contact || assistant || globalAssistant
}

export async function watchLoggedUser(userId, callback) {
    loggedUserUnsub = firebase
        .firestore()
        .doc(`/users/${userId}`)
        .onSnapshot(snapshot => {
            const user = snapshot.data()
            callback(user ? mapUserData(userId, user, true) : null)
        })
}

export async function getGuides(templateId) {
    const projectDocs = (await db.collection('projects').where('parentTemplateId', '==', templateId).get()).docs

    const guides = []
    projectDocs.forEach(doc => {
        const guide = mapProjectData(doc.id, doc.data())
        const userProject = ProjectHelper.getProjectById(doc.id)
        if (userProject) guide.index = userProject.index
        guides.push(guide)
    })
    return guides
}

export async function getProjects() {
    return (await db.collection('/projects').get()).docs
}

export async function getProjectBy(projectId) {
    return (await db.doc(`/projects/${projectId}`).get()).data()
}

export async function getProjectData(projectId) {
    const project = (await db.doc(`/projects/${projectId}`).get()).data()
    return project ? mapProjectData(projectId, project) : null
}

export function watchBacklinksCount(projectId, linkedParentObject, callback, watcherKey) {
    const { idsField, id: objectId } = linkedParentObject

    backlinksCounterUnsub[watcherKey || objectId] = { tasks: null, notes: null }

    backlinksCounterUnsub[watcherKey || objectId].tasks = db
        .collection(`items/${projectId}/tasks`)
        .where(idsField, 'array-contains', objectId)
        .where('parentId', '==', null)
        .onSnapshot(snapshots => {
            const tasksDocs = snapshots.docs
            const tasksAmount = tasksDocs.length
            const aloneTask = tasksAmount === 1 ? mapTaskData(tasksDocs[0].id, tasksDocs[0].data()) : null
            callback('tasks', tasksAmount, aloneTask)
        })

    backlinksCounterUnsub[watcherKey || objectId].notes = db
        .collection(`noteItems/${projectId}/notes`)
        .where(idsField, 'array-contains', objectId)
        .onSnapshot(snapshots => {
            const notesDocs = snapshots.docs
            const notesAmount = notesDocs.length
            const aloneNote = notesAmount === 1 ? mapNoteData(notesDocs[0].id, notesDocs[0].data()) : null
            callback('notes', notesAmount, aloneNote)
        })
}

export function unwatchBacklinksCount(objectId, watcherKey) {
    if (backlinksCounterUnsub[watcherKey || objectId]) {
        backlinksCounterUnsub[watcherKey || objectId]['tasks']
            ? backlinksCounterUnsub[watcherKey || objectId]['tasks']()
            : null
        backlinksCounterUnsub[watcherKey || objectId]['notes']
            ? backlinksCounterUnsub[watcherKey || objectId]['notes']()
            : null
        delete backlinksCounterUnsub[watcherKey || objectId]
    }
}

export function watchLinkedTasks(projectId, linkedParentObject, callback) {
    const unsub = db
        .collection(`items/${projectId}/tasks`)
        .where(linkedParentObject.idsField, 'array-contains', linkedParentObject.id)
        .where('parentId', '==', null)
        .onSnapshot(() => {
            db.collection(`items/${projectId}/tasks`)
                .where(linkedParentObject.idsField, 'array-contains', linkedParentObject.id)
                .where('parentId', '==', null)
                .get()
                .then(res => {
                    callback(res.docs)
                })
        })
    linkedTasksUnsub = unsub
}

export function unwatchLinkedTasks() {
    linkedTasksUnsub()
    linkedTasksUnsub = () => {}
}

export function watchProject(projectId, callback, watcherKey) {
    globalWatcherUnsub[watcherKey] = db.doc(`projects/${projectId}`).onSnapshot(doc => {
        const data = doc.data()
        const project = data ? mapProjectData(projectId, doc.data()) : null
        callback(project)
    })
}

export async function setProjectDescription(projectId, newDescription, project, oldDescription) {
    const batch = new BatchWrapper(db)
    await createProjectDescriptionChangedFeed(projectId, project, newDescription, oldDescription, batch)
    const followProjectData = {
        followObjectsType: FOLLOWER_PROJECTS_TYPE,
        followObjectId: projectId,
        followObject: project,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followProjectData, batch)
    batch.update(db.doc(`projects/${projectId}`), { description: newDescription })
    batch.commit()
}

export async function createDefaultProject(user) {
    const project = ProjectHelper.getNewDefaultProject()
    project.name = 'Private life'
    project.creatorId = user.uid
    project.userIds = [user.uid]
    await uploadNewProject(project, user, [user.uid], true, false)
}

const reloadApp = () => {
    URLTrigger.processUrl(NavigationService, '/projects/tasks/open')
    setTimeout(() => {
        window.location.reload()
    })
}

export const watchForceReload = async (userId, deleteOldData) => {
    if (deleteOldData) await db.doc(`userForceReloads/${userId}`).delete()
    db.doc(`userForceReloads/${userId}`).onSnapshot(doc => {
        const data = doc.data()
        if (data && data.reload) reloadApp()
    })
}

export const forceUsersToReloadApp = async (userIds, externalBatch) => {
    const batch = externalBatch ? externalBatch : new BatchWrapper(db)
    userIds.forEach(uid => {
        batch.set(db.doc(`userForceReloads/${uid}`), { reload: true })
    })
    if (!externalBatch) await batch.commit()
}

export async function removeProject(projectId) {
    unwatchProjectData(projectId)

    const { loggedUserProjectsMap, loggedUser } = store.getState()

    const project = loggedUserProjectsMap[projectId]

    const batch = new BatchWrapper(db)

    if (project.userIds) unlinkDeletedProjectFromMembers(projectId, batch, project.userIds)
    await unlinkDeletedProjectFromInvitedUsers(projectId, batch)

    if (project.parentTemplateId) {
        batch.update(db.doc(`projects/${project.parentTemplateId}`), {
            guideProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
        })
    }

    batch.delete(db.doc(`projects/${projectId}`))

    const promises = []
    project.userIds.forEach(userId => {
        const user = TasksHelper.getUserInProject(projectId, userId)
        promises.push(updateDefaultProjectIfNeeded(projectId, user))
    })
    await Promise.all(promises)

    URLTrigger.processUrl(NavigationService, '/projects/tasks/open')

    const userIdsToReload = project.userIds.filter(userId => userId !== loggedUser.uid)
    forceUsersToReloadApp(userIdsToReload, batch)
    await batch.commit()
    setTimeout(() => {
        window.location.reload()
    })
}

export async function unlinkDeletedProjectFromMembers(projectId, batch, userIds) {
    for (let i = 0; i < userIds.length; i++) {
        const uid = userIds[i]

        let updateData = {
            projectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
            archivedProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
            templateProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
            guideProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
            copyProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
            invitedProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
            [`workflow.${projectId}`]: firebase.firestore.FieldValue.delete(),
            [`workstreams.${projectId}`]: firebase.firestore.FieldValue.delete(),
            [`lastVisitBoard.${projectId}`]: firebase.firestore.FieldValue.delete(),
            [`lastVisitBoardInGoals.${projectId}`]: firebase.firestore.FieldValue.delete(),
            [`quotaWarnings.${projectId}`]: firebase.firestore.FieldValue.delete(),
            [`statisticsSelectedUsersIds.${projectId}`]: firebase.firestore.FieldValue.delete(),
            [`apisConnected.${projectId}`]: firebase.firestore.FieldValue.delete(),
            [`unlockedKeysByGuides.${projectId}`]: firebase.firestore.FieldValue.delete(),
            [`commentsData.${projectId}`]: firebase.firestore.FieldValue.delete(),
            [`lastAssistantCommentData.${projectId}`]: firebase.firestore.FieldValue.delete(),
        }

        const user = TasksHelper.getUserInProject(projectId, uid)
        if (user?.lastAssistantCommentData[ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY]?.projectId === projectId) {
            updateData = {
                ...updateData,
                [`lastAssistantCommentData.${ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY}`]: firebase.firestore.FieldValue.delete(),
            }
        }
        batch.update(db.doc(`users/${uid}`), updateData)
    }
}

export async function unlinkDeletedProjectFromInvitedUsers(projectId, batch) {
    const userDocs = await getUsersInvitedToProject(projectId, true)

    userDocs.forEach(doc => {
        removeUserInvitationToProject(projectId, doc.id, batch)
    })
}

export async function createMentionTasksAfterSetTaskPublic(projectId, task, isPrivate, isPublicFor) {
    if (!isPrivate || !isEqual(task.isPublicFor, isPublicFor)) {
        let newMentions = []
        const mentionedUserIds = TasksHelper.getMentionIdsFromTitle(task.extendedName)

        if (!isPrivate) {
            // mentions after put task public again
            newMentions = mentionedUserIds.filter(userId => !isPublicFor.includes(userId))
        } else if (!isEqual(task.isPublicFor, isPublicFor)) {
            // mentions after add some users to isPublicFor
            newMentions = mentionedUserIds.filter(
                userId => !task.isPublicFor.includes(userId) && isPublicFor.includes(userId)
            )
        }

        if (newMentions.length > 0) {
            createGenericTaskWhenMention(projectId, task.id, newMentions, GENERIC_TASK_TYPE, 'tasks', task.assistantId)
        }
    }
}

async function setFollowersByMentions(projectId, mentionedUserIds, followData, batch) {
    const { loggedUser, projectUsers } = store.getState()

    if (mentionedUserIds) {
        for (let i = 0; i < projectUsers[projectId].length; i++) {
            const user = projectUsers[projectId][i]
            if (mentionedUserIds.includes(user.uid) && user.uid !== loggedUser.uid) {
                followData.feedCreator = user
                await tryAddFollower(projectId, followData, batch)
            }
        }
    }
}

export async function feedsChainInStopObservingTask(
    projectId,
    task,
    userIdStopingObserving,
    assigneeEstimation,
    updateEstimation
) {
    const { loggedUser } = store.getState()

    const feedBatch = new BatchWrapper(db)
    if (updateEstimation) {
        await createTaskAssigneeEstimationChangedFeed(
            projectId,
            task.id,
            task.estimations[OPEN_STEP],
            assigneeEstimation,
            feedBatch
        )
    }

    if (userIdStopingObserving) {
        const observersIds = task.observersIds.filter(observerId => observerId !== userIdStopingObserving)
        await registerTaskObservedFeeds(projectId, { ...task, observersIds }, task, feedBatch)
    }

    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: task.id,
        followObject: task,
        feedCreator: loggedUser,
    }
    await tryAddFollower(projectId, followTaskData, feedBatch)
    feedBatch.commit()
}

export const updateTaskFeedsChain = async (
    projectId,
    task,
    oldTask,
    oldAssignee,
    comment,
    commentMentions,
    taskId,
    newAssignee,
    isObservedTask
) => {
    const { loggedUser, currentUser } = store.getState()
    const batch = new BatchWrapper(db)

    const privacyWasUpdated = task.isPrivate !== oldTask.isPrivate || !isEqual(task.isPublicFor, oldTask.isPublicFor)

    const mentionedUserIds = getMentionedUsersIdsWhenEditText(task.extendedName, oldTask.extendedName)
    insertFollowersUserToFeedChain(
        mentionedUserIds,
        commentMentions,
        [task.userId !== oldTask.userId && task.userId !== loggedUser.uid ? task.userId : ''],
        taskId,
        batch
    )

    await registerTaskObservedFeeds(projectId, task, oldTask, batch)

    if (privacyWasUpdated) {
        await createTaskPrivacyChangedFeed(projectId, taskId, task.isPrivate, task.isPublicFor, batch)
        createMentionTasksAfterSetTaskPublic(projectId, oldTask, task.isPrivate, task.isPublicFor)
    }

    if (task.extendedName !== oldTask.extendedName) {
        await createTaskNameChangedFeed(projectId, task, oldTask.extendedName, task.extendedName, taskId, batch)
        createGenericTaskWhenMentionInTitleEdition(
            projectId,
            taskId,
            task.extendedName,
            oldTask.extendedName,
            GENERIC_TASK_TYPE,
            'tasks',
            task.assistantId
        )
    }

    if (comment) {
        createObjectMessage(projectId, taskId, comment, 'tasks', STAYWARD_COMMENT, null, null)
    }

    if (task.hasStar !== oldTask.hasStar) {
        await createTaskHighlightedChangedFeed(projectId, task, taskId, task.hasStar, batch)
    }

    if (task.recurrence !== oldTask.recurrence) {
        await createTaskRecurrenceChangedFeed(projectId, task, taskId, oldTask.recurrence, task.recurrence, batch)
    }

    const stepId = task.stepHistory[task.stepHistory.length - 1]
    if (stepId === OPEN_STEP) {
        if (task.estimations[OPEN_STEP] !== oldTask.estimations[OPEN_STEP]) {
            await createTaskAssigneeEstimationChangedFeed(
                projectId,
                taskId,
                oldTask.estimations[OPEN_STEP],
                task.estimations[OPEN_STEP],
                batch
            )
        }
    } else {
        const oldEstimation = oldTask.estimations[stepId] ? oldTask.estimations[stepId] : 0
        const newEstimation = task.estimations[stepId] ? task.estimations[stepId] : 0

        if (newEstimation !== oldEstimation) {
            await createTaskReviewerEstimationChangedFeed(
                projectId,
                task,
                taskId,
                oldEstimation,
                newEstimation,
                stepId,
                batch
            )
        }
    }

    if (isObservedTask) {
        const observerOldEstimation = oldTask.estimationsByObserverIds[currentUser.uid] || 0
        const observerNewEstimation = task.estimationsByObserverIds[currentUser.uid] || 0

        const updatedEstimationInObservedTask = observerNewEstimation !== observerOldEstimation

        if (updatedEstimationInObservedTask) {
            await createTaskObserverEstimationChangedFeed(
                projectId,
                taskId,
                observerOldEstimation,
                observerNewEstimation,
                batch
            )
        }
    }

    if (task.userId !== oldTask.userId) {
        if (
            task.userId !== loggedUser.uid &&
            !isWorkstream(newAssignee.uid) &&
            !mentionedUserIds.includes(newAssignee.uid)
        ) {
            const followTaskData = {
                followObjectsType: FOLLOWER_TASKS_TYPE,
                followObjectId: taskId,
                followObject: task,
                feedCreator: newAssignee,
            }
            await tryAddFollower(projectId, followTaskData, batch)
        }
        await createTaskAssigneeChangedFeed(projectId, task, newAssignee, oldAssignee, taskId, batch)
    }

    const updatedDueDate = task.dueDate !== oldTask.dueDate
    const updatedDueDateInObservedTask =
        isObservedTask && task.dueDateByObserversIds[currentUser.uid] !== oldTask.dueDateByObserversIds[currentUser.uid]

    if (updatedDueDate || updatedDueDateInObservedTask) {
        await createTaskDueDateChangedFeed(
            projectId,
            task,
            isObservedTask ? task.dueDateByObserversIds[currentUser.uid] : task.dueDate,
            isObservedTask ? oldTask.dueDateByObserversIds[currentUser.uid] : oldTask.dueDate,
            taskId,
            batch,
            null,
            isObservedTask
                ? task.dueDateByObserversIds[currentUser.uid] === Number.MAX_SAFE_INTEGER
                : task.dueDate === Number.MAX_SAFE_INTEGER,
            isObservedTask
                ? oldTask.dueDateByObserversIds[currentUser.uid] === Number.MAX_SAFE_INTEGER
                : oldTask.dueDate === Number.MAX_SAFE_INTEGER,
            isObservedTask
        )
    }

    if (task.parentGoalId !== oldTask.parentGoalId) {
        await createTaskParentGoalChangedFeed(
            projectId,
            task,
            task.parentGoalId,
            oldTask.parentGoalId,
            taskId,
            true,
            batch
        )
    }

    await processFollowersWhenEditTexts(projectId, FOLLOWER_TASKS_TYPE, taskId, task, mentionedUserIds, true, batch)
    batch.commit()
}

export function logDoneTasks(taskOwnerUid, effectingUserUid, isInWorkflow) {
    logEvent('done_task', { taskOwnerUid, effectingUserUid, isInWorkflow })
}

const getAllTasksFromGoalInBoardInTodayOrOverdue = async (projectId, goalId, userId) => {
    const { loggedUser } = store.getState()
    const endOfDay = moment().endOf('day').valueOf()
    const tasksDocs = (
        await db
            .collection(`items/${projectId}/tasks`)
            .where('parentGoalId', '==', goalId)
            .where('done', '==', false)
            .where('completed', '==', null)
            .where('isSubtask', '==', false)
            .where('currentReviewerId', '==', userId)
            .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUser.uid])
            .where('dueDate', '<=', endOfDay)
            .get()
    ).docs
    const tasks = []
    tasksDocs.forEach(doc => {
        tasks.push(mapTaskData(doc.id, doc.data()))
    })
    return tasks
}

export const moveToTomorrowGoalReminderDateIfThereAreNotMoreTasks = async (projectId, task) => {
    const { dueDate, userId, parentGoalId } = task
    const endOfDay = moment().endOf('day').valueOf()
    const taskType = getTaskTypeIndex(task, false, false)
    if (parentGoalId && dueDate <= endOfDay && taskType === MAIN_TASK_INDEX) {
        const promises = []
        promises.push(Backend.getGoalData(projectId, parentGoalId))
        promises.push(getAllTasksFromGoalInBoardInTodayOrOverdue(projectId, parentGoalId, userId))
        const [goal, tasks] = await Promise.all(promises)
        const tasksLeft = tasks.filter(t => t.id !== task.id)

        const { assigneesReminderDate, assigneesIds } = goal
        if (tasksLeft.length === 0 && assigneesIds.includes(userId) && assigneesReminderDate[userId] <= endOfDay) {
            const tomorrow = moment().add(1, 'day').valueOf()
            Backend.updateGoalAssigneeReminderDate(projectId, parentGoalId, userId, tomorrow)
        }
    }
}

export async function moveTasksinWorkflowFeedsChain(projectId, task, stepToMoveId, workflow, estimations) {
    const { loggedUser } = store.getState()
    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: task.id,
        followObject: task,
        feedCreator: loggedUser,
    }

    const batch = new BatchWrapper(db)

    batch.feedChainFollowersIds = { [task.id]: [loggedUser.uid] }

    await tryAddFollower(projectId, followTaskData, batch)

    if (!task.done) {
        const currentStepId = task.stepHistory[task.stepHistory.length - 1]
        const oldEstimation = task.estimations[currentStepId] ? task.estimations[currentStepId] : 0
        const newEstimation = estimations[currentStepId] ? estimations[currentStepId] : 0
        if (oldEstimation !== newEstimation) {
            currentStepId === OPEN_STEP
                ? await createTaskAssigneeEstimationChangedFeed(projectId, task.id, oldEstimation, newEstimation, batch)
                : await createTaskReviewerEstimationChangedFeed(
                      projectId,
                      task.id,
                      oldEstimation,
                      newEstimation,
                      currentStepId,
                      batch
                  )
        }
    }

    if (stepToMoveId === OPEN_STEP) {
        await createTaskUncheckedDoneFeed(projectId, task, task.id, batch, null)
    } else if (stepToMoveId === DONE_STEP) {
        await createTaskCheckedDoneFeed(projectId, task, task.id, batch, null)
    } else {
        await createTaskMovedInWorkflowFeed(projectId, task, task.id, workflow, stepToMoveId, batch, null)
    }

    batch.commit()
}

export async function spentGold(userId, goldToReduce) {
    db.doc(`users/${userId}`).update({ gold: firebase.firestore.FieldValue.increment(-goldToReduce) })
    logEvent('SpentGold', {
        userId,
        spentGold: goldToReduce,
    })
}

export function earnGold(projectId, userId, maxGold, checkBoxId) {
    const { selectedSidebarTab, loggedUser, route } = store.getState()

    //VALUES ARE IN THE RANGE OF 1-maxGold (INCLUDED maxGold)
    const gold = Math.floor(Math.random() * maxGold) + 1

    const goldToIncrease = gold > loggedUser.dailyGold ? loggedUser.dailyGold : gold

    if (goldToIncrease > 0) {
        if (userId === loggedUser.uid && checkBoxId) {
            store.dispatch(setTriggerGoldAnimation(goldToIncrease, checkBoxId))
        }

        const date = moment()
        const slimDate = date.format('DDMMYYYY')
        const dayDate = parseInt(date.format('YYYYMMDD'))
        const timestamp = date.valueOf()

        runHttpsCallableFunction('earnGoldSecondGen', { projectId, userId, gold, slimDate, timestamp, dayDate })
    }
}

export async function updateStatistics(
    projectId,
    taskOwnerUid,
    estimation,
    subtract,
    onlyEstimation,
    completed,
    batch
) {
    // "estimation" comes in minutes
    const date = completed ? moment(completed) : moment()
    const slimDate = date.format('DDMMYYYY')
    const dayDate = parseInt(date.format('YYYYMMDD'))
    const timestamp = date.valueOf()

    let donePoints = 0
    if (estimation > ESTIMATION_16_HOURS) {
        donePoints = estimation / 60
    } else {
        donePoints = getEstimationRealValue(null, estimation, ESTIMATION_TYPE_POINTS)
    }

    const statistics = {
        doneTasks: firebase.firestore.FieldValue.increment(subtract ? -1 : 1),
        donePoints: firebase.firestore.FieldValue.increment(subtract ? -donePoints : donePoints),
        doneTime: firebase.firestore.FieldValue.increment(subtract ? -estimation : estimation),
        timestamp,
        day: dayDate,
    }

    if (onlyEstimation) {
        delete statistics.doneTasks
    }
    batch.set(db.doc(`statistics/${projectId}/${taskOwnerUid}/${slimDate}`), statistics, { merge: true })
}

export async function createSubtasksCopies(
    oldProjectId,
    newProjectId,
    taskId,
    parentTask,
    subtaskIds,
    extraData,
    tryToGenerateBotAdvaice,
    resetDoneState
) {
    const newParentTask = { ...parentTask, id: taskId }

    let promises = subtaskIds.map(subtaskId => getTaskData(oldProjectId, subtaskId))
    const subtasks = await Promise.all(promises)

    promises = subtasks.map(subtask => {
        if (subtask) {
            delete subtask.id
            subtask.done = resetDoneState ? false : subtask.done
            subtask.created = newParentTask.created
            subtask.subtaskIds = []
            return uploadNewSubTask(
                newProjectId,
                newParentTask,
                extraData ? { ...subtask, ...extraData } : subtask,
                true,
                tryToGenerateBotAdvaice
            )
        }
    })
    await Promise.all(promises)
}

export async function setTaskProjectFeedsChain(currentProject, newProject, task, oldAssignee, newAssignee) {
    const batchFeed = new BatchWrapper(db)

    await createTaskProjectChangedFeed(
        currentProject.id,
        task,
        task.id,
        'to',
        newProject.name,
        newProject.color,
        batchFeed
    )
    await createTaskProjectChangedFeed(
        newProject.id,
        task,
        task.id,
        'from',
        currentProject.name,
        currentProject.color,
        batchFeed
    )

    if (oldAssignee && newAssignee) {
        await createTaskAssigneeChangedFeed(newProject.id, task, newAssignee, oldAssignee, task.id, batchFeed)
    }

    const followCurrentTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: task.parentId ? task.parentId : task.id,
        followObject: task.parentId ? await getTaskData(currentProject.id, task.parentId) : task,
        feedCreator: store.getState().loggedUser,
    }
    const followNewTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: task.id,
        followObject: task,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(currentProject.id, followCurrentTaskData, batchFeed)
    await tryAddFollower(newProject.id, followNewTaskData, batchFeed)
    batchFeed.commit()
}

export async function setTaskParentGoalMultiple(tasks, goal) {
    const batch = new BatchWrapper(db)
    const goalId = goal ? goal.id : null
    const parentGoalIsPublicFor = goal ? goal.isPublicFor : null
    const lockKey = goal && goal.lockKey ? goal.lockKey : ''
    const promises = []
    for (let task of tasks) {
        promises.push(setTaskParentGoal(task.projectId, task.id, task, goal, batch))
        task.parentGoalId = goalId
        task.parentGoalIsPublicFor = parentGoalIsPublicFor
        task.lockKey = lockKey
    }
    await Promise.all(promises)
    store.dispatch(updateAllSelectedTasks(tasks))
    batch.commit()
}

export const setTaskParentGoalFeedsChain = async (projectId, taskId, newParentGoalId, oldParentGoalId, task) => {
    const batch = new BatchWrapper(db)

    await createTaskParentGoalChangedFeed(projectId, task, newParentGoalId, oldParentGoalId, taskId, true, batch)
    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: taskId,
        followObject: task,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followTaskData, batch)
    batch.commit()
}

export const setTaskDueDateFeedsChain = async (projectId, taskId, dueDate, task, isObservedTask) => {
    const { currentUser } = store.getState()
    const batch = new BatchWrapper(db)
    await createTaskDueDateChangedFeed(
        projectId,
        task,
        dueDate,
        isObservedTask ? task.dueDateByObserversIds[currentUser.uid] : task.dueDate,
        taskId,
        batch,
        null,
        false,
        isObservedTask
            ? task.dueDateByObserversIds[currentUser.uid] === Number.MAX_SAFE_INTEGER
            : task.dueDate === Number.MAX_SAFE_INTEGER,
        isObservedTask
    )
    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: taskId,
        followObject: task,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followTaskData, batch)
    batch.commit()
}

export const setTaskAlertFeedsChain = async (projectId, taskId, alertEnabled, alertTime, task) => {
    const batch = new BatchWrapper(db)
    await createTaskAlertChangedFeed(projectId, task, alertEnabled, alertTime, taskId, batch, null)
    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: taskId,
        followObject: task,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followTaskData, batch)
    batch.commit()
}

export async function setTaskDueDateMultiple(tasks, dueDate) {
    const sortedTasks = [...tasks].sort((a, b) => a.sortIndex - b.sortIndex)
    const batch = new BatchWrapper(db)
    const promises = []
    for (let task of sortedTasks) {
        const newDueDate = dueDate ? dueDate : task.newDueDate
        promises.push(setTaskDueDate(task.projectId, task.id, newDueDate, task, task.isObservedTask, batch))
    }
    await Promise.all(promises)
    await batch.commit()
}

export const setTaskToBacklogFeedsChain = async (projectId, taskId, task, isObservedTask) => {
    const { currentUser } = store.getState()
    const batch = new BatchWrapper(db)
    await createTaskDueDateChangedFeed(
        projectId,
        task,
        isObservedTask ? task.dueDateByObserversIds[currentUser.uid] : task.dueDate,
        isObservedTask ? task.dueDateByObserversIds[currentUser.uid] : task.dueDate,
        taskId,
        batch,
        null,
        true,
        false,
        isObservedTask
    )
    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: taskId,
        followObject: task,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followTaskData, batch)
    batch.commit()
}

export async function setTaskToBacklogMultiple(tasks) {
    const batch = new BatchWrapper(db)
    const promises = []
    for (let task of tasks) {
        promises.push(setTaskToBacklog(task.projectId, task.id, task, task.isObservedTask, batch))
    }
    await Promise.all(promises)
    await batch.commit()
}

/**
 * DEPRECATED at 07/05/2021
 * Remove after 2 Months [07/07/2021]
 * @param projectId
 * @param taskId
 * @param shared
 * @param task
 * @returns {Promise<void>}
 */

export async function removeNoteFromInnerTasks(projectId, noteId) {
    const tasks = await getNoteInnerTasks(projectId, noteId)
    const promises = []
    tasks.forEach(task => {
        promises.push(setTaskContainerNotesIds(projectId, task.id, noteId, 'remove', false))
    })
    await Promise.all(promises)
}

function addNoteToInnerTasks(projectId, noteId, tasksIds) {
    tasksIds.forEach(taskId => {
        setTaskContainerNotesIds(projectId, taskId, noteId, 'add', false)
    })
}

const getNoteDelta = noteData => {
    const ydoc = new Y.Doc()
    const update = new Uint8Array(noteData)

    if (update.length > 0) {
        Y.applyUpdate(ydoc, update)
    }

    const type = ydoc.getText('quill')
    const contentDelta = type.toDelta()
    ydoc.destroy()
    return contentDelta
}

async function updateInnerTasksWhenRestoreNote(projectId, noteId, restoredContent) {
    await removeNoteFromInnerTasks(projectId, noteId)
    const noteDelta = getNoteDelta(restoredContent)
    const tasksIds = []
    noteDelta.forEach(op => {
        const { insert } = op
        const { taskTagFormat } = insert
        if (taskTagFormat) {
            tasksIds.push(taskTagFormat.taskId)
        }
    })
    addNoteToInnerTasks(projectId, noteId, tasksIds)
}

async function getNoteInnerTasks(projectId, noteId) {
    const tasksDocs = (
        await db.collection(`items/${projectId}/tasks`).where('containerNotesIds', 'array-contains-any', [noteId]).get()
    ).docs

    const tasks = []
    tasksDocs.forEach(doc => {
        tasks.push(mapTaskData(doc.id, doc.data()))
    })
    return tasks
}

export function watchNoteInnerTasks(projectId, noteId, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = db
        .collection(`/items/${projectId}/tasks`)
        .where('containerNotesIds', 'array-contains-any', [noteId])
        .onSnapshot(tasksDocs => {
            const tasks = {}
            tasksDocs.forEach(doc => {
                const task = mapTaskData(doc.id, doc.data())
                tasks[task.id] = task
            })
            callback(tasks)
        })
}

export async function setTaskContainerNotesIds(projectId, taskId, noteId, action, checkTaskExitenceWhenRemove) {
    if (action === 'add') {
        await db.doc(`items/${projectId}/tasks/${taskId}`).update({
            containerNotesIds: firebase.firestore.FieldValue.arrayUnion(noteId),
        })
    } else {
        if (checkTaskExitenceWhenRemove) {
            const task = (await db.doc(`items/${projectId}/tasks/${taskId}`).get()).data()
            if (task) {
                await db.doc(`items/${projectId}/tasks/${taskId}`).update({
                    containerNotesIds: firebase.firestore.FieldValue.arrayRemove(noteId),
                })
            }
        } else {
            await db.doc(`items/${projectId}/tasks/${taskId}`).update({
                containerNotesIds: firebase.firestore.FieldValue.arrayRemove(noteId),
            })
        }
    }
}

export async function getTasksByProject(projectId) {
    const tasksInProject = []
    const projectTasks = (await db.collection(`/items/${projectId}/tasks`).orderBy('created', 'asc').get()).docs

    for (let taskDoc of projectTasks) {
        tasksInProject.push(mapTaskData(taskDoc.id, taskDoc.data()))
    }

    return tasksInProject
}

export async function getSubTasksListDirectly(projectId, taskId) {
    const subtasksDocs = await db.collection(`/items/${projectId}/tasks`).where('parentId', '==', taskId).get()
    const subtasks = []
    subtasksDocs.forEach(subtaskDoc => {
        subtasks.push(mapTaskData(subtaskDoc.id, subtaskDoc.data()))
    })
    return subtasks
}

export function watchGoalLinkedTasks(projectId, goalId, callback, watcherKey) {
    store.dispatch(startLoadingData())
    const loggedUserId = store.getState().loggedUser.uid
    globalWatcherUnsub[watcherKey] = db
        .collection(`/items/${projectId}/tasks`)
        .where('parentGoalId', '==', goalId)
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .orderBy('created', 'desc')
        .onSnapshot(snapshot => {
            const tasks = []
            for (let doc of snapshot.docs) {
                tasks.push(mapTaskData(doc.id, doc.data()))
            }
            store.dispatch(stopLoadingData())
            callback(tasks)
        })
}

export function watchGoalLinkedOpenTasksAmount(projectId, goalId, callback, watcherKey) {
    const loggedUserId = store.getState().loggedUser.uid
    globalWatcherUnsub[watcherKey] = db
        .collection(`/items/${projectId}/tasks`)
        .where('parentGoalId', '==', goalId)
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .where('completed', '==', null)
        .where('isSubtask', '==', false)
        .onSnapshot(snapshot => {
            callback(snapshot.docs.length)
        })
}

export function watchSubtasksList(projectId, taskId, callback) {
    store.dispatch(startLoadingData())
    const loggedUserId = store.getState().loggedUser.uid
    watchSubtaskList[taskId] = db
        .collection(`/items/${projectId}/tasks`)
        .where('parentId', '==', taskId)
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .orderBy('sortIndex', 'desc')
        .onSnapshot(snapshot => {
            const subTasksList = []
            for (let doc of snapshot.docs) {
                subTasksList.push(mapTaskData(doc.id, doc.data()))
            }
            store.dispatch(stopLoadingData())
            callback(subTasksList)
        })
}

export function unwatchSubtasksList(taskId) {
    if (watchSubtaskList[taskId]) {
        watchSubtaskList[taskId]()
        delete watchSubtaskList[taskId]
    }
}

export async function onSingleTaskChange(projectId, taskId, callback) {
    const unsub = db.doc(`/items/${projectId}/tasks/${taskId}`).onSnapshot(snapshot => {
        let task = null
        if (snapshot.data() !== undefined) {
            task = mapTaskData(snapshot.id, snapshot.data())
        }
        callback(task)
    })

    singleTaskUnsub = unsub
}

export async function offOnSingleTaskChange() {
    singleTaskUnsub()
}

export async function getTaskData(projectId, taskId) {
    const task = (await db.doc(`/items/${projectId}/tasks/${taskId}`).get()).data()
    return task ? mapTaskData(taskId, task) : null
}

export function watchUserData(userId, isLoggedUser, callback, watcherKey) {
    globalWatcherUnsub[watcherKey] = db.doc(`users/${userId}`).onSnapshot(doc => {
        const user = doc.exists ? mapUserData(userId, doc.data(), isLoggedUser) : null
        if (user || !doc.metadata.fromCache) callback(user)
    })
}

export async function getNote(projectId, noteId) {
    const note = (await db.doc(`noteItems/${projectId}/notes/${noteId}`).get()).data()
    return note ? mapNoteData(noteId, note) : null
}

export async function createUploadNewUserFeeds(user, uid, newProjectId, newProject, taskId, firstTask) {
    const feedBatch = new BatchWrapper(db)
    const feedCreator = { ...user, uid }
    const followProjectData = {
        followObjectsType: FOLLOWER_PROJECTS_TYPE,
        followObjectId: newProjectId,
        followObject: newProject,
        feedCreator,
    }
    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: taskId,
        followObject: firstTask,
        feedCreator,
    }
    const followUserData = {
        followObjectsType: FOLLOWER_USERS_TYPE,
        followObjectId: uid,
        followObject: feedCreator,
        feedCreator,
    }
    await createProjectCreatedFeed(newProjectId, newProject, feedBatch, feedCreator, null)
    await addFollower(newProjectId, followProjectData, feedBatch)
    await createUserJoinedFeed(newProjectId, feedBatch, feedCreator)
    await addFollower(newProjectId, followUserData, feedBatch)
    await createTaskCreatedFeed(newProjectId, firstTask, taskId, feedBatch, feedCreator)
    await addFollower(newProjectId, followTaskData, feedBatch)
    feedBatch.commit()
}

export const addWorkflowStepFeedChain = async (projectId, reviewerUid, userId, description) => {
    await createWorkflowStepFeed(projectId, reviewerUid, userId, description, FEED_USER_WORKFLOW_ADDED)
    const followUserData = {
        followObjectsType: FOLLOWER_USERS_TYPE,
        followObjectId: userId,
        followObject: TasksHelper.getUserInProject(projectId, userId),
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followUserData)
}

export const updateRemovedWorkflowStepTaks = (projectId, tasks, steps, stepId, parentTasksIndices, batch) => {
    for (let taskDoc of tasks) {
        const task = mapTaskData(taskDoc.id, taskDoc.data())

        if (task.userIds.length > 1) {
            const deleteIndex = task.stepHistory.findIndex(sid => sid === stepId)

            if (deleteIndex > -1) {
                task.userIds.splice(deleteIndex, 1)

                if (task.subtaskIds && task.subtaskIds.length > 0) {
                    parentTasksIndices[taskDoc.id] = deleteIndex
                }

                batch.update(db.doc(`items/${projectId}/tasks/${taskDoc.id}`), {
                    stepHistory: firebase.firestore.FieldValue.arrayRemove(stepId),
                    userIds: task.userIds,
                    currentReviewerId: task.userIds[task.userIds.length - 1],
                    [`estimations.${stepId}`]: firebase.firestore.FieldValue.delete(),
                })

                if (task.stepHistory[task.stepHistory.length - 1] === stepId) {
                    let nextStepId = ''
                    let nextReviewerUid = ''
                    for (let i = 0; i < steps.length - 1; ++i) {
                        if (stepId === steps[i].id) {
                            nextStepId = steps[i + 1].id
                            nextReviewerUid = steps[i + 1].reviewerUid
                            break
                        }
                    }
                    if (nextStepId.length > 0) {
                        batch.update(db.doc(`items/${projectId}/tasks/${taskDoc.id}`), {
                            stepHistory: firebase.firestore.FieldValue.arrayUnion(nextStepId),
                            userIds: [...task.userIds, nextReviewerUid],
                            currentReviewerId: nextReviewerUid,
                        })
                    } else {
                        setTaskStatus(projectId, taskDoc.id, true, task.userId, task, '', false, null, null)
                    }
                }
            }
        }
    }

    return batch
}

export const updateRemovedWorkflowStepSubtaks = (projectId, tasks, steps, stepId, parentTasksIndices, batch) => {
    for (let taskDoc of tasks) {
        const task = mapTaskData(taskDoc.id, taskDoc.data())

        if (task.userIds.length > 1) {
            const deleteIndex = parentTasksIndices[task.parentId]
            if (deleteIndex > -1) {
                const isLastStep = deleteIndex === task.userIds.length - 1
                task.userIds.splice(deleteIndex, 1)

                batch.update(db.doc(`items/${projectId}/tasks/${taskDoc.id}`), {
                    userIds: task.userIds,
                    currentReviewerId: task.userIds[task.userIds.length - 1],
                })

                if (isLastStep) {
                    let nextStepId = ''
                    let nextReviewerUid = ''
                    for (let i = 0; i < steps.length - 1; ++i) {
                        if (stepId === steps[i].id) {
                            nextStepId = steps[i + 1].id
                            nextReviewerUid = steps[i + 1].reviewerUid
                            break
                        }
                    }
                    if (nextStepId.length > 0) {
                        batch.update(db.doc(`items/${projectId}/tasks/${taskDoc.id}`), {
                            userIds: [...task.userIds, nextReviewerUid],
                            currentReviewerId: nextReviewerUid,
                        })
                    }
                }
            }
        }
    }

    return batch
}

export const removeWorkflowStepFeedChain = async (projectId, steps, userId, stepId) => {
    const feed = steps.find(item => item.id === stepId)
    await createWorkflowStepFeed(projectId, feed.reviewerUid, userId, feed.description, FEED_USER_WORKFLOW_REMOVE)
    const followUserData = {
        followObjectsType: FOLLOWER_USERS_TYPE,
        followObjectId: userId,
        followObject: TasksHelper.getUserInProject(projectId, userId),
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followUserData)
}

export async function onUserWorkflowChange(uid, callback) {
    if (userWorkflowUnsub) {
        userWorkflowUnsub()
    }
    const unsub = db.doc(`/users/${uid}`).onSnapshot(snapshot => {
        const workflow = snapshot.data().workflow
        callback(workflow)
    })

    userWorkflowUnsub = unsub
}

export async function offOnUserWorkflowChange() {
    userWorkflowUnsub()
}

export async function offOnUserChange() {
    userChangeUnsub()
}

export async function setFutureEstimationsMultiple(tasks, estimation) {
    const taskBatch = new BatchWrapper(db)

    for (const task of tasks) {
        const isInOpen = task.userIds.length === 1 && !task.inDone

        if (isInOpen && !task.calendarData)
            taskBatch.update(db.doc(`/items/${task.projectId}/tasks/${task.id}`), {
                [`estimations.${OPEN_STEP}`]: estimation,
            })
    }
    taskBatch.commit()

    const batch = new BatchWrapper(db)
    for (const task of tasks) {
        const oldEstimation = task.estimations[OPEN_STEP] || 0
        if (oldEstimation !== estimation) {
            await createTaskAssigneeEstimationChangedFeed(task.projectId, task.id, oldEstimation, estimation, batch)
            const followTaskData = {
                followObjectsType: FOLLOWER_TASKS_TYPE,
                followObjectId: task.id,
                followObject: task,
                feedCreator: store.getState().loggedUser,
            }
            await tryAddFollower(task.projectId, followTaskData, batch)
        }
    }
    batch.commit()
}

export function addUniqueInstanceTypeToArray(array, element) {
    if (element && !array.includes(element)) {
        array.push(element)
    }
}

export async function creatTaskFeedChain(projectId, taskId, task) {
    const { loggedUser: feedCreator } = store.getState()
    const assignee =
        feedCreator.uid === task.userId
            ? feedCreator
            : TasksHelper.getUserInProject(projectId, task.userId) ||
              TasksHelper.getContactInProject(projectId, task.userId) ||
              getWorkstreamInProject(projectId, task.userId) ||
              getAssistant(task.userId) ||
              feedCreator

    const batch = new BatchWrapper(db)

    const fullText = task.extendedName + ' ' + task.description
    const mentionedUserIds = getMentionedUsersIdsWhenEditText(fullText, '')
    insertFollowersUserToFeedChain(mentionedUserIds, [], [task.userId], taskId, batch)

    if (feedCreator.uid === task.userId) {
        await createTaskCreatedFeed(projectId, task, taskId, batch, feedCreator)
    } else {
        await createTaskToAnotherUserFeed(projectId, task, taskId, assignee, batch, feedCreator)
    }

    await registerTaskObservedFeeds(projectId, { ...task, id: taskId }, null, batch)

    if (task.isPrivate) {
        await createTaskPrivacyChangedFeed(projectId, taskId, task.isPrivate, task.isPublicFor, batch, feedCreator)
    }

    if (task.description.trim()) {
        await createTaskDescriptionChangedFeed(projectId, task, '', task.description, taskId, batch)
    }

    const todayDate = Date.now()
    if (todayDate < task.dueDate) {
        await createTaskDueDateChangedFeed(
            projectId,
            task,
            task.dueDate,
            todayDate,
            taskId,
            batch,
            feedCreator,
            task.dueDate === Number.MAX_SAFE_INTEGER,
            false,
            false
        )
    }

    if (task.parentGoalId) {
        await createTaskParentGoalChangedFeed(projectId, task, task.parentGoalId, null, taskId, false, batch)
    }

    if (task.hasStar.toLowerCase() !== '#ffffff') {
        await createTaskHighlightedChangedFeed(projectId, task, taskId, task.hasStar, batch, feedCreator)
    }

    if (task.recurrence !== RECURRENCE_NEVER) {
        await createTaskRecurrenceChangedFeed(projectId, task, taskId, RECURRENCE_NEVER, task.recurrence, batch)
    }

    if (task.estimations[OPEN_STEP] !== 0) {
        await createTaskAssigneeEstimationChangedFeed(
            projectId,
            taskId,
            0,
            task.estimations[OPEN_STEP],
            batch,
            feedCreator
        )
    }

    const isUser = !!assignee.lastLogin
    if (isUser && feedCreator.uid !== task.userId && !mentionedUserIds.includes(task.userId)) {
        const followTaskAssigneeData = {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: taskId,
            followObject: task,
            feedCreator: assignee,
        }
        await addFollower(projectId, followTaskAssigneeData, batch)
    }

    await processFollowersWhenEditTexts(projectId, FOLLOWER_TASKS_TYPE, taskId, task, mentionedUserIds, true, batch)
    batch.commit()
}

export async function registerTaskObservedFeeds(projectId, task, oldTask, batch) {
    const { observers, unObservers } = getObserversAndUnobserversLists(task.observersIds, oldTask?.observersIds || [])

    for (let observerId of observers) {
        await createTaskObservedFeed(projectId, task.id, observerId, batch)
    }
    for (let unObserverId of unObservers) {
        await createTaskUnObservedFeed(projectId, task.id, unObserverId, batch)
    }
}

function getObserversAndUnobserversLists(observers, oldObservers) {
    const newObservers = difference(observers, oldObservers)
    const newUnObservers = difference(oldObservers, observers)

    return { observers: newObservers, unObservers: newUnObservers }
}

export function createGenericTaskWhenMentionInTitleEdition(
    projectId,
    objectId,
    extendedName,
    extendedOldName,
    genericType,
    parentType,
    assistantId
) {
    const newMentionedUserIds = TasksHelper.getMentionIdsFromTitle(extendedName)
    const oldMentionedUserIds = TasksHelper.getMentionIdsFromTitle(extendedOldName)
    const mentionedUserIds = newMentionedUserIds.filter(uid => !oldMentionedUserIds.includes(uid))
    createGenericTaskWhenMention(projectId, objectId, mentionedUserIds, genericType, parentType, assistantId)
}

export async function processFollowersWhenEditTexts(
    projectId,
    followObjectsType,
    followObjectId,
    followObject,
    followersUsersIds,
    needFollowCreator,
    externalBatch
) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(db)
    const followData = {
        followObjectsType,
        followObjectId,
        followObject,
        feedCreator: store.getState().loggedUser,
    }
    if (needFollowCreator) {
        await tryAddFollower(projectId, followData, batch)
    }
    const promises = [setFollowersByMentions(projectId, followersUsersIds, followData, batch)]
    await Promise.all(promises)
    if (!externalBatch) {
        batch.commit()
    }
}

export async function uploadNewSubTaskFeedsChain(projectId, task, subTask, inFollowUpProcess) {
    const batch = new BatchWrapper(db)

    const mentionedUserIds = getMentionedUsersIdsWhenEditText(subTask.extendedName, '')
    insertFollowersUserToFeedChain(mentionedUserIds, [], [subTask.userId], subTask.id, batch)

    const { loggedUser: feedCreator } = store.getState()

    const parentName = task.name
    await createTaskCreatedFeed(projectId, { ...subTask, parentName }, subTask.id, batch, feedCreator)
    if (subTask.isPrivate) {
        await createTaskPrivacyChangedFeed(
            projectId,
            subTask.id,
            subTask.isPrivate,
            subTask.isPublicFor,
            batch,
            feedCreator
        )
    }

    if (subTask.hasStar.toLowerCase() !== '#ffffff') {
        await createTaskHighlightedChangedFeed(projectId, subTask, subTask.id, subTask.hasStar, batch, feedCreator)
    }

    if (subTask.estimations[OPEN_STEP] !== 0) {
        await createTaskAssigneeEstimationChangedFeed(
            projectId,
            subTask.id,
            0,
            subTask.estimations[OPEN_STEP],
            batch,
            feedCreator
        )
    }

    const todayDate = Date.now()
    if (todayDate < subTask.dueDate) {
        await createTaskDueDateChangedFeed(
            projectId,
            subTask,
            subTask.dueDate,
            todayDate,
            subTask.id,
            batch,
            feedCreator,
            false,
            false,
            false
        )
    }

    if (subTask.parentGoalId) {
        await createTaskParentGoalChangedFeed(projectId, subTask, subTask.parentGoalId, null, subTask.id, false, batch)
    }

    if (feedCreator.uid !== subTask.userId && !mentionedUserIds.includes(subTask.userId)) {
        const followTaskAssigneeData = {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: subTask.id,
            followObject: subTask,
            feedCreator: TasksHelper.getUserInProject(projectId, task.userId) || feedCreator,
        }
        await addFollower(projectId, followTaskAssigneeData, batch)
    }

    await processFollowersWhenEditTexts(
        projectId,
        FOLLOWER_TASKS_TYPE,
        subTask.id,
        subTask,
        mentionedUserIds,
        true,
        batch
    )

    if (!inFollowUpProcess) {
        const followTaskData = {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: task.id,
            followObject: task,
            feedCreator,
        }
        await tryAddFollower(projectId, followTaskData, batch)
    }

    batch.commit()
}

export async function uploadNewGuideProject(project, templateAssistantId, projectUsersIdsForSpecialFeeds) {
    const { administratorUser } = store.getState()

    const projectId = getId()
    const creator = administratorUser

    const isGlobalAssistant = !templateAssistantId || project.globalAssistantIds.includes(templateAssistantId)
    project.assistantId = isGlobalAssistant ? templateAssistantId : projectId + templateAssistantId

    await db.doc(`projects/${projectId}`).set(project)

    project.id = projectId

    store.dispatch(setProjectInitialData(project, [], [], [], []))
    watchProjectData(projectId, true, true)

    createUploadNewProjectFeedChain(project, null, projectUsersIdsForSpecialFeeds, creator)

    logEvent('new_project', {
        id: projectId,
        name: project.name,
    })

    return projectId
}

export async function uploadNewProject(project, user, userIdsToNotifyByFeed, setLikeDefaultProject, addingTemplate) {
    const projectId = getId()

    logEvent('new_project', {
        id: projectId,
        name: project.name,
    })

    // New projects will use the default project's assistant (assistantId remains empty)
    // This means they'll automatically inherit the assistant from the user's default project
    // No need to create a copy of the assistant

    const batch = new BatchWrapper(db)
    batch.set(db.doc(`projects/${projectId}`), project)

    const updateData = {
        projectIds: firebase.firestore.FieldValue.arrayUnion(projectId),
    }
    if (project.isTemplate) updateData.templateProjectIds = firebase.firestore.FieldValue.arrayUnion(projectId)
    if (setLikeDefaultProject) updateData.defaultProjectId = projectId
    updateUserData(user.uid, updateData, batch)

    const defaultStream = getDefaultMainWorkstream(projectId, user.uid)
    uploadNewMainWorkstream(projectId, defaultStream, batch)

    if (!setLikeDefaultProject) updateXpByCreateProject(user.uid, firebase, db, projectId)

    await batch.commit()
    project.id = projectId

    if (addingTemplate) {
        store.dispatch(setChatNotificationsInProject(projectId, []))
    } else {
        // No assistants array since new projects use the default project's assistant
        const assistants = []
        if (setLikeDefaultProject) {
            store.dispatch(
                setProjectInitialData({ ...project, id: projectId }, [user], [defaultStream], [], assistants)
            )
        } else {
            const { route } = store.getState()
            if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')
            store.dispatch(navigateToNewProject({ ...project, id: projectId }, [user], [defaultStream], [], assistants))
        }
        watchProjectData(projectId, true, true)
    }

    createUploadNewProjectFeedChain({ ...project, id: projectId }, user, userIdsToNotifyByFeed, user).then(() => {
        if (addingTemplate) {
            const { loggedUser } = store.getState()
            window.location = `/projects/${projectId}/user/${loggedUser.uid}/tasks/open`
        }
    })
}

async function createUploadNewProjectFeedChain(project, user, projectUsersIdsForSpecialFeeds, creator) {
    const batch = new BatchWrapper(db)

    const isGuide = !!project.parentTemplateId
    if (isGuide) batch.feedChainFollowersIds = { [project.id]: [] }

    await createProjectCreatedFeed(project.id, project, batch, creator, projectUsersIdsForSpecialFeeds)

    if (user) {
        const followProjectData = {
            followObjectsType: FOLLOWER_PROJECTS_TYPE,
            followObjectId: project.id,
            followObject: project,
            feedCreator: creator,
        }
        const followUserData = {
            followObjectsType: FOLLOWER_USERS_TYPE,
            followObjectId: creator.uid,
            followObject: creator,
            feedCreator: creator,
        }
        await addFollower(project.id, followProjectData, batch)
        await createUserJoinedFeed(project.id, batch, creator)
        await addFollower(project.id, followUserData, batch)
    }

    await batch.commit()
}

export const addGuideToTemplateFeedsChain = async (template, guideId) => {
    const batch = new BatchWrapper(db)
    const creator = await getUserData(template.templateCreatorId, false)
    await createProjectGuideIdChangedFeed(template.id, guideId, batch, creator)
    const followProjectData = {
        followObjectsType: FOLLOWER_PROJECTS_TYPE,
        followObjectId: template.id,
        followObject: template,
        feedCreator: creator,
    }
    await tryAddFollower(template.id, followProjectData, batch)
    batch.commit()
}

export const getAdministratorUser = async () => {
    const userId = (await db.doc('roles/administrator').get()).data()?.userId
    if (!userId) return {}
    const doc = await db.doc(`users/${userId}`).get()
    return mapUserData(doc.id, doc.data())
}

const addProjectArchivedStatus = (projectId, userId, batch) => {
    batch.update(db.doc(`users/${userId}`), {
        archivedProjectIds: firebase.firestore.FieldValue.arrayUnion(projectId),
    })
}

const removeProjectArchivedStatus = (projectId, userId, batch) => {
    batch.update(db.doc(`users/${userId}`), {
        archivedProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
    })
}

export async function convertToActiveProject(user, project) {
    const batch = new BatchWrapper(db)
    removeProjectArchivedStatus(project.id, user.uid, batch)
    batch.commit()
    updateProjectStatusFeedChain(project, PROJECT_TYPE_ARCHIVED)
}

export async function convertToArchiveProject(user, project) {
    const { areArchivedActive } = store.getState()

    const isLastActiveProject = ProjectHelper.checkIfProjectIsLastActiveProjectOfUser(project.id, user)
    if (isLastActiveProject) {
        await createDefaultProject(user)
    } else if (user.defaultProjectId === project.id) {
        await selectAndSetNewDefaultProject(user)
    }

    const batch = new BatchWrapper(db)

    addProjectArchivedStatus(project.id, user.uid, batch)
    await batch.commit()
    await updateProjectStatusFeedChain(project, PROJECT_TYPE_ARCHIVED)

    if (!areArchivedActive) {
        const { pathname } = window.location
        ProjectHelper.navigateToInactiveProject(PROJECT_TYPE_ARCHIVED, pathname)
    }
}

const updateProjectStatusFeedChain = async (project, projectStatus) => {
    const batch = new BatchWrapper(db)
    await createChangeProjectStatusFeed(project.id, project, projectStatus, batch)
    const followProjectData = {
        followObjectsType: FOLLOWER_PROJECTS_TYPE,
        followObjectId: project.id,
        followObject: project,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(project.id, followProjectData, batch)
    await batch.commit()
}

export async function uploadAttachments(commentId, attachments) {
    for (let attachment of attachments) {
        let attachmentRef = firebase.storage().ref(`attachments/${commentId}/${attachment.name}`)
        attachmentRef.put(attachment)
    }
}

export function findTask(taskId, projectsTasks) {
    // Use binary search since Firebase IDs are ordered in chronological order
    for (let projectTasks of projectsTasks) {
        let start = 0,
            end = projectTasks.length - 1

        while (start <= end) {
            let mid = Math.floor(start + (end - start) / 2)
            if (projectTasks[mid].id === taskId) {
                return projectTasks[mid]
            } else if (projectTasks[mid].id < taskId) {
                start = mid + 1
            } else {
                end = mid - 1
            }
        }
    }
    return null
}

export async function deleteTask(task, projectId) {
    const taskBatch = new BatchWrapper(db)
    updateTaskData(projectId, task.id, {}, taskBatch)
    taskBatch.delete(db.doc(`items/${projectId}/tasks/${task.id}`))
    if (task.done)
        updateStatistics(projectId, task.userId, task.estimations[OPEN_STEP], true, false, task.completed, taskBatch)
    taskBatch.commit()

    const batch = new BatchWrapper(db)

    await createTaskDeletedFeed(projectId, task, task.id, batch)
    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: task.id,
        followObject: task,
        feedCreator: store.getState().loggedUser,
    }

    await tryAddFollower(projectId, followTaskData, batch)

    batch.commit()
}

export async function deleteTaskMultiple(tasks) {
    const deleteBatch = new BatchWrapper(db)
    const batch = new BatchWrapper(db)

    for (let task of tasks) {
        deleteBatch.delete(db.doc(`items/${task.projectId}/tasks/${task.id}`))
        deleteBatch.delete(db.doc(`chatObjects/${task.projectId}/chats/${task.id}`))
    }
    deleteBatch.commit()

    for (let task of tasks) {
        await createTaskDeletedFeed(task.projectId, task, task.id, batch)
        const followTaskData = {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: task.id,
            followObject: task,
            feedCreator: store.getState().loggedUser,
        }

        await tryAddFollower(task.projectId, followTaskData, batch)

        // When the task to delete is a parent task
        if (task.subtaskIds && task.subtaskIds.length > 0) {
            for (let key in task.subtaskIds) {
                batch.delete(db.doc(`items/${task.projectId}/tasks/${task.subtaskIds[key]}`))
            }
        }
    }
    batch.commit()
}

export async function deleteSubTaskFromParent(projectId, subtaskId, subtask, batch) {
    const parentRef = db.doc(`/items/${projectId}/tasks/${subtask.parentId}`)
    const parentTask = (await parentRef.get()).data()
    const { subtaskIds, subtaskNames } = parentTask
    const subtaskIndex = subtaskIds.indexOf(subtaskId)

    if (subtaskIndex > -1) {
        subtaskIds.splice(subtaskIndex, 1)
        subtaskNames.splice(subtaskIndex, 1)
        if (batch) {
            batch.update(parentRef, { subtaskIds, subtaskNames })
        } else {
            parentRef.update({ subtaskIds, subtaskNames })
        }
    }
}

export async function getAttachments(commentId) {
    const attachments = []
    const promises = []
    return firebase
        .storage()
        .ref(`attachments/${commentId}`)
        .listAll()
        .then(folder => {
            for (let file of folder.items) {
                if (
                    !file.name.match(/[\S]+_50x50(.[\w]{1,4})?$/g) &&
                    !file.name.match(/[\S]+_300x300(.[\w]{1,4})?$/g)
                ) {
                    promises.push(firebase.storage().ref(file.fullPath).getDownloadURL())
                }
            }
            return Promise.all(promises).then(urls => {
                for (let i = 0; i < urls.length; ++i) {
                    attachments.push({ name: folder.items[i].name, downloadURL: urls[i] })
                }
                return attachments
            })
        })
}

export function getStepWorkflowDirection(targetStepId, task, workflow) {
    let isForward = 'empty'

    if (targetStepId === 'open') {
        isForward = false
    } else if (targetStepId === 'done') {
        isForward = true
    }

    const currentStepId = task.stepHistory[task.stepHistory.length - 1]
    if (currentStepId === OPEN_STEP) {
        isForward = true
    } else if (currentStepId === DONE_STEP) {
        isForward = false
    } else {
        const workflowEntries = Object.entries(workflow).sort(chronoEntriesOrder)
        if (isForward === 'empty') {
            for (let i = 0; workflowEntries.length; i++) {
                if (workflowEntries[i][0] === targetStepId) {
                    isForward = false
                    break
                } else if (workflowEntries[i][0] === currentStepId) {
                    isForward = true
                    break
                }
            }
        }
    }

    return isForward
}

export async function unwatchObjectComments(projectId, objectType, objectId) {
    if (notesUnsubs[projectId] && notesUnsubs[projectId][objectType] && notesUnsubs[projectId][objectType][objectId]) {
        notesUnsubs[projectId][objectType][objectId]()
    }
}

let isFirstTimeListen = true
let lastDoc = {}
let listenerSize = 2
const pageSize = 100

export async function offOnFeedChange() {
    isFirstTimeListen = true
    feedsUnsub()
}

let onTaskFeedChangeHandlerUnsub = () => {}

export async function offOnTaskFeedChange(projectId, taskId, callback) {
    onTaskFeedChangeHandlerUnsub()
}

export async function loginWithGoogleWebAnonymously() {
    await firebase.auth().signInAnonymously()
}

export function logoutWeb(onComplete) {
    // window.google.accounts.id.disableAutoSelect()
    firebase
        .auth()
        .signOut()
        .then(() => onComplete())
}

export function getNewId() {
    someId++
    return somePrefix + someId.toString()
}

export function watchUserStatistics(projectId, estimationType, userId, timestamp1, timestamp2, watcherKey, callback) {
    const dayDate1 = parseInt(moment(timestamp1).format('YYYYMMDD'))
    const dayDate2 = parseInt(moment(timestamp2).format('YYYYMMDD'))

    globalWatcherUnsub[watcherKey] = db
        .collection(`/statistics/${projectId}/${userId}`)
        .where('day', '>=', dayDate1)
        .where('day', '<=', dayDate2)
        .onSnapshot(statisticsDocs => {
            let doneTasks = 0
            let donePoints = 0
            let doneTime = 0
            let xp = 0
            let gold = 0
            statisticsDocs.forEach(doc => {
                const statistics = doc.data()
                if (statistics.doneTasks) doneTasks += statistics.doneTasks
                if (statistics.donePoints && estimationType === ESTIMATION_TYPE_POINTS)
                    donePoints += statistics.donePoints
                if (statistics.doneTime && estimationType === ESTIMATION_TYPE_TIME) doneTime += statistics.doneTime
                if (statistics.xp) xp += statistics.xp
                if (statistics.gold) gold += statistics.gold
            })
            callback(projectId, { doneTasks, donePoints, doneTime, xp, gold })
        })
}

export async function getRangeUserStatistics(projectId, estimationType, userId, timestamp1, timestamp2) {
    const dayDate1 = parseInt(moment(timestamp1).format('YYYYMMDD'))
    const dayDate2 = parseInt(moment(timestamp2).format('YYYYMMDD'))

    const statisticsDocs = await db
        .collection(`/statistics/${projectId}/${userId}`)
        .where('day', '>=', dayDate1)
        .where('day', '<=', dayDate2)
        .get()
    return statisticsDocs.docs.reduce((curr, doc) => {
        const { doneTime } = doc.data()
        return doneTime && estimationType === ESTIMATION_TYPE_TIME ? curr + doneTime : curr
    }, 0)
}

export async function getUserStatistics(projectId, userId, date, callback, callbackOffline) {
    db.doc(`/statistics/${projectId}/${userId}/${date}`)
        .get()
        .then(doc => {
            const statistics = doc.data()
            callback(projectId, statistics ? statistics : {})
        })
        .catch(error => {
            callbackOffline()
        })
}

export function watchAllUserStatisticsByRange(
    projectId,
    estimationType,
    userId,
    timestamp1,
    timestamp2,
    watcherKey,
    callback
) {
    const dayDate1 = parseInt(moment(timestamp1).format('YYYYMMDD'))
    const dayDate2 = parseInt(moment(timestamp2).format('YYYYMMDD'))

    globalWatcherUnsub[watcherKey] = db
        .collection(`/statistics/${projectId}/${userId}`)
        .where('day', '>=', dayDate1)
        .where('day', '<=', dayDate2)
        .onSnapshot(statisticsDocs => {
            // Cumulative statistics
            let doneTasks = 0
            let donePoints = 0
            let doneTime = 0
            let xp = 0
            let gold = 0

            // All dates statistics
            let allDoneTasks = {}
            let allDonePoints = {}
            let allDoneTime = {}
            let allXp = {}
            let allGold = {}

            statisticsDocs.forEach(doc => {
                // Cumulative statistics
                const data = doc.data()
                if (data.doneTasks) doneTasks += data.doneTasks
                if (data.donePoints && estimationType === ESTIMATION_TYPE_POINTS) donePoints += data.donePoints
                if (data.doneTime && estimationType === ESTIMATION_TYPE_TIME) doneTime += data.doneTime
                if (data.xp) xp += data.xp
                if (data.gold) gold += data.gold

                // All dates statistics
                if (data.doneTasks) allDoneTasks[data.timestamp] = data.doneTasks
                if (data.donePoints)
                    allDonePoints[data.timestamp] = estimationType === ESTIMATION_TYPE_POINTS ? data.donePoints : 0
                if (data.doneTime)
                    allDoneTime[data.timestamp] = estimationType === ESTIMATION_TYPE_TIME ? data.doneTime : 0
                if (data.xp) allXp[data.timestamp] = data.xp
                if (data.gold) allGold[data.timestamp] = data.gold
            })

            const finalStatistics = { doneTasks, donePoints, doneTime, xp, gold }
            const finalAllStatistics = { allDoneTasks, allDonePoints, allDoneTime, allXp, allGold }

            callback(projectId, finalStatistics, finalAllStatistics, userId)
        })
}

export async function onKarmaChange(uid, callback) {
    karmaPointsUnsub = db.doc(`karmaPoints/${uid}`).onSnapshot(callback)
}

export async function offKarmaChange() {
    karmaPointsUnsub()
}

export async function offXpChange() {
    xpPointsUnsub()
}

export function generateSortIndex() {
    let newSortKey = moment().valueOf()
    if (sortKey >= newSortKey) {
        newSortKey = sortKey + 1
    }
    sortKey = newSortKey
    return newSortKey
}

export function generateNegativeSortIndex() {
    let newSortKey = moment().valueOf()
    if (sortKey >= newSortKey) {
        newSortKey = sortKey + 1
    }
    sortKey = newSortKey
    return -newSortKey
}

export function generateNegativeSortTaskIndex() {
    let newSortKey = -moment().valueOf()

    if (negativeSortTaskKey === newSortKey) {
        newSortKey--
    }
    negativeSortTaskKey = newSortKey
    return newSortKey
}

export async function createFollowUpBacklinksToNotes(projectId, taskId, oldTaskId) {
    const batch = new BatchWrapper(db)

    const promises = []

    promises.push(
        db.collection(`noteItems/${projectId}/notes`).where('linkedParentTasksIds', 'array-contains', oldTaskId).get()
    )
    promises.push(
        db
            .collection(`noteItems/${projectId}/notes`)
            .where('linkedParentsInContentIds.linkedParentTasksIds', 'array-contains', oldTaskId)
            .get()
    )
    promises.push(
        db
            .collection(`noteItems/${projectId}/notes`)
            .where('linkedParentsInTitleIds.linkedParentTasksIds', 'array-contains', oldTaskId)
            .get()
    )

    const linkedNotes = await Promise.all(promises)

    linkedNotes[0].forEach(noteDoc => {
        batch.update(noteDoc.ref, {
            linkedParentTasksIds: firebase.firestore.FieldValue.arrayUnion(taskId),
        })
    })

    linkedNotes[1].forEach(noteDoc => {
        batch.update(noteDoc.ref, {
            [`linkedParentsInContentIds.linkedParentTasksIds`]: firebase.firestore.FieldValue.arrayUnion(taskId),
        })
    })

    linkedNotes[2].forEach(noteDoc => {
        batch.update(noteDoc.ref, {
            [`linkedParentsInTitleIds.linkedParentTasksIds`]: firebase.firestore.FieldValue.arrayUnion(taskId),
        })
    })

    batch.commit()
}

export async function getAllDoneVersion() {
    return (
        (await db.collection('info').doc('version').get()).data() ?? {
            major: 0,
            minor: 1,
            patch: 0,
        }
    )
}

export async function watchAllDoneVersion(callback) {
    const unsub = db
        .collection('info')
        .doc('version')
        .onSnapshot(function (version) {
            callback(
                version.data() ?? {
                    major: 0,
                    minor: 1,
                    patch: 0,
                }
            )
        })
    versionUnsub = unsub
}

export async function logEvent(name, params) {
    // Prefer gtag if available (GA4 on web)
    try {
        if (typeof gtag === 'function') {
            gtag('event', name, params || {})
            return
        }
    } catch (e) {
        // noop
    }

    // Fallback to Firebase Analytics if it has been loaded
    try {
        if (firebase && typeof firebase.analytics === 'function') {
            await firebase.analytics().logEvent(name, params)
            return
        }
    } catch (err) {
        // noop
    }

    // As a last resort, avoid throwing to keep app flow
    try {
        console.warn('[analytics] logEvent skipped (analytics not ready):', name, params)
    } catch (_) {}
}

export function mapNoteData(noteId, note) {
    const extendedTitle = note.extendedTitle ? note.extendedTitle : note.title ? note.title : ''
    const hasStar = !note || !note?.hasStar ? '#FFFFFF' : note.hasStar === true ? '#C7E3FF' : note.hasStar

    return {
        id: note.id ? note.id : noteId,
        title: TasksHelper.getTaskNameWithoutMeta(extendedTitle),
        extendedTitle,
        preview: note.preview ? note.preview : '',
        created: note.created ? note.created : Date.now(),
        lastEditorId: note.lastEditorId ? note.lastEditorId : '',
        lastEditionDate: note.lastEditionDate ? note.lastEditionDate : Date.now(),
        views: note.views ? note.views : 0,
        creatorId: note.creatorId ? note.creatorId : '',
        hasStar: hasStar,
        isPrivate: note.isPrivate ? note.isPrivate : false,
        isPublicFor: note.isPublicFor ? note.isPublicFor : [FEED_PUBLIC_FOR_ALL, note.userId],
        userId: note.userId ? note.userId : '',
        stickyData: note.stickyData ? note.stickyData : { stickyEndDate: 0, days: 0 },
        linkedParentNotesIds: note.linkedParentNotesIds ? note.linkedParentNotesIds : [],
        linkedParentTasksIds: note.linkedParentTasksIds ? note.linkedParentTasksIds : [],
        linkedParentContactsIds: note.linkedParentContactsIds ? note.linkedParentContactsIds : [],
        linkedParentProjectsIds: note.linkedParentProjectsIds ? note.linkedParentProjectsIds : [],
        linkedParentGoalsIds: note.linkedParentGoalsIds ? note.linkedParentGoalsIds : [],
        linkedParentSkillsIds: note.linkedParentSkillsIds ? note.linkedParentSkillsIds : [],
        linkedParentAssistantIds: note.linkedParentAssistantIds ? note.linkedParentAssistantIds : [],
        linkedParentsInContentIds: note.linkedParentsInContentIds ? note.linkedParentsInContentIds : {},
        linkedParentsInTitleIds: note.linkedParentsInTitleIds ? note.linkedParentsInTitleIds : {},
        versionId: note.versionId ? note.versionId : CURRENT_DAY_VERSION_ID,
        isVisibleInFollowedFor: note.isVisibleInFollowedFor ? note.isVisibleInFollowedFor : [],
        followersIds: note.followersIds ? note.followersIds : [],
        parentObject: note.parentObject ? note.parentObject : null,
        isPremium: note.isPremium ? note.isPremium : false,
        linkedToTemplate: note.linkedToTemplate ? note.linkedToTemplate : false,
        assistantId: note.assistantId ? note.assistantId : '',
        commentsData: note.commentsData ? note.commentsData : '',
    }
}

export function mapGoalData(goalId, goal) {
    const extendedName = goal.extendedName ? goal.extendedName : goal.name ? goal.name : ''
    return {
        id: goal.id ? goal.id : goalId,
        name: TasksHelper.getTaskNameWithoutMeta(extendedName),
        extendedName,
        created: goal.created ? goal.created : Date.now(),
        creatorId: goal.creatorId ? goal.creatorId : '',
        progress: goal.progress >= 0 ? goal.progress : DYNAMIC_PERCENT,
        assigneesIds: goal.assigneesIds ? goal.assigneesIds : [DEFAULT_WORKSTREAM_ID],
        assigneesCapacity: goal.assigneesCapacity ? goal.assigneesCapacity : { [DEFAULT_WORKSTREAM_ID]: CAPACITY_NONE },
        assigneesReminderDate: goal.assigneesReminderDate
            ? goal.assigneesReminderDate
            : { [DEFAULT_WORKSTREAM_ID]: Date.now() },
        lastEditionDate: goal.lastEditionDate ? goal.lastEditionDate : Date.now(),
        lastEditorId: goal.lastEditorId ? goal.lastEditorId : '',
        hasStar: goal.hasStar ? goal.hasStar : '#FFFFFF',
        description: goal.description ? goal.description : '',
        startingMilestoneDate: goal.startingMilestoneDate ? goal.startingMilestoneDate : BACKLOG_DATE_NUMERIC,
        completionMilestoneDate: goal.completionMilestoneDate ? goal.completionMilestoneDate : BACKLOG_DATE_NUMERIC,
        parentDoneMilestoneIds: goal.parentDoneMilestoneIds ? goal.parentDoneMilestoneIds : [],
        progressByDoneMilestone: goal.progressByDoneMilestone ? goal.progressByDoneMilestone : {},
        isPublicFor: goal.isPublicFor ? goal.isPublicFor : [FEED_PUBLIC_FOR_ALL],
        dateByDoneMilestone: goal.dateByDoneMilestone ? goal.dateByDoneMilestone : {},
        sortIndexByMilestone: goal.sortIndexByMilestone ? goal.sortIndexByMilestone : {},
        noteId: goal.noteId ? goal.noteId : null,
        dynamicProgress: goal.dynamicProgress ? goal.dynamicProgress : 0,
        ownerId: goal.ownerId ? goal.ownerId : ALL_USERS,
        isPremium: goal.isPremium ? goal.isPremium : false,
        lockKey: goal.lockKey ? goal.lockKey : '',
        assistantId: goal.assistantId ? goal.assistantId : '',
        commentsData: goal.commentsData ? goal.commentsData : '',
    }
}

export function mapMilestoneData(milestoneId, milestone) {
    return {
        id: milestone.id ? milestone.id : milestoneId,
        extendedName: milestone.extendedName ? milestone.extendedName : '',
        created: milestone.created ? milestone.created : Date.now(),
        date: milestone.date ? milestone.date : Date.now(),
        done: milestone.done ? milestone.done : false,
        assigneesCapacityDates: milestone.assigneesCapacityDates ? milestone.assigneesCapacityDates : {},
        doneDate: milestone.doneDate ? milestone.doneDate : Date.now(),
        hasStar: milestone.hasStar ? milestone.hasStar : '#FFFFFF',
        ownerId: milestone.ownerId ? milestone.ownerId : ALL_USERS,
    }
}

export function mapTaskData(taskId, task) {
    const extendedName = task.extendedName ? task.extendedName : task.name ? task.name : ''
    const hasStar = !task?.hasStar ? '#FFFFFF' : task.hasStar === true ? '#C7E3FF' : task.hasStar

    const mappedTask = {
        id: task.id ? task.id : taskId,
        done: task.done ? task.done : false,
        inDone: task.inDone ? task.inDone : false,
        name: TasksHelper.getTaskNameWithoutMeta(extendedName),
        extendedName,
        description: task.description ? task.description : '',
        userId: task.userId ? task.userId : '',
        userIds: task.userIds ? task.userIds : [task.userId],
        currentReviewerId: task.currentReviewerId ? task.currentReviewerId : task.userId,
        observersIds: task.observersIds ? task.observersIds : [],
        dueDateByObserversIds: task.dueDateByObserversIds ? task.dueDateByObserversIds : {},
        estimationsByObserverIds: task.estimationsByObserverIds ? task.estimationsByObserverIds : {},
        stepHistory: task.stepHistory ? task.stepHistory : [],
        hasStar: hasStar,
        created: task.created ? task.created : Date.now(),
        creatorId: task.creatorId ? task.creatorId : '',
        dueDate: task.dueDate ? task.dueDate : Date.now(),
        alertEnabled: task.alertEnabled === true || task.alertEnabled === false ? task.alertEnabled : false,
        completed: task.completed ? task.completed : null,
        isPrivate: task.isPrivate ? task.isPrivate : false,
        isPublicFor: task.isPublicFor ? task.isPublicFor : [FEED_PUBLIC_FOR_ALL, task.userId],
        parentId: task.parentId ? task.parentId : null,
        isSubtask: task.isSubtask ? task.isSubtask : false,
        subtaskIds: task.subtaskIds ? task.subtaskIds : [],
        subtaskNames: task.subtaskNames ? task.subtaskNames : [],
        recurrence: task.recurrence ? task.recurrence : RECURRENCE_NEVER,
        lastEditorId: task.lastEditorId ? task.lastEditorId : '',
        lastEditionDate: task.lastEditionDate ? task.lastEditionDate : Date.now(),
        linkBack: task.linkBack ? task.linkBack : '',
        estimations: task.estimations ? task.estimations : { [OPEN_STEP]: ESTIMATION_0_MIN },
        comments: task.comments ? task.comments : [],
        genericData: task.genericData ? task.genericData : null,
        sortIndex: task.sortIndex ? task.sortIndex : generateNegativeSortIndex(),
        linkedParentNotesIds: task.linkedParentNotesIds ? task.linkedParentNotesIds : [],
        linkedParentTasksIds: task.linkedParentTasksIds ? task.linkedParentTasksIds : [],
        linkedParentContactsIds: task.linkedParentContactsIds ? task.linkedParentContactsIds : [],
        linkedParentProjectsIds: task.linkedParentProjectsIds ? task.linkedParentProjectsIds : [],
        linkedParentGoalsIds: task.linkedParentGoalsIds ? task.linkedParentGoalsIds : [],
        linkedParentSkillsIds: task.linkedParentSkillsIds ? task.linkedParentSkillsIds : [],
        linkedParentAssistantIds: task.linkedParentAssistantIds ? task.linkedParentAssistantIds : [],
        parentDone: task.parentDone ? task.parentDone : false,
        suggestedBy: task.suggestedBy ? task.suggestedBy : null,
        parentGoalId: task.parentGoalId ? task.parentGoalId : null,
        parentGoalIsPublicFor: task.parentGoalIsPublicFor ? task.parentGoalIsPublicFor : null,
        noteId: task.noteId ? task.noteId : null,
        containerNotesIds: task.containerNotesIds ? task.containerNotesIds : [],
        calendarData: task.calendarData ? task.calendarData : null,
        gmailData: task.gmailData ? task.gmailData : null,
        timesPostponed: task.timesPostponed ?? 0,
        timesFollowed: task.timesFollowed ?? 0,
        timesDoneInExpectedDay: task.timesDoneInExpectedDay ?? 0,
        timesDone: task.timesDone ?? 0,
        isPremium: task.isPremium ? task.isPremium : false,
        lockKey: task.lockKey ? task.lockKey : '',
        assigneeType: task.assigneeType ? task.assigneeType : TASK_ASSIGNEE_USER_TYPE,
        assistantId: task.assistantId ? task.assistantId : '',
        commentsData: task.commentsData ? task.commentsData : null,
        autoEstimation: task.autoEstimation === false || task.autoEstimation === true ? task.autoEstimation : null,
        completedTime: task.completedTime ? task.completedTime : null,
        // Task-level AI settings
        aiModel: task.aiModel || null,
        aiTemperature: task.aiTemperature || null,
        aiSystemMessage: task.aiSystemMessage || null,
        // Webhook task metadata
        taskMetadata: task.taskMetadata || null,
    }

    // Only include humanReadableId if it has a value
    if (task.humanReadableId) {
        mappedTask.humanReadableId = task.humanReadableId
    }

    return mappedTask
}

export function mapSkillData(skillId, skill) {
    return {
        id: skill.id || skillId,
        extendedName: skill.extendedName || '',
        hasStar: skill.hasStar || '#FFFFFF',
        created: skill.created || Date.now(),
        userId: skill.userId || loggedUser.uid,
        lastEditionDate: skill.lastEditionDate || Date.now(),
        sortIndex: skill.sortIndex || Backend.generateSortIndex(),
        isPublicFor: skill.isPublicFor || [FEED_PUBLIC_FOR_ALL],
        description: skill.description || '',
        points: skill.points || 0,
        noteId: skill.noteId || null,
        lastEditorId: skill.lastEditorId || '',
        completion: skill.completion || 0,
        assistantId: skill.assistantId || '',
        commentsData: skill.commentsData || '',
    }
}

export function mapUserData(userId, user) {
    return {
        uid: userId,
        displayName: user.displayName ? user.displayName : '',
        email: user.email ? user.email : '',
        notificationEmail: user.notificationEmail ? user.notificationEmail : '',
        lastLogin: user.lastLogin ? user.lastLogin : new Date().getTime(),
        photoURL: user.photoURL ? user.photoURL : '',
        projectIds: user.projectIds || [],
        receiveEmails: user.receiveEmails ? user.receiveEmails : false,
        receiveWhatsApp: user.receiveWhatsApp ? user.receiveWhatsApp : false,
        archivedProjectIds: user.archivedProjectIds || [],
        templateProjectIds: user.templateProjectIds || [],
        guideProjectIds: user.guideProjectIds || [],
        invitedProjectIds: user.invitedProjectIds ? user.invitedProjectIds : [],
        copyProjectIds: user.copyProjectIds ? user.copyProjectIds : [],
        workflow: user.workflow ? user.workflow : null,
        company: user.company ? user.company : '',
        role: user.role ? user.role : '',
        description: user.description ? user.description : '',
        phone: user.phone ? user.phone : '',
        extendedDescription: user.extendedDescription
            ? user.extendedDescription
            : user.description
            ? user.description
            : '',
        hasStar: user.hasStar ? user.hasStar : '#FFFFFF',
        fcmToken: user.fcmToken ? user.fcmToken : [],
        xp: user.xp ? user.xp : 0,
        level: user.level ? user.level : 1,
        karma: user.karma ? user.karma : 0,
        timezone: user.timezone ? user.timezone : 0,
        numberTodayTasks: user.numberTodayTasks != null ? user.numberTodayTasks : 10,
        botAdvaiceTriggerPercent: user.botAdvaiceTriggerPercent != null ? user.botAdvaiceTriggerPercent : 0,
        numberGoalsAllTeams: user.numberGoalsAllTeams != null ? user.numberGoalsAllTeams : 5,
        numberChatsAllTeams: user.numberChatsAllTeams != null ? user.numberChatsAllTeams : 5,
        numberUsersSidebar: user.numberUsersSidebar != null ? user.numberUsersSidebar : 3,
        defaultCameraId: user.defaultCameraId ? user.defaultCameraId : 'default',
        defaultAudioInputId: user.defaultAudioInputId ? user.defaultAudioInputId : 'default',
        lastEditionDate: user.lastEditionDate ? user.lastEditionDate : Date.now(),
        lastEditorId: user.lastEditorId ? user.lastEditorId : userId,
        lastVisitBoard: user.lastVisitBoard ? user.lastVisitBoard : {},
        lastVisitBoardInGoals: user.lastVisitBoardInGoals ? user.lastVisitBoardInGoals : {},
        dateFormat: user.dateFormat ? user.dateFormat : null,
        language: user.language ? user.language : null,
        mondayFirstInCalendar: user.mondayFirstInCalendar ? user.mondayFirstInCalendar : null,
        customerId: user.customerId ? user.customerId : '',
        stripeCustomerId: user.stripeCustomerId ? user.stripeCustomerId : '',
        premium: user.premium ? user.premium : { status: PLAN_STATUS_FREE },
        isPrivate: user.isPrivate ? user.isPrivate : false,
        isPublicFor: user.isPublicFor ? user.isPublicFor : [FEED_PUBLIC_FOR_ALL, userId],
        pushNotificationsStatus: user.pushNotificationsStatus ? user.pushNotificationsStatus : false,
        workstreams: user.workstreams ? user.workstreams : {},
        themeName: user.themeName ? user.themeName : COLORS_THEME_MODERN,
        sidebarExpanded: user.sidebarExpanded ? user.sidebarExpanded : SIDEBAR_COLLAPSED,
        gold: user.gold ? user.gold : 0,
        dailyGold: user.dailyGold || user.dailyGold === 0 ? user.dailyGold : DAILY_GOLD_LIMIT,
        statisticsData: user.statisticsData ? user.statisticsData : { filter: 'Current month', customDateRange: [] },
        statisticsModalDate: user.statisticsModalDate ? user.statisticsModalDate : Date.now(),
        previousStatisticsModalDate: user.previousStatisticsModalDate ? user.previousStatisticsModalDate : Date.now(),
        defaultCurrency: user.defaultCurrency ? user.defaultCurrency : 'EUR',
        dailyTopicDate: user.dailyTopicDate ? user.dailyTopicDate : Date.now(),
        previousDailyTopicDate: user.previousDailyTopicDate ? user.previousDailyTopicDate : Date.now(),
        lastDayEmptyInbox: user.lastDayEmptyInbox ? user.lastDayEmptyInbox : Date.now(),
        quotaWarnings: user.quotaWarnings ? user.quotaWarnings : {},
        monthlyXp: user.monthlyXp ? user.monthlyXp : 0,
        monthlyTraffic: user.monthlyTraffic ? user.monthlyTraffic : 0,
        skillPoints: user.skillPoints ? user.skillPoints : 0,
        showSkillPointsNotification: user.showSkillPointsNotification ? user.showSkillPointsNotification : false,
        newEarnedSkillPoints: user.newEarnedSkillPoints ? user.newEarnedSkillPoints : 0,
        statisticsSelectedUsersIds: user.statisticsSelectedUsersIds ? user.statisticsSelectedUsersIds : {},
        singUpUrl: user.singUpUrl ? user.singUpUrl : '',
        noticeAboutTheBotBehavior: user.noticeAboutTheBotBehavior ? user.noticeAboutTheBotBehavior : false,
        defaultProjectId: user.defaultProjectId ? user.defaultProjectId : '',
        apisConnected: user.apisConnected ? user.apisConnected : {},
        unlockedKeysByGuides: user.unlockedKeysByGuides ? user.unlockedKeysByGuides : {},
        inFocusTaskId: user.inFocusTaskId ? user.inFocusTaskId : '',
        inFocusTaskProjectId: user.inFocusTaskProjectId ? user.inFocusTaskProjectId : '',
        noteIdsByProject: user.noteIdsByProject ? user.noteIdsByProject : {},
        assistantId: user.assistantId ? user.assistantId : '',
        activeFullSearchDate: user.activeFullSearchDate ? user.activeFullSearchDate : null,
        commentsData: user.commentsData ? user.commentsData : {},
        firstLoginDateInDay: user.firstLoginDateInDay ? user.firstLoginDateInDay : 0,
        activeTaskStartingDate: user.activeTaskStartingDate ? user.activeTaskStartingDate : 0,
        activeTaskInitialEndingDate: user.activeTaskInitialEndingDate ? user.activeTaskInitialEndingDate : 0,
        activeTaskId: user.activeTaskId ? user.activeTaskId : '',
        activeTaskProjectId: user.activeTaskProjectId ? user.activeTaskProjectId : '',
        showAllProjectsByTime: user.showAllProjectsByTime ? user.showAllProjectsByTime : false,
        lastAssistantCommentData: user.lastAssistantCommentData ? user.lastAssistantCommentData : {},
    }
}

export function mapContactData(contactId, contact) {
    return {
        uid: contactId,
        displayName: contact.displayName ? contact.displayName : '',
        photoURL: contact.photoURL ? contact.photoURL : '',
        photoURL50: contact.photoURL50 ? contact.photoURL50 : '',
        photoURL300: contact.photoURL300 ? contact.photoURL300 : '',
        company: contact.company ? contact.company : '',
        role: contact.role ? contact.role : '',
        description: contact.description ? contact.description : '',
        extendedDescription: contact.extendedDescription
            ? contact.extendedDescription
            : contact.description
            ? contact.description
            : '',
        hasStar: contact.hasStar ? contact.hasStar : '#FFFFFF',
        isPrivate: contact.isPrivate ? contact.isPrivate : false,
        isPublicFor: contact.isPublicFor ? contact.isPublicFor : [FEED_PUBLIC_FOR_ALL, contact.recorderUserId],
        recorderUserId: contact.recorderUserId ? contact.recorderUserId : '',
        email: contact.email ? contact.email : '',
        phone: contact.phone ? contact.phone : '',
        lastEditorId: contact.lastEditorId ? contact.lastEditorId : '',
        lastEditionDate: contact.lastEditionDate ? contact.lastEditionDate : Date.now(),
        noteId: contact.noteId ? contact.noteId : null,
        isPremium: contact.isPremium ? contact.isPremium : false,
        lastVisitBoard: contact.lastVisitBoard ? contact.lastVisitBoard : {},
        lastVisitBoardInGoals: contact.lastVisitBoardInGoals ? contact.lastVisitBoardInGoals : {},
        assistantId: contact.assistantId ? contact.assistantId : '',
        commentsData: contact.commentsData ? contact.commentsData : null,
        openTasksAmount: contact.openTasksAmount ? contact.openTasksAmount : 0,
    }
}

export function mapProjectData(projectId, project, customData) {
    return {
        id: projectId,
        color: project.color ? project.color : PROJECT_COLOR_DEFAULT,
        created: project.created ? project.created : null,
        creatorId: project.creatorId ? project.creatorId : '',
        name: project.name ? project.name : '',
        description: project.description ? project.description : '',
        assistantId: project.assistantId ? project.assistantId : '',
        projectStartDate: project.projectStartDate ? project.projectStartDate : null,
        userIds: project.userIds ? project.userIds : [],
        isPrivate: project.isPrivate ? project.isPrivate : false,
        isShared: project.isShared ? project.isShared : PROJECT_PUBLIC,
        estimationType: project.estimationType ? project.estimationType : ESTIMATION_TYPE_TIME,
        lastActionDate: project.lastActionDate ? project.lastActionDate : moment().valueOf(),
        monthlyXp: project.monthlyXp ? project.monthlyXp : 0,
        monthlyTraffic: project.monthlyTraffic ? project.monthlyTraffic : 0,
        isTemplate: project.isTemplate || false,
        templateCreatorId: project.templateCreatorId ? project.templateCreatorId : '',
        guideProjectIds: project.guideProjectIds ? project.guideProjectIds : [],
        parentTemplateId: project.parentTemplateId ? project.parentTemplateId : '',
        activeFullSearch: project.activeFullSearch ? project.activeFullSearch : null,
        hourlyRatesData: project.hourlyRatesData ? project.hourlyRatesData : { currency: 'EUR', hourlyRates: {} },
        lastChatActionDate: project.lastChatActionDate
            ? project.lastChatActionDate
            : moment().subtract(30, 'year').valueOf(),
        usersData: project.usersData ? project.usersData : {},
        workstreamIds: project.workstreamIds ? project.workstreamIds : [],
        globalAssistantIds: project.globalAssistantIds ? project.globalAssistantIds : [],
        lastLoggedUserDate: project.lastLoggedUserDate
            ? project.lastLoggedUserDate
            : moment().subtract(1, 'year').valueOf(),
        active: project.active ? project.active : false,
        lastUserInteractionDate: project.lastUserInteractionDate ? project.lastUserInteractionDate : Date.now(),
        autoEstimation: project.autoEstimation === false ? false : true,
        sortIndexByUser: project.sortIndexByUser ? project.sortIndexByUser : {},
        ...customData,
    }
}

export function mapWorkstreamData(wstreamId, workstreamData) {
    return {
        uid: wstreamId,
        displayName: workstreamData?.displayName || 'Workstream',
        description: workstreamData?.description || '',
        projectId: workstreamData?.projectId || '',
        lastVisitBoard: workstreamData?.lastVisitBoard || {},
        lastVisitBoardInGoals: workstreamData?.lastVisitBoardInGoals || {},
        userIds: workstreamData?.userIds || [],
        created: workstreamData?.created || Date.now(),
        creatorId: workstreamData?.creatorId || '',
        lastEditionDate: workstreamData?.lastEditionDate || Date.now(),
        lastEditorId: workstreamData?.lastEditorId || workstreamData?.creatorId || '',
        photoURL: DEFAULT_WORKSTREAM_ID,
    }
}

export function getFirebaseTimestamp() {
    firebase
        .firestore()
        .doc('/info/currentTime/')
        .set({ time: firebase.firestore.FieldValue.serverTimestamp() })
        .then(async () => {
            const currentTime = (await db.doc('/info/currentTime/').get()).data()
            return currentTime.time
        })
}

async function getServerCurrentTime() {
    const currentTime = (await db.doc('/info/currentTime/').get()).data()
    if (currentTime.time) {
        return currentTime.time.seconds * 1000
    } else {
        return await getServerCurrentTime()
    }
}

export async function getFirebaseTimestampDirectly() {
    await firebase.firestore().doc('/info/currentTime/').set({ time: firebase.firestore.FieldValue.serverTimestamp() })
    const currentTime = await getServerCurrentTime()
    return currentTime
}

/**
 * Fancy ID generator that creates 20-character string identifiers with the following properties:
 *
 * 1. They're based on timestamp so that they sort *after* any existing ids.
 * 2. They contain 72-bits of random data after the timestamp so that IDs won't collide with other clients' IDs.
 * 3. They sort *lexicographically* (so the timestamp is converted to characters that will sort properly).
 * 4. They're monotonically increasing.  Even if you generate more than one in the same timestamp, the
 *    latter ones will sort after the former ones.  We do this by using the previous random bits
 *    but "incrementing" them by 1 (only in the case of a timestamp collision).
 */
export function getId() {
    // Modeled after base64 web-safe chars, but ordered by ASCII.
    const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'

    // Timestamp of last push, used to prevent local collisions if you push twice in one ms.
    lastPushTime = 0

    // We generate 72-bits of randomness which get turned into 12 characters and appended to the
    // timestamp to prevent collisions with other clients.  We store the last characters we
    // generated because in the event of a collision, we'll use those same characters except
    // "incremented" by one.
    let lastRandChars = []

    let now = new Date().getTime()
    let duplicateTime = now === lastPushTime
    lastPushTime = now

    let timeStampChars = new Array(8)
    for (let i = 7; i >= 0; i--) {
        timeStampChars[i] = PUSH_CHARS.charAt(now % 64)
        // NOTE: Can't use << here because javascript will convert to int and lose the upper bits.
        now = Math.floor(now / 64)
    }
    if (now !== 0) throw new Error('We should have converted the entire timestamp.')

    let id = timeStampChars.join('')

    if (!duplicateTime) {
        for (i = 0; i < 12; i++) {
            lastRandChars[i] = Math.floor(Math.random() * 64)
        }
    } else {
        // If the timestamp hasn't changed since last push, use the same random number, except incremented by 1.
        for (i = 11; i >= 0 && lastRandChars[i] === 63; i--) {
            lastRandChars[i] = 0
        }
        lastRandChars[i]++
    }
    for (i = 0; i < 12; i++) {
        id += PUSH_CHARS.charAt(lastRandChars[i])
    }
    if (id.length != 20) throw new Error('Length should be 20.')

    return id
}

////////////////////FEEDS//////////////////////////

////////////UTILITIES FEEDS//////////////

export function generateCurrentDateObject() {
    const currentDate = moment()
    const currentDateFormated = currentDate.format('DDMMYYYY')
    const currentMilliseconds = currentDate.valueOf()
    return { currentDate, currentDateFormated, currentMilliseconds }
}

export function processLocalFeeds(projectId, feedObject, objectId, feed, feedId, params) {
    let idType
    if (feedObject.type === 'task') {
        idType = 'taskId'
    } else if (feedObject.type === 'contact') {
        idType = 'contactId'
    } else if (feedObject.type === 'project') {
        idType = 'projectId'
    } else if (feedObject.type === 'user') {
        idType = 'userId'
    } else if (feedObject.type === 'note') {
        idType = 'noteId'
    } else if (feedObject.type === 'goal') {
        idType = 'goalId'
    } else if (feedObject.type === 'skills') {
        idType = 'skillId'
    } else if (feedObject.type === 'assistants') {
        idType = 'assistantId'
    }

    const localObject = { ...feedObject, id: objectId }
    const localFeed = { ...feed, id: feedId, [idType]: objectId, showLikeNew: false }
    store.dispatch(setNewLocalFeedData(projectId, localObject, localFeed, params))
}

export async function loadFeedObject(projectId, objectId, objectTypes, dateFormated, lastChangeDate, batch) {
    let feedObject
    if (batch.feedObjects && batch.feedObjects[objectId]) {
        feedObject = batch.feedObjects[objectId]
    } else {
        feedObject = await getFeedObjectLastState(projectId, objectTypes, objectId)
        if (!feedObject) {
            feedObject = await generateMissingFeedObject(projectId, dateFormated, objectTypes, objectId, lastChangeDate)
        }
        batch.feedObjects = { ...batch.feedObjects, [objectId]: feedObject }
    }
    feedObject.lastChangeDate = lastChangeDate
    return feedObject
}

async function updateInnerFeedsPrivacy(objectId, path, isPublicFor, batch) {
    const feeds = (await db.collection(path).where('objectId', '==', objectId).get()).docs
    feeds.forEach(feedDoc => {
        const feed = feedDoc.data()
        const usersWithAccess = [...isPublicFor]
        if (feed.isCommentPublicFor) {
            feed.isCommentPublicFor.forEach(userId => {
                if (!usersWithAccess.includes(userId)) {
                    usersWithAccess.push(userId)
                }
            })
        }
        batch.set(db.doc(`${path}/${feedDoc.id}`), { isPublicFor: usersWithAccess }, { merge: true })
    })
}

export async function addPrivacyForFeedObject(projectId, isPrivate, feedObject, objectId, objectTypes, isPublicFor) {
    const batch = new BatchWrapper(db)
    feedObject.isPublicFor = isPublicFor
    const usersIds = getProjectUsersIds(projectId)
    if (isPrivate) {
        const userIdsWithoutAccess = usersIds.filter(userId => !isPublicFor.includes(userId))
        userIdsWithoutAccess.forEach(userId => {
            deleteObjectFeedCounter(projectId, userId, objectId, objectTypes, BOTH_TABS, batch)
            deleteObjectFeedStore(projectId, userId, objectId, 'followed')
        })
    }

    const promises = []
    const followersWithAccessIds = isPublicFor[0] === FEED_PUBLIC_FOR_ALL ? usersIds : isPublicFor
    followersWithAccessIds.forEach(userId => {
        promises.push(
            updateInnerFeedsPrivacy(objectId, `/feedsStore/${projectId}/${userId}/feeds/followed`, isPublicFor, batch)
        )
    })

    promises.push(updateInnerFeedsPrivacy(objectId, `/feedsStore/${projectId}/all`, isPublicFor, batch))

    promises.push(
        updateInnerFeedsPrivacy(
            objectId,
            `projectsInnerFeeds/${projectId}/${objectTypes}/${objectId}/feeds`,
            isPublicFor,
            batch
        )
    )
    await Promise.all(promises)
    batch.commit()
}

///// LAST STATE FEED OBJECTS MODELS ///////////

export async function getFeedObjectLastState(projectId, objectType, objectId) {
    const objectLastState = await db.doc(`/feedsObjectsLastStates/${projectId}/${objectType}/${objectId}`).get()
    return objectLastState.data()
}

export async function setFeedObjectLastState(projectId, objectType, objectId, objectLastState, batch) {
    const stateRef = db.doc(`/feedsObjectsLastStates/${projectId}/${objectType}/${objectId}`)
    batch.set(stateRef, objectLastState, { merge: true })
}

export async function getFeedObjectsLastStateList(projectId, objectType) {
    return (
        await db
            .collection(`/feedsObjectsLastStates/${projectId}/${objectType}`)
            .orderBy('lastChangeDate', 'desc')
            .limit(100)
            .get()
    ).docs.map(update => {
        return { id: update.id, ...update.data() }
    })
}

/////  UTILS FUNCTIONS

export const updateTasksFeedsAmountOfSubtasks = async (
    projectId,
    taskId,
    subtaskId,
    currentDateFormated,
    amountVariation,
    batch
) => {
    const feedObjectRef = db.doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${taskId}`)
    const subtaskIds =
        amountVariation > 0
            ? firebase.firestore.FieldValue.arrayUnion(subtaskId)
            : firebase.firestore.FieldValue.arrayRemove(subtaskId)
    const taskChanges = { subtaskIds }
    batch.set(feedObjectRef, taskChanges, { merge: true })
    setFeedObjectLastState(projectId, 'tasks', taskId, taskChanges, batch)
}

////// OBJECTS FEEDS GENERATORS /////

export function generateFeedModel({ feedType, lastChangeDate, entryText, feedCreator, objectId, isPublicFor }) {
    const { uid } = feedCreator
    const feed = {
        type: feedType,
        lastChangeDate,
        creatorId: uid,
        objectId,
        isPublicFor: isPublicFor ? isPublicFor : [FEED_PUBLIC_FOR_ALL],
    }

    if (entryText) feed.entryText = entryText
    const feedId = getId()
    return { feed, feedId }
}

export function globalInnerFeedsGenerator(
    projectId,
    objectTypes,
    feedObjectId,
    feed,
    feedId,
    creatorId,
    batch,
    disabledLastInteraction
) {
    batch.set(db.doc(`projectsInnerFeeds/${projectId}/${objectTypes}/${feedObjectId}/feeds/${feedId}`), feed)
    // if (feedObjectId !== creatorId) {
    //     batch.set(db.doc(`projectsInnerFeeds/${projectId}/users/${creatorId}/feeds/${feedId}`), feed)
    // }

    setLastActionDate(projectId, feed.lastChangeDate, batch)
}

function setLastActionDate(projectId, lastActionDate, batch) {
    if (!batch.lastActionDate) {
        batch.lastActionDate = lastActionDate
        batch.set(db.doc(`projects/${projectId}`), { lastActionDate }, { merge: true })
    }
}

///////////////ATTACHMENTS PROCESS ////////////////////////

export async function storeAttachment(projectId, attachment, inNotes) {
    const path = !inNotes ? 'feedAttachments' : 'notesAttachments'
    const { name } = attachment
    const currentDateFormated = moment().format('DDMMYYYY')
    const randomHash = getId()
    const storageRef = await firebase.storage().ref()
    const attachmentRef = await storageRef.child(`${path}/${currentDateFormated}/${randomHash}/${name}`)
    await attachmentRef.put(attachment)
    const attachmentUri = await attachmentRef.getDownloadURL()
    const loggedUserId = store.getState().loggedUser.uid
    updateQuotaTraffic(projectId, loggedUserId, attachment.size / 1024 / 1024)
    return attachmentUri
}

export async function storeConvertedVideos(projectId, attachment) {
    const path = 'notesAttachments'
    const { name } = attachment
    const currentDateFormated = moment().format('DDMMYYYY')
    const randomHash = getId()
    const storageRef = firebase.storage().ref()
    const attachmentRef = storageRef.child(`${path}/${currentDateFormated}/${randomHash}/${name}`)
    await attachmentRef.put(attachment)
    const attachmentUri = await attachmentRef.getDownloadURL()
    const loggedUserId = store.getState().loggedUser.uid
    updateQuotaTraffic(projectId, loggedUserId, attachment.size / 1024 / 1024)
    return new Promise(function (resolve, reject) {
        connectToConverter({ videoUri: attachmentUri, uri: currentDateFormated, hash: randomHash })
            .then(({ data }) => resolve(data.url))
            .catch(error => {
                console.log(error)
                reject({ JSON })
            })
    })
}

////////////////////// NOTIFICATION EMAIL SYSTEM ////////////////////////
async function registerFeedEmail(projectId, userId, objectsType, objectId, feed, feedObject, notificationData) {
    const batch = new BatchWrapper(db)
    const followers = (await db.doc(`followers/${projectId}/${objectsType}/${objectId}`).get()).data()
    const project = await getProjectData(projectId)

    if (
        objectsType === 'customs' ||
        (followers && followers.usersFollowing && followers.usersFollowing.includes(userId))
    ) {
        // this will allow to get the real data from DB
        // in case the local data is not up to date
        let user = await getUserData(userId, false)

        if (user?.receiveEmails) {
            switch (objectsType) {
                case 'projects':
                    registerEmailDataForProjects(user, objectId, project, feed, feedObject, batch, notificationData) //Push N. Done
                    break
                case 'users':
                    registerEmailDataForUsers(user, objectId, project, feed, feedObject, batch, notificationData) // Push N. Done
                    break
                case 'contacts':
                    registerEmailDataForContacts(user, objectId, project, feed, feedObject, batch, notificationData)
                    break
                case 'tasks':
                    await registerEmailDataForTasks(user, objectId, project, feed, feedObject, batch, notificationData) //Push N. Done
                    break
            }
        }
    }
    batch.commit()
}

async function sendPushNotifications(projectId, userId, objectsType, objectId, feed, feedObject, notificationData) {
    const {
        creatorName,
        kickedUserName,
        oldAssigneeName,
        newAssigneeName,
        assigneeName,
        ratedFeedOwnerName,
    } = notificationData

    const followers = (await db.doc(`followers/${projectId}/${objectsType}/${objectId}`).get()).data()
    const project = mapProjectData(projectId, (await db.doc(`projects/${projectId}`).get()).data())

    if (followers && followers.usersFollowing && followers.usersFollowing.includes(userId)) {
        // this will allow to get the real data from DB
        // in case the local data is not up to date
        let user = await getUserData(userId, false)
        let extraTxt = feed.entryText ? `${creatorName} ${feed.entryText}` : ''
        let reviewerName

        if (user?.pushNotificationsStatus) {
            switch (objectsType) {
                case 'projects':
                    switch (feed.type) {
                        case FEED_PROJECT_COLOR_CHANGED:
                            extraTxt = `${creatorName} changed color • From ${feed.oldColor} to ${feed.newColor}`
                            break
                        case FEED_PROJECT_KICKED_MEMBER:
                            extraTxt = `${creatorName} kicked out a member • ${kickedUserName}`
                            break
                        case FEED_PROJECT_GIVE_KARMA:
                            extraTxt = `${creatorName} gave Karma Point • To ${ratedFeedOwnerName}`
                            break
                        default:
                            break
                    }
                    sendPushNotification({
                        type: 'Updates Notification',
                        body: `${feedObject.name}\n  ${extraTxt}`,
                        userIds: [user.uid],
                        link: `${window.location.origin}/project/${projectId}/properties`,
                    })
                    break
                    if (
                        [FEED_USER_WORKFLOW_ADDED, FEED_USER_WORKFLOW_REMOVE, FEED_USER_WORKFLOW_CHANGED].includes(
                            feed.type
                        )
                    ) {
                        reviewerName =
                            TasksHelper.getUserInProject(projectId, feed.reviewerUserId).displayName.split(' ')[0] ||
                            TasksHelper.getContactInProject(projectId, feed.reviewerUserId).displayName.split(' ')[0]
                    }
                case 'users':
                    const { shortName } = getUserPresentationDataInProject(projectId, feedObject.userId)

                    switch (feed.type) {
                        case FEED_USER_FOLLOWING_ALL_MEMBERS:
                            extraTxt = `${creatorName} started following all ${project.name} project members`
                            break
                        case FEED_USER_ALL_MEMBERS_FOLLOWING:
                            extraTxt = `All ${project.name} project members started following the user`
                            break
                        case FEED_USER_WORKFLOW_ADDED:
                            extraTxt = `${creatorName} added ${reviewerName} in ${shortName}'s workflow • Step name: ${feed.description}`
                            break
                        case FEED_USER_WORKFLOW_REMOVE:
                            extraTxt = `${creatorName} removed ${reviewerName} in ${shortName}'s workflow • Step name: ${feed.description}`
                            break
                        case FEED_USER_WORKFLOW_CHANGED:
                            extraTxt = `${creatorName} changed ${reviewerName} in ${shortName}'s workflow • Step name: ${feed.description}`
                            break
                        default:
                            break
                    }
                    sendPushNotification({
                        type: 'Updates Notification',
                        body: `${project.name}\n  👤 ${shortName}\n ${extraTxt}`,
                        userIds: [user.uid],
                        link: `${window.location.origin}${getDvMainTabLink(projectId, feedObject.userId, 'users')}`,
                    })
                    break

                case 'tasks':
                    switch (feed.type) {
                        case FEED_TASK_ASSIGNEE_CHANGED:
                            extraTxt = `${creatorName} changed assignee • From ${oldAssigneeName} To ${newAssigneeName}`
                            break
                        case FEED_TASK_MOVED_IN_WORKFLOW:
                            extraTxt = `${creatorName} send ${
                                feed.isForward ? 'forward' : 'backward'
                            } in Workflow • From ${feed.fromStepDescription} to ${feed.toStepDescription}`
                            break
                        case FEED_TASK_GIVE_KARMA:
                            extraTxt = `${creatorName} gave Karma Point • To ${ratedFeedOwnerName} ${feed.comment}`
                            break
                        case FEED_TASK_TO_ANOTHER_USER:
                            extraTxt = `${creatorName} created a task assigned to ${assigneeName}`
                            break
                        case FEED_TASK_PROJECT_CHANGED_TO:
                            extraTxt = `${creatorName} changed project • Moved to ${feed.projectName}`
                            break
                        case FEED_TASK_PROJECT_CHANGED_FROM:
                            extraTxt = `${creatorName} changed project • Moved from ${feed.projectName}`
                            break
                        default:
                            break
                    }
                    sendPushNotification({
                        type: 'Updates Notification',
                        body: `${project.name}\n  ✔ ${feedObject.name}\n ${extraTxt}`,
                        userIds: [user.uid],
                        link: `${window.location.origin}/projects/${projectId}/tasks/${feedObject.taskId}/properties`,
                    })
                    break
            }
        }
    }
}

function registerEmailDataForProjects(user, objectId, project, feed, feedObject, batch, notificationData) {
    const {
        creatorName,
        creatorPhotoURL,
        kickedUserName,
        kickedUserAvatarURL,
        ratedFeedOwnerName,
        ratedFeedOwnerAvatar,
    } = notificationData

    const userData = { email: user.notificationEmail ? user.notificationEmail : user.email, timezone: user.timezone }
    const projectId = project.id

    const objectData = {
        feedObjectType: FEED_PROJECT_OBJECT_TYPE,
        feedDate: Date.now(),
        feedProjectName: feedObject.name,
        feedProjectColor: feedObject.color,
        feedLinkTopic: 'project',
        feedLink: `project/${projectId}/properties`,
    }

    const feedData = {
        feedTime: Date.now(),
        feedOwnerName: creatorName,
        feedOwnerPhotoURL: creatorPhotoURL,
    }

    /**
     * Default will fire for:
     * [ FEED_PROJECT_CREATED | FEED_PROJECT_PRIVACY_CHANGED | FEED_PROJECT_TITLE_CHANGED |
     * FEED_PROJECT_DESCRIPTION_CHANGED | FEED_PROJECT_ARCHIVED_UNARCHIVED | FEED_PROJECT_SENT_INVITATION |
     * FEED_PROJECT_DECLINED_INVITATION | FEED_PROJECT_FOLLOWED | FEED_PROJECT_UNFOLLOWED | FEED_PROJECT_ESTIMATION_TYPE_CHANGED ]
     */

    switch (feed.type) {
        case FEED_PROJECT_COLOR_CHANGED:
            feedData.feedAction = 'changed color • From '
            feedData.feedPrevColor = feed.oldColor
            feedData.feedCurrColor = feed.newColor
            break
        case FEED_PROJECT_KICKED_MEMBER:
            feedData.feedAction = 'kicked out a member • '
            feedData.FeedKickedUserName = kickedUserName
            feedData.FeedKickedUserPhoto = kickedUserAvatarURL
            break
        case FEED_PROJECT_GIVE_KARMA:
            feedData.feedAction = 'gave Karma Point • To'
            feedData.feedKarmaUserPhoto = ratedFeedOwnerAvatar
            feedData.feedKarmaUserName = ratedFeedOwnerName
            break
        case FEED_PROJECT_GUIDE_CHANGED:
            feedData.feedAction = 'added new community project'
            break
        default:
            feedData.feedOwnerName = null
            feedData.feedAction = feed.entryText
            break
    }

    batch.set(db.doc(`/notifications/${user.uid}`), userData, { merge: true })
    batch.set(db.doc(`/notifications/${user.uid}/objects/project@${objectId}`), objectData, { merge: true })
    batch.set(db.doc(`/notifications/${user.uid}/objects/project@${objectId}/feeds/${getId()}`), feedData, {
        merge: true,
    })
}

function registerEmailDataForUsers(user, objectId, project, feed, feedObject, batch, notificationData) {
    const { creatorName, creatorPhotoURL, ratedFeedOwnerAvatar, ratedFeedOwnerName } = notificationData

    const userData = { email: user.notificationEmail ? user.notificationEmail : user.email, timezone: user.timezone }
    const projectId = project.id

    const { shortName, photoURL } = getUserPresentationDataInProject(projectId, feedObject.userId)
    const objectData = {
        feedObjectType: FEED_USER_OBJECT_TYPE,
        feedDate: Date.now(),
        feedUserName: shortName,
        feedUserPhotoURL: photoURL,
        feedProjectName: project.name,
        feedProjectColor: project.color,
        feedLinkTopic: 'project member',
        feedLink: getDvMainTabLink(projectId, feedObject.userId, 'users'),
    }

    const feedData = {
        feedTime: Date.now(),
        feedOwnerName: creatorName,
        feedOwnerPhotoURL: creatorPhotoURL,
        feedProjectColor: project.color,
    }

    /**
     * Default will fire for:
     * [ FEED_USER_JOINED | FEED_USER_ROLE_CHANGED | FEED_USER_COMPANY_CHANGED |
     *   FEED_USER_FOLLOWED | FEED_USER_UNFOLLOWED | FEED_USER_FOLLOWING_ALL_MEMBERS
     *   FEED_USER_ALL_MEMBERS_FOLLOWING ]
     */

    switch (feed.type) {
        case FEED_USER_GIVE_KARMA:
            feedData.feedAction = 'gave Karma Point • To'
            feedData.feedKarmaUserPhoto = ratedFeedOwnerAvatar
            feedData.feedKarmaUserName = ratedFeedOwnerName
            break
        case FEED_USER_FOLLOWING_ALL_MEMBERS:
            feedData.feedAction = 'started following all'
            feedData.feedExtraAction = `${project.name} project members`
            break
        case FEED_USER_ALL_MEMBERS_FOLLOWING:
            delete feedData.feedOwnerName
            delete feedData.feedOwnerPhotoURL
            feedData.feedProjectAction = `All ${project.name} project members started following the user`
            break
        case FEED_USER_WORKFLOW_ADDED:
            feedData.feedAction = ''
            feedData.feedExtraAction = ''
            break
        case FEED_USER_WORKFLOW_REMOVE:
            feedData.feedAction = ''
            feedData.feedExtraAction = ''
            break
        case FEED_USER_WORKFLOW_CHANGED:
            feedData.feedAction = ''
            feedData.feedExtraAction = ''
            break
        default:
            feedData.feedOwnerName = null
            feedData.feedAction = feed.entryText
            break
    }

    batch.set(db.doc(`/notifications/${user.uid}`), userData, { merge: true })
    batch.set(db.doc(`/notifications/${user.uid}/objects/user@${objectId}`), objectData, { merge: true })
    batch.set(db.doc(`/notifications/${user.uid}/objects/user@${objectId}/feeds/${getId()}`), feedData, { merge: true })
}

export function registerEmailDataForContacts(user, objectId, project, feed, feedObject, batch, notificationData) {
    const { creatorName, creatorPhotoURL, ratedFeedOwnerName, ratedFeedOwnerAvatar } = notificationData

    const userData = { email: user.notificationEmail ? user.notificationEmail : user.email, timezone: user.timezone }
    const projectId = project.id

    const objectData = {
        feedObjectType: FEED_CONTACT_OBJECT_TYPE,
        feedDate: Date.now(),
        feedContactName: feedObject.name,
        feedContactPhotoURL: feedObject.avatarUrl,
        feedProjectName: project.name,
        feedProjectColor: project.color,
        feedLinkTopic: 'project relevant person',
        feedLink: getDvMainTabLink(projectId, feedObject.contactId, 'contacts'),
    }

    const feedData = {
        feedTime: Date.now(),
        feedOwnerName: creatorName,
        feedOwnerPhotoURL: creatorPhotoURL,
    }

    /**
     * Default will fire for:
     * [ FEED_CONTACT_EMAIL_CHANGED | FEED_CONTACT_PHONE_NUMBER_CHANGED | FEED_CONTACT_PRIVACY_CHANGED |
     *   FEED_CONTACT_ROLE_CHANGED | FEED_CONTACT_NAME_CHANGED | FEED_CONTACT_COMPANY_CHANGED |
     *   FEED_CONTACT_DELETED | FEED_CONTACT_FOLLOWED | FEED_CONTACT_UNFOLLOWED ]
     */

    switch (feed.type) {
        case FEED_CONTACT_ADDED:
            feedData.feedAction = `added relevant person • ${feedObject.name}`
            break
        case FEED_CONTACT_PICTURE_CHANGED:
            feedData.feedAction = 'changed picture • From '
            feedData.feedPrevPhoto = feed.oldContactPhotoURL
            feedData.feedCurrPhoto = feed.newContactPhotoURL
            break
        case FEED_CONTACT_GIVE_KARMA:
            feedData.feedAction = 'gave Karma Point • To'
            feedData.feedKarmaUserPhoto = ratedFeedOwnerAvatar
            feedData.feedKarmaUserName = ratedFeedOwnerName
            break
        default:
            feedData.feedOwnerName = null
            feedData.feedAction = feed.entryText
            break
    }

    batch.set(db.doc(`/notifications/${user.uid}`), userData, { merge: true })
    batch.set(db.doc(`/notifications/${user.uid}/objects/contact@${objectId}`), objectData, { merge: true })
    batch.set(db.doc(`/notifications/${user.uid}/objects/contact@${objectId}/feeds/${getId()}`), feedData, {
        merge: true,
    })
}

export async function registerEmailDataForTasks(user, objectId, project, feed, feedObject, batch, notificationData) {
    const {
        creatorName,
        creatorPhotoURL,
        oldAssigneeName,
        newAssigneeName,
        oldAssigneeAvatarURL,
        newAssigneeAvatarURL,
        assigneeName,
        assigneeAvatarURL,
        fromStepAvatarURL,
        toStepAvatarURL,
        ratedFeedOwnerAvatar,
        ratedFeedOwnerName,
    } = notificationData

    const userData = { email: user.notificationEmail ? user.notificationEmail : user.email, timezone: user.timezone }
    const projectId = project.id

    let assignee = { displayName: 'Unknown user', photoURL: `${window.location.origin}/icons/Generic-User24px.png` }

    if (feedObject.userId != null && feedObject.userId.length > 0) {
        const assigneeData = (await db.doc(`users/${feedObject.userId}`).get()).data()
        if (assigneeData != null && assigneeData.displayName?.length > 0) {
            assignee = assigneeData
        }
    }

    const objectData = {
        feedObjectType: FEED_TASK_OBJECT_TYPE,
        feedDate: Date.now(),
        feedTaskTitle: TasksHelper.transformTitleMetadata(feedObject.name, projectId),
        feedTaskStatus: feedObject.isDeleted ? 'deleted' : feedObject.isDone ? 'done' : 'open',
        feedTaskTags: [],
        feedProjectName: project.name,
        feedProjectColor: project.color,
        feedAssigneeName: assignee.displayName,
        feedAssigneePhoto: assignee.photoURL,
        feedLinkTopic: 'task',
        feedLink: `projects/${projectId}/tasks/${feedObject.taskId}/properties`,
        feedSubtask: feedObject.parentId != null && feedObject.parentId.length > 0 ? 1 : 0,
    }

    const feedData = {
        feedTime: Date.now(),
        feedOwnerName: creatorName,
        feedOwnerPhotoURL: creatorPhotoURL,
    }

    // add task tags
    if (feedObject.commentsAmount && feedObject.commentsAmount > 0) {
        objectData.feedTaskTags.push({ icon: 'message-circle', text: `${feedObject.commentsAmount} Comments` })
    }
    if (feedObject.assigneeEstimation && feedObject.assigneeEstimation > 0) {
        objectData.feedTaskTags.push({
            icon: `count-circle-${getEstimationIconByValue(projectId, feedObject.assigneeEstimation)}`,
            text: getEstimationTagText(projectId, feedObject.assigneeEstimation),
        })
    }
    if (feedObject.recurrence && feedObject.recurrence.toLowerCase() !== RECURRENCE_NEVER) {
        objectData.feedTaskTags.push({ icon: 'rotate-cw', text: RECURRENCE_MAP[feedObject.recurrence].large })
    }

    /**
     * Default will fire for:
     * [ FEED_TASK_CREATED | FEED_TASK_DELETED | FEED_TASK_TITLE_CHANGED | FEED_TASK_DUE_DATE_CHANGED |
     *   FEED_TASK_ASSIGNEE_ESTIMATION_CHANGED | FEED_TASK_RECURRENCE_CHANGED | FEED_TASK_PROJECT_CHANGED_TO |
     *   FEED_TASK_PROJECT_CHANGED_FROM | FEED_TASK_PRIVACY_CHANGED | FEED_TASK_HIGHLIGHTED_CHANGED | FEED_TASK_FOCUS_CHANGED | FEED_TASK_ASSISTANT_CHANGED |
     *   FEED_TASK_REVIEWER_ESTIMATION_CHANGED | FEED_TASK_CHECKED_DONE | FEED_TASK_UNCHECKED_DONE | FEED_TASK_FOLLOWED
     * | FEED_TASK_UNFOLLOWED | FEED_TASK_OBSERVER_ESTIMATION_CHANGED ]
     */

    switch (feed.type) {
        case FEED_TASK_ASSIGNEE_CHANGED:
            feedData.feedAction = 'changed assignee • From '
            feedData.feedPrevPhoto = oldAssigneeAvatarURL
            feedData.feedCurrPhoto = newAssigneeAvatarURL
            feedData.feedPrevName = oldAssigneeName
            feedData.feedCurrName = newAssigneeName
            break
        case FEED_TASK_MOVED_IN_WORKFLOW:
            feedData.feedAction = `send ${feed.isForward ? 'forward' : 'backward'} in Workflow • From `
            feedData.feedPrevPhoto = fromStepAvatarURL
            feedData.feedCurrPhoto = toStepAvatarURL
            feedData.feedPrevName = feed.fromStepDescription
            feedData.feedCurrName = feed.toStepDescription
            break
        case FEED_TASK_GIVE_KARMA:
            feedData.feedAction = 'gave Karma Point • To'
            feedData.feedKarmaUserPhoto = ratedFeedOwnerAvatar
            feedData.feedKarmaUserName = ratedFeedOwnerName
            break
        case FEED_TASK_TO_ANOTHER_USER:
            feedData.feedOwnerName = creatorName
            feedData.feedAction = 'created a task assigned to'
            feedData.feedAssigneeAvatarURL = assigneeAvatarURL
            feedData.feedAssigneeName = assigneeName
            break
        case FEED_TASK_PROJECT_CHANGED_TO:
            feedData.feedOwnerName = creatorName
            feedData.feedAction = 'changed project • Moved to'
            feedData.feedTargetProjectName = feed.projectName
            feedData.feedTargetProjectColor = feed.projectColor
            break
        case FEED_TASK_PROJECT_CHANGED_FROM:
            feedData.feedOwnerName = creatorName
            feedData.feedAction = 'changed project • Moved from'
            feedData.feedTargetProjectName = feed.projectName
            feedData.feedTargetProjectColor = feed.projectColor
            break
        case FEED_TASK_PARENT_GOAL:
            feedData.feedOwnerName = creatorName
            feedData.feedAction = 'changed linked goal'
            break
        default:
            feedData.feedOwnerName = null
            feedData.feedAction = feed.entryText
            break
    }

    batch.set(db.doc(`/notifications/${user.uid}`), userData, { merge: true })
    batch.set(db.doc(`/notifications/${user.uid}/objects/task@${objectId}`), objectData, { merge: true })
    batch.set(db.doc(`/notifications/${user.uid}/objects/task@${objectId}/feeds/${getId()}`), feedData, { merge: true })
}

let endOfToday = null

export function initTimeProvider() {
    endOfToday = moment().endOf('day').toDate().getTime()
    const intervale = setInterval(() => {
        if (Date.now() > endOfToday) {
            clearInterval(intervale)
            store.dispatch(setShowNewDayNotification(true))
        }
    }, 60000)
}

//NOTES

export async function createNoteFeedsChain(projectId, noteId, noteData) {
    const feedCreator = store.getState().loggedUser
    const batch = new BatchWrapper(db)

    const mentionedUserIds = getMentionedUsersIdsWhenEditText(noteData.extendedTitle, '')
    insertFollowersUserToFeedChain(mentionedUserIds, [], [noteData.userId], noteId, batch)

    await createNoteCreatedFeed(projectId, noteData, noteId, batch)

    if (noteData.isPrivate) {
        await createNotePrivacyChangedFeed(projectId, noteId, true, noteData.isPublicFor, batch)
    }

    const hasStar = noteData.hasStar.toLowerCase() !== '#ffffff'
    if (hasStar) {
        await updateNoteHighlightFeedsChain(projectId, true, noteId)
    }

    if (noteData.stickyData.days > 0) {
        await updateNoteStickyDataFeedsChain(projectId, noteData.stickyData.days, noteId)
    }

    await processFollowersWhenEditTexts(
        projectId,
        FOLLOWER_NOTES_TYPE,
        noteId,
        noteData,
        feedCreator.uid !== noteData.userId ? [...mentionedUserIds, noteData.userId] : mentionedUserIds,
        true,
        batch
    )

    batch.commit()
}

export async function createNoteUpdatedFeedsChain(projectId, noteId, noteData, oldNoteData) {
    const batch = new BatchWrapper(db)

    await updateNoteTitleFeedsChain(projectId, oldNoteData, noteData.extendedTitle, noteId)

    if (noteData.isPrivate !== oldNoteData.isPrivate) {
        await createNotePrivacyChangedFeed(projectId, noteId, noteData.isPrivate, noteData.isPublicFor, batch)
    }

    const hasStar = noteData.hasStar.toLowerCase() !== '#ffffff'
    const oldHasStar = oldNoteData.hasStar.toLowerCase() !== '#ffffff'
    if (hasStar !== oldHasStar) {
        await updateNoteHighlightFeedsChain(projectId, hasStar, noteId)
    }

    if (noteData.stickyData.days !== oldNoteData.stickyData.days) {
        await updateNoteStickyDataFeedsChain(projectId, noteData.stickyData.days, noteId)
    }

    batch.commit()
}

export const trackStickyNote = async (projectId, noteId, stickyEndDate) => {
    await db.doc(`stickyNotesData/${noteId}`).set({ projectId, stickyEndDate })
}

export const untrackStickyNote = noteId => {
    db.doc(`stickyNotesData/${noteId}`).delete()
}

export async function updateNoteStickyDataFeedsChain(projectId, days, noteId) {
    if (days > 0) {
        const batch = new BatchWrapper(db)
        await createNoteStickyFeed(projectId, days, noteId, batch)
        const followNoteData = {
            followObjectsType: FOLLOWER_NOTES_TYPE,
            followObjectId: noteId,
            feedCreator: store.getState().loggedUser,
        }
        await tryAddFollower(projectId, followNoteData, batch)
        batch.commit()
    }
}

export async function updateNoteTitleFeedsChain(projectId, note, title, noteId) {
    const batch = new BatchWrapper(db)

    const mentionedUserIds = getMentionedUsersIdsWhenEditText(title, note.extendedTitle)
    insertFollowersUserToFeedChain(mentionedUserIds, [], [], noteId, batch)
    await processFollowersWhenEditTexts(projectId, FOLLOWER_NOTES_TYPE, noteId, note, mentionedUserIds, true, batch)

    await createNoteNameChangedFeed(projectId, note.title, title, noteId, batch)
    batch.commit()
}

export function insertFollowersUserToFeedChain(
    objectMentionedUsersIds,
    commentMentionedUsers,
    objectOwnersIds,
    objectId,
    batch
) {
    const { loggedUser } = store.getState()
    const mentionsIds = objectMentionedUsersIds ? [...objectMentionedUsersIds] : []
    const commentMentionsIds = commentMentionedUsers ? commentMentionedUsers.map(mention => mention.uid) : []
    const feedChainFollowersIds = uniq([...mentionsIds, ...commentMentionsIds])
    addUniqueInstanceTypeToArray(feedChainFollowersIds, loggedUser.uid)

    for (let i = 0; i < objectOwnersIds.length; i++) {
        const ownerId = objectOwnersIds[i]
        addUniqueInstanceTypeToArray(feedChainFollowersIds, ownerId)
    }

    batch.feedChainFollowersIds = { [objectId]: feedChainFollowersIds }
}

export function getMentionedUsersIdsWhenEditText(newText, oldText) {
    const newMentionsIds = TasksHelper.getMentionIdsFromTitle(newText)
    const oldMentionsIds = TasksHelper.getMentionIdsFromTitle(oldText)
    return difference(newMentionsIds, oldMentionsIds)
}

export async function updateNotePrivacyFeedsChain(projectId, isPrivate, isPublicFor, noteId) {
    const batch = new BatchWrapper(db)
    await createNotePrivacyChangedFeed(projectId, noteId, isPrivate, isPublicFor, batch)
    const followNoteData = {
        followObjectsType: FOLLOWER_NOTES_TYPE,
        followObjectId: noteId,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followNoteData, batch)
    batch.commit()
}

export async function updateNoteHighlightFeedsChain(projectId, isHighlighted, noteId) {
    const batch = new BatchWrapper(db)
    await createNoteHighlightedChangedFeed(projectId, noteId, isHighlighted, batch)
    const followNoteData = {
        followObjectsType: FOLLOWER_NOTES_TYPE,
        followObjectId: noteId,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followNoteData, batch)
    batch.commit()
}

export async function getNotesByProject(projectId) {
    const notesDocs = (await db.collection(`noteItems/${projectId}/notes`).orderBy('title').get()).docs
    const notesList = []
    for (let note of notesDocs) {
        notesList.push(mapNoteData(note.id, note.data()))
    }
    return notesList
}

export async function watchFollowedTabNotesExpanded(projectId, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotes2(projectId)
    let cacheChanges = []
    notesUnsubs2[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .where('isVisibleInFollowedFor', 'array-contains', loggedUserId)
        .where('stickyData.days', '==', 0)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            cacheChanges = processNotesCacheResultsAndCallback(querySnapshot, cacheChanges, callback, false)
        })
}

export async function watchFollowedTabNotes(projectId, maxNotesToRender, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotes2(projectId)
    let cacheChanges = []
    notesUnsubs2[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .orderBy('lastEditionDate', 'desc')
        .where('isVisibleInFollowedFor', 'array-contains', loggedUserId)
        .where('stickyData.days', '==', 0)
        .limit(maxNotesToRender)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            cacheChanges = processNotesCacheResultsAndCallback(querySnapshot, cacheChanges, callback, false)
        })
}

export async function watchFollowedTabNotesExpandedInAllProjects(projectId, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotes2(projectId)
    let cacheChanges = []
    notesUnsubs2[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .where('isVisibleInFollowedFor', 'array-contains', loggedUserId)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            cacheChanges = processNotesCacheResultsAndCallback(querySnapshot, cacheChanges, callback, false)
        })
}

export async function watchFollowedTabNotesInAllProjects(projectId, maxNotesToRender, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotes2(projectId)
    let cacheChanges = []
    notesUnsubs2[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .orderBy('lastEditionDate', 'desc')
        .where('isVisibleInFollowedFor', 'array-contains', loggedUserId)
        .limit(maxNotesToRender)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            cacheChanges = processNotesCacheResultsAndCallback(querySnapshot, cacheChanges, callback, false)
        })
}

export async function watchFollowedTabStickyNotes(projectId, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchStickyNotes(projectId)
    let cacheChanges = []
    stickyNotesUnsubs = db
        .collection(`noteItems/${projectId}/notes`)
        .where('isVisibleInFollowedFor', 'array-contains', loggedUserId)
        .where('stickyData.days', '>', 0)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            cacheChanges = processNotesCacheResultsAndCallback(querySnapshot, cacheChanges, callback, true)
        })
}

export async function watchAllTabNotesExpanded(projectId, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotes2(projectId)
    let cacheChanges = []
    notesUnsubs2[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .where('stickyData.days', '==', 0)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            cacheChanges = processNotesCacheResultsAndCallback(querySnapshot, cacheChanges, callback, false)
        })
}

export async function watchAllTabNotes(projectId, maxNotesToRender, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotes2(projectId)
    let cacheChanges = []
    notesUnsubs2[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .orderBy('lastEditionDate', 'desc')
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .where('stickyData.days', '==', 0)
        .limit(maxNotesToRender)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            cacheChanges = processNotesCacheResultsAndCallback(querySnapshot, cacheChanges, callback, false)
        })
}

export async function watchAllTabNotesExpandedInAllProjects(projectId, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotes2(projectId)
    let cacheChanges = []
    notesUnsubs2[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            cacheChanges = processNotesCacheResultsAndCallback(querySnapshot, cacheChanges, callback, false)
        })
}

export async function watchAllTabNotesInAllProjects(projectId, maxNotesToRender, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotes2(projectId)
    let cacheChanges = []
    notesUnsubs2[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .orderBy('lastEditionDate', 'desc')
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .limit(maxNotesToRender)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            cacheChanges = processNotesCacheResultsAndCallback(querySnapshot, cacheChanges, callback, false)
        })
}

export async function watchAllTabStickyNotes(projectId, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchStickyNotes(projectId)
    let cacheChanges = []
    stickyNotesUnsubs = db
        .collection(`noteItems/${projectId}/notes`)
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .where('stickyData.days', '>', 0)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            cacheChanges = processNotesCacheResultsAndCallback(querySnapshot, cacheChanges, callback, true)
        })
}

const processNotesCacheResultsAndCallback = (querySnapshot, cacheChanges, callback, isStickyWatcher) => {
    const changes = querySnapshot.docChanges()
    if (querySnapshot.metadata.fromCache) {
        return [...cacheChanges, ...changes]
    } else {
        const mergedChanges = [...cacheChanges, ...changes]
        callback(mergedChanges)
        if (!isStickyWatcher) {
            store.dispatch(stopLoadingData())
        }
        return []
    }
}

export async function watchFollowedTabNotesNeedShowMore(projectId, notesToLoad, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotesNeedShowMore(projectId)
    notesNeedsShowMoreUnsubs[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .where('isVisibleInFollowedFor', 'array-contains', loggedUserId)
        .where('stickyData.days', '==', 0)
        .limit(notesToLoad)
        .onSnapshot(querySnapshot => {
            callback(querySnapshot.docs.length)
        })
}

export async function watchFollowedTabNotesNeedShowMoreInAllProjects(projectId, notesToLoad, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotesNeedShowMore(projectId)
    notesNeedsShowMoreUnsubs[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .orderBy('lastEditionDate', 'desc')
        .where('isVisibleInFollowedFor', 'array-contains', loggedUserId)
        .limit(notesToLoad)
        .onSnapshot(querySnapshot => {
            callback(querySnapshot.docs.length)
        })
}

export async function watchAllTabNotesNeedShowMore(projectId, notesToLoad, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotesNeedShowMore(projectId)
    notesNeedsShowMoreUnsubs[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .orderBy('lastEditionDate', 'desc')
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .where('stickyData.days', '==', 0)
        .limit(notesToLoad)
        .onSnapshot(querySnapshot => {
            callback(querySnapshot.docs.length)
        })
}

export async function watchAllTabNotesNeedShowMoreInAllProjects(projectId, notesToLoad, callback) {
    const loggedUserId = store.getState().loggedUser.uid
    unwatchNotesNeedShowMore(projectId)
    notesNeedsShowMoreUnsubs[projectId] = db
        .collection(`noteItems/${projectId}/notes`)
        .orderBy('lastEditionDate', 'desc')
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .limit(notesToLoad)
        .onSnapshot(querySnapshot => {
            callback(querySnapshot.docs.length)
        })
}

export function unwatchNotesNeedShowMore(projectId) {
    if (notesNeedsShowMoreUnsubs[projectId]) {
        notesNeedsShowMoreUnsubs[projectId]()
    }
}

export function unwatchNotes2(projectId) {
    if (notesUnsubs2[projectId]) {
        notesUnsubs2[projectId]()
    }
}

export function unwatchStickyNotes(projectId) {
    if (stickyNotesUnsubs) {
        stickyNotesUnsubs()
    }
}

export async function watchNotes(projectId, uid, callback) {
    const unsub = db.collection(`noteItems/${projectId}/notes`).onSnapshot(querySnapshot => {
        callback(querySnapshot.docChanges())
    })

    notesUnsubs[projectId] = { [uid]: unsub }
}

export async function unwatchNotes(projectId, uid) {
    if (notesUnsubs[projectId] && notesUnsubs[projectId][uid]) {
        notesUnsubs[projectId][uid]()
    }
}

export async function watchNote(objectId, noteId, callback) {
    const unsub = db.doc(`noteItems/${objectId}/notes/${noteId}`).onSnapshot(doc => {
        let note = null
        if (doc.data() !== undefined) {
            note = mapNoteData(doc.id, doc.data())
        }
        callback(note)
    })

    if (noteUnsub[objectId]) {
        noteUnsub[objectId][noteId] = unsub
    } else {
        noteUnsub[objectId] = { [noteId]: unsub }
    }
}

export async function unwatchNote(projectId, noteId) {
    if (noteUnsub && noteUnsub[projectId] != null && noteUnsub[projectId][noteId] != null) {
        noteUnsub[projectId][noteId]()
    }
}

export async function watchObjectLTag(objectType, path, watchId, callback) {
    if (!hasProperty(linkTagsUnsubs, [objectType, path, watchId])) {
        const unsub = db.doc(path).onSnapshot(doc => {
            const objectData = doc.data() != null ? { ...doc.data(), id: doc.id, uid: doc.id } : null
            callback(objectData, path, watchId)
        })

        setProperty(linkTagsUnsubs, [objectType, path, watchId], unsub)
    }
}

export async function unwatchObjectLTag(objectType, path, watchId) {
    if (hasProperty(linkTagsUnsubs, [objectType, path, watchId])) {
        linkTagsUnsubs[objectType][path][watchId]()
        delete linkTagsUnsubs[objectType][path][watchId]
    }
}

export function watchFeedObjectLastState(watchId, projectId, objectType, objectId, callback) {
    feedObjectsLastStates[watchId] = db
        .doc(`/feedsObjectsLastStates/${projectId}/${objectType}/${objectId}`)
        .onSnapshot(feedObject => {
            callback(feedObject.data())
        })
}

export function unwatchFeedObjectLastState(watchId) {
    feedObjectsLastStates[watchId] ? feedObjectsLastStates[watchId]() : null
}

export function watchLinkedNotes(projectId, uid, linkedParentObject, callback) {
    const unsub = db
        .collection(`noteItems/${projectId}/notes`)
        .where(linkedParentObject.idsField, 'array-contains', linkedParentObject.id)
        .onSnapshot(querySnapshot => {
            db.collection(`noteItems/${projectId}/notes`)
                .where(linkedParentObject.idsField, 'array-contains', linkedParentObject.id)
                .get()
                .then(res => {
                    callback(res.docs)
                })
            // callback(querySnapshot.docChanges())
        })

    linkedNotesUnsubs[projectId] = { [uid]: unsub }
}

export function unwatchLinkedNotes(projectId, uid) {
    if (linkedNotesUnsubs[projectId] && linkedNotesUnsubs[projectId][uid]) {
        linkedNotesUnsubs[projectId][uid]()
    }
}

export async function getNoteData(objectId, noteId) {
    const storageRef = notesStorage.ref()
    return storageRef
        .child(`notesData/${objectId}/${noteId}`)
        .getDownloadURL()
        .then(url => {
            return new Promise(function (resolve, reject) {
                const xhr = new XMLHttpRequest()
                xhr.open('GET', url)
                xhr.responseType = 'arraybuffer'
                xhr.onload = function () {
                    if (this.status >= 200 && this.status < 300) {
                        resolve(xhr.response)
                    } else {
                        reject({
                            status: this.status,
                            statusText: xhr.statusText,
                        })
                    }
                }
                xhr.onerror = function () {
                    reject({
                        status: this.status,
                        statusText: xhr.statusText,
                    })
                }
                xhr.send()
            })

            // return fetch(url)
            //     .then(response => response.blob())
            //     .then(data => data.arrayBuffer())
        })
        .catch(error => {
            console.log('Note data not exists: ' + error)
            return null
        })
}

export async function startEditNoteFeedsChain(projectId, noteId) {
    const batch = new BatchWrapper(db)
    await createNoteEditingFeed(projectId, noteId, batch)
    batch.commit()
}

export async function getNoteMeta(objectId, noteId) {
    const noteData = (await db.doc(`noteItems/${objectId}/notes/${noteId}`).get()).data()
    return noteData ? mapNoteData(noteId, noteData) : null
}

export function setLinkedParentObjects(projectId, linkedParents, linkedObject, initialLinks) {
    const extractIdsInto = (destArr, sourceArr, idIndex) => {
        for (let url of sourceArr) {
            destArr.push(url.split('/')[idIndex])
        }
    }

    const {
        linkedParentNotesUrl,
        linkedParentTasksUrl,
        linkedParentContactsUrl,
        linkedParentProjectsUrl,
        linkedParentGoalsUrl,
        linkedParentSkillsUrl,
        linkedParentAssistantsUrl,
    } = linkedParents

    if (
        linkedObject.isUpdatingNotes &&
        Object.keys(linkedObject.secondaryParentsIds).length > 0 &&
        (linkedObject.secondaryParentsIds.linkedParentContactsIds.length > 0 || linkedParentContactsUrl.length > 0)
    ) {
        const array = linkedObject.secondaryParentsIds.linkedParentContactsIds
        for (item of linkedParentContactsUrl) {
            const userId = item.split('/')[6]
            array.push(userId)
        }
    }

    if (!isEmpty(initialLinks)) {
        const {
            initialLinkedNotesUrl,
            initialLinkedTasksUrl,
            initialLinkedContactsUrl,
            initialLinkedProjectsUrl,
            initialLinkedGoalsUrl,
            initialLinkedSkillsUrl,
            initialLinkedAssistantsUrl,
        } = initialLinks

        const { loggedUser } = store.getState()

        for (let link of HelperFunctions.getDifference(linkedParentTasksUrl, initialLinkedTasksUrl)) {
            const taskId = link.split('/')[6]
            createBacklinkTaskFeed(projectId, linkedObject.id, linkedObject.type, taskId)
            updateTaskEditionData(projectId, taskId, loggedUser.uid)
        }

        for (let link of HelperFunctions.getDifference(linkedParentContactsUrl, initialLinkedContactsUrl)) {
            const userId = link.split('/')[6]
            if (TasksHelper.getUserInProject(projectId, userId)) {
                createBacklinkUserFeed(projectId, linkedObject.id, linkedObject.type, userId)
                updateUserEditionData(userId, loggedUser.uid)
            } else {
                createBacklinkContactFeed(projectId, linkedObject.id, linkedObject.type, userId)
                updateContactEditionData(projectId, userId, loggedUser.uid)
            }
        }

        for (let link of HelperFunctions.getDifference(linkedParentProjectsUrl, initialLinkedProjectsUrl)) {
            createBacklinkProjectFeed(projectId, linkedObject.id, linkedObject.type, link)
        }

        for (let link of HelperFunctions.getDifference(linkedParentGoalsUrl, initialLinkedGoalsUrl)) {
            const goalId = link.split('/')[6]
            createBacklinkGoalFeed(projectId, linkedObject.id, linkedObject.type, goalId)
            updateGoalEditionData(projectId, goalId, loggedUser.uid)
        }

        for (let link of HelperFunctions.getDifference(linkedParentSkillsUrl, initialLinkedSkillsUrl)) {
            const skillId = link.split('/')[6]
            createBacklinkSkillFeed(projectId, linkedObject.id, linkedObject.type, skillId, FEED_SKILL_BACKLINK)
            updateSkillEditionData(projectId, skillId, loggedUser.uid)
        }

        for (let link of HelperFunctions.getDifference(linkedParentAssistantsUrl, initialLinkedAssistantsUrl)) {
            const assistantId = link.split('/')[6]
            if (!isGlobalAssistant(assistantId))
                createBacklinkAssistantFeed(
                    projectId,
                    linkedObject.id,
                    linkedObject.type,
                    assistantId,
                    FEED_ASSISTANT_BACKLINK
                )
            updateAssistantEditionData(projectId, assistantId, loggedUser.uid)
        }

        for (let link of HelperFunctions.getDifference(linkedParentNotesUrl, initialLinkedNotesUrl)) {
            const noteId = link.split('/')[6]
            createBacklinkNoteFeed(projectId, linkedObject.id, linkedObject.type, noteId)
            updateNoteEditionData(projectId, noteId, loggedUser.uid)
        }
    }

    const linkedParentNotesIds = []
    const linkedParentTasksIds = []
    const linkedParentContactsIds = []
    const linkedParentProjectsIds = []
    const linkedParentGoalsIds = []
    const linkedParentSkillsIds = []
    const linkedParentAssistantIds = []

    const updateObject = {
        linkedParentNotesIds,
        linkedParentTasksIds,
        linkedParentContactsIds,
        linkedParentProjectsIds,
        linkedParentGoalsIds,
        linkedParentSkillsIds,
        linkedParentAssistantIds,
    }

    extractIdsInto(linkedParentNotesIds, linkedParentNotesUrl, 6)
    extractIdsInto(linkedParentTasksIds, linkedParentTasksUrl, 6)
    extractIdsInto(linkedParentContactsIds, linkedParentContactsUrl, 6)
    extractIdsInto(linkedParentProjectsIds, linkedParentProjectsUrl, 4)
    extractIdsInto(linkedParentGoalsIds, linkedParentGoalsUrl, 6)
    extractIdsInto(linkedParentSkillsIds, linkedParentSkillsUrl, 6)
    extractIdsInto(linkedParentAssistantIds, linkedParentAssistantsUrl, 6)

    if (linkedObject.type === 'note') {
        const { notePartEdited } = linkedObject
        const secondaryParentsIds = linkedObject.secondaryParentsIds
            ? {
                  linkedParentNotesIds: [],
                  linkedParentTasksIds: [],
                  linkedParentContactsIds: [],
                  linkedParentProjectsIds: [],
                  linkedParentGoalsIds: [],
                  linkedParentSkillsIds: [],
                  linkedParentAssistantIds: [],
                  ...linkedObject.secondaryParentsIds,
              }
            : {
                  linkedParentNotesIds: [],
                  linkedParentTasksIds: [],
                  linkedParentContactsIds: [],
                  linkedParentProjectsIds: [],
                  linkedParentGoalsIds: [],
                  linkedParentSkillsIds: [],
                  linkedParentAssistantIds: [],
              }

        if (notePartEdited === 'title') {
            updateObject.linkedParentsInTitleIds = { ...updateObject }
        } else {
            updateObject.linkedParentsInContentIds = { ...updateObject }
        }

        const unduplicatedParentNotesIds = secondaryParentsIds.linkedParentNotesIds.filter(
            id => !linkedParentNotesIds.includes(id)
        )
        const unduplicatedParentTasksIds = secondaryParentsIds.linkedParentTasksIds.filter(
            id => !linkedParentTasksIds.includes(id)
        )
        const unduplicatedParentContactsIds = secondaryParentsIds.linkedParentContactsIds.filter(
            id => !linkedParentContactsIds.includes(id)
        )
        const unduplicatedParentProjectsIds = secondaryParentsIds.linkedParentProjectsIds.filter(
            id => !linkedParentProjectsIds.includes(id)
        )
        const unduplicatedParentGoalsIds = secondaryParentsIds.linkedParentGoalsIds.filter(
            id => !linkedParentGoalsIds.includes(id)
        )
        const unduplicatedParentSkillsIds = secondaryParentsIds.linkedParentSkillsIds.filter(
            id => !linkedParentSkillsIds.includes(id)
        )
        const unduplicatedParentAssistantIds = secondaryParentsIds.linkedParentAssistantIds.filter(
            id => !linkedParentAssistantIds.includes(id)
        )
        updateObject.linkedParentNotesIds = [...updateObject.linkedParentNotesIds, ...unduplicatedParentNotesIds]
        updateObject.linkedParentTasksIds = [...updateObject.linkedParentTasksIds, ...unduplicatedParentTasksIds]
        updateObject.linkedParentContactsIds = [
            ...updateObject.linkedParentContactsIds,
            ...unduplicatedParentContactsIds,
        ]
        updateObject.linkedParentProjectsIds = [
            ...updateObject.linkedParentProjectsIds,
            ...unduplicatedParentProjectsIds,
        ]
        updateObject.linkedParentGoalsIds = [...updateObject.linkedParentGoalsIds, ...unduplicatedParentGoalsIds]
        updateObject.linkedParentSkillsIds = [...updateObject.linkedParentSkillsIds, ...unduplicatedParentSkillsIds]
        updateObject.linkedParentAssistantIds = [
            ...updateObject.linkedParentAssistantIds,
            ...unduplicatedParentAssistantIds,
        ]
    }

    const actions = {
        task: () => db.doc(`items/${projectId}/tasks/${linkedObject.id}`).update(updateObject),
        note: () => db.doc(`noteItems/${projectId}/notes/${linkedObject.id}`).update(updateObject),
    }

    actions[linkedObject.type]()

    // Commenting this by Customer request
    // logEvent('new_backlinks', {
    //     parentTypes: {
    //         note: linkedParentNotesIds.length > 0,
    //         task: linkedParentTasksIds.length > 0,
    //         contact: linkedParentContactsIds.length > 0,
    //         project: linkedParentProjectsIds.length > 0,    //
    //         goals: linkedParentGoalsIds.length > 0,
    //         skills: linkedParentSkillsIds.length > 0,
    //         skills: linkedParentAssistantIds.length > 0,
    //     },
    //     childType: linkedObject.type,
    //     childId: linkedObject.id,
    // })
}

export function watchNotesCollab(noteId, callback) {
    db.doc(`notesCollab/${noteId}`).onSnapshot(doc => {
        callback(doc.data())
    })
}

export function addNoteEditor(noteId, editor) {
    db.doc(`notesCollab/${noteId}`).set(
        {
            editors: firebase.firestore.FieldValue.arrayUnion(editor),
        },
        { merge: true }
    )
}

export function removeNoteEditor(noteId, editor) {
    db.doc(`notesCollab/${noteId}`).set(
        {
            editors: firebase.firestore.FieldValue.arrayRemove(editor),
        },
        { merge: true }
    )
}

export function createGenericTasksForMentionsInNoteContent(projectId, noteId, mentionedUserIds, assistantId) {
    createGenericTaskWhenMention(projectId, noteId, mentionedUserIds, GENERIC_NOTE_TYPE, 'notes', assistantId)
}

export async function setNoteProjectFeedsChain(oldOwner, newOwner, newProject, currentProject, note, noteId) {
    const batch = new BatchWrapper(db)
    await createNoteProjectChangedFeed(newProject.id, noteId, 'from', currentProject.name, currentProject.color, batch)
    await createNoteProjectChangedFeed(currentProject.id, noteId, 'to', newProject.name, newProject.color, batch)

    if (oldOwner && newOwner) {
        await createNoteOwnerChangedFeed(newProject.id, newOwner, oldOwner, note, batch)
    } else {
        const followNoteData = {
            followObjectsType: FOLLOWER_NOTES_TYPE,
            followObjectId: noteId,
            followObject: note,
            feedCreator: store.getState().loggedUser,
        }

        await tryAddFollower(newProject.id, followNoteData, batch)
    }

    batch.commit()
}

export async function setNoteOwnerFeedsChain(projectId, note, newOwner, oldOwner, noteId) {
    const batch = new BatchWrapper(db)
    await createNoteOwnerChangedFeed(projectId, newOwner, oldOwner, note, batch)
    const followNoteData = {
        followObjectsType: FOLLOWER_NOTES_TYPE,
        followObjectId: noteId,
        followObject: note,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followNoteData, batch)
    batch.commit()
}

export async function generateNTSToken() {
    const generateNTSToken = functions.httpsCallable('generateNTSTokenSecondGen')
    return generateNTSToken()
}

export function connectToConverter(data, callback) {
    const convertVideos = functions.httpsCallable('convertVideosSecondGen')
    return convertVideos(data, callback)
}

export function connectToGmail(data, callback) {
    const createApiEmailTasks = functions.httpsCallable('createApiEmailTasksSecondGen')
    return createApiEmailTasks(data, callback)
}

async function getAndDeleteLinkedGuideNote(projectId, noteId) {
    const note = await getNote(projectId, noteId)
    if (note) await deleteNote(projectId, note, null)
}

export async function deleteLinkedGuidesNotesIfProjectIsTemplate(projectId, note) {
    const project = ProjectHelper.getProjectById(projectId)
    if (project) {
        const { guideProjectIds, templateCreatorId, isTemplate } = project
        const { parentObject, isVisibleInFollowedFor } = note

        const isTemplateCreatorObjectNote = parentObject && parentObject.id === templateCreatorId
        const isTemplateParentNote =
            isTemplate &&
            (!parentObject || isTemplateCreatorObjectNote) &&
            isVisibleInFollowedFor.includes(templateCreatorId)

        if (isTemplateParentNote) {
            const promises = []
            guideProjectIds.forEach(guideId => {
                const guideNoteId = isTemplateCreatorObjectNote ? guideId + templateCreatorId : guideId + note.id
                promises.push(getAndDeleteLinkedGuideNote(guideId, guideNoteId))
            })
            await Promise.all(promises)
        }
    }
}

export async function deleteNoteFeedsChain(projectId, note, noteId) {
    const batch = new BatchWrapper(db)
    await createNoteDeletedFeed(projectId, noteId, batch)
    const followNoteData = {
        followObjectsType: FOLLOWER_NOTES_TYPE,
        followObjectId: noteId,
        followObject: note,
        feedCreator: store.getState().loggedUser,
        actionType: 'delete',
    }
    await tryAddFollower(projectId, followNoteData, batch)
    batch.commit()
}

/////////////////FOLLOWER SYSTEM ///////////////////////////

export async function tryAddFollower(projectId, followData, externalBatch) {
    const { followObjectsType, followObjectId, feedCreator } = followData
    const userFollowingId = feedCreator.uid
    const followedObjects = (await db.doc(`followers/${projectId}/${followObjectsType}/${followObjectId}`).get()).data()
    if (
        !followedObjects ||
        !followedObjects.usersFollowing ||
        !followedObjects.usersFollowing.includes(userFollowingId)
    ) {
        await addFollower(projectId, followData, externalBatch)
    }
}

const updateEditonForFollowUnfollowAnObject = async (projectId, objectId, type, editorId) => {
    if (type === FOLLOWER_TOPICS_TYPE) {
        await updateChatEditionData(projectId, objectId, editorId)
    } else if (type === FOLLOWER_ASSISTANTS_TYPE) {
        await updateAssistantEditionData(projectId, objectId, editorId)
    } else if (type === FOLLOWER_CONTACTS_TYPE) {
        await updateContactEditionData(projectId, objectId, editorId)
    } else if (type === FOLLOWER_USERS_TYPE) {
        await updateUserEditionData(objectId, editorId)
    } else if (type === FOLLOWER_SKILLS_TYPE) {
        await updateSkillEditionData(projectId, objectId, editorId)
    } else if (type === FOLLOWER_TASKS_TYPE) {
        await updateTaskEditionData(projectId, objectId, editorId)
    } else if (type === FOLLOWER_GOALS_TYPE) {
        await updateGoalEditionData(projectId, objectId, editorId)
    } else if (type === FOLLOWER_NOTES_TYPE) {
        await updateNoteEditionData(projectId, objectId, editorId)
    }
}

export async function addFollowerWithoutFeeds(
    projectId,
    userFollowingId,
    followObjectsType,
    followObjectId,
    actionType,
    externalBatch
) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(db)
    const entry = { [followObjectsType]: {} }
    entry[followObjectsType][followObjectId] = true
    const userFollowingRef = db.doc(`usersFollowing/${projectId}/entries/${userFollowingId}`)
    batch.set(userFollowingRef, entry, { merge: true })

    const followersRef = db.doc(`followers/${projectId}/${followObjectsType}/${followObjectId}`)
    batch.set(
        followersRef,
        { usersFollowing: firebase.firestore.FieldValue.arrayUnion(userFollowingId) },
        { merge: true }
    )
    !externalBatch && batch.commit()

    if (followObjectsType === 'notes' && actionType !== 'delete') {
        const note = (await db.doc(`noteItems/${projectId}/notes/${followObjectId}`).get()).data()
        if (note) {
            const updateData = { followersIds: firebase.firestore.FieldValue.arrayUnion(userFollowingId) }
            if (note.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || note.isPublicFor.includes(userFollowingId)) {
                updateData.isVisibleInFollowedFor = firebase.firestore.FieldValue.arrayUnion(userFollowingId)
            }
            db.doc(`noteItems/${projectId}/notes/${followObjectId}`).set(updateData, { merge: true })
        }
    }
}

async function getObject(projectId, objectId, objectType) {
    if (objectType === 'tasks') {
        return await getTaskData(projectId, objectId)
    } else if (objectType === 'projects') {
        return await getProjectData(projectId)
    } else if (objectType === 'contacts') {
        return await getContactData(projectId, objectId)
    } else if (objectType === 'users') {
        return await getUserData(objectId, false)
    } else if (objectType === 'customs') {
        return await getFeedObjectLastState(projectId, 'customs', objectId)
    } else if (objectType === 'notes') {
        return await getNote(projectId, objectId)
    } else if (objectType === 'goals') {
        return await getGoalData(projectId, objectId)
    } else if (objectType === 'skills') {
        return await getSkillData(projectId, objectId)
    } else if (objectType === 'assistants') {
        return await getAssistantData(projectId, objectId)
    }
}

export async function addFollower(projectId, followData, externalBatch) {
    let { followObjectsType, followObjectId, followObject, feedCreator, project, actionType } = followData
    const userFollowingId = feedCreator.uid

    const batch = externalBatch ? externalBatch : new BatchWrapper(db)

    updateEditonForFollowUnfollowAnObject(projectId, followObjectId, followObjectsType, userFollowingId)
    addFollowerWithoutFeeds(projectId, userFollowingId, followObjectsType, followObjectId, actionType, batch)
    addFollowerToChat(projectId, followObjectId, userFollowingId)

    if (!followObject) followObject = await getObject(projectId, followObjectId, followObjectsType)
    if (
        followObject &&
        (followObject.noteId || (followObject.noteIdsByProject && followObject.noteIdsByProject[projectId]))
    ) {
        addFollowerWithoutFeeds(
            projectId,
            userFollowingId,
            'notes',
            followObject.noteId || followObject.noteIdsByProject[projectId],
            null,
            batch
        )
    }

    if (followObjectsType === 'tasks') {
        await createTaskFollowedFeed(projectId, followObjectId, userFollowingId, batch, feedCreator)

        const subtaskIds = followObject
            ? followObject.subtaskIds
            : await getFeedObjectLastState(projectId, followObjectsType, followObjectId).subtaskIds
        if (subtaskIds) {
            subtaskIds.forEach(subtaskId => {
                updateEditonForFollowUnfollowAnObject(projectId, subtaskId, followObjectsType, userFollowingId)
                addFollowerWithoutFeeds(projectId, userFollowingId, followObjectsType, subtaskId, null, batch)
                addFollowerToChat(projectId, subtaskId, userFollowingId)
            })
        }
    } else if (followObjectsType === 'projects') {
        await createProjectFollowedFeed(projectId, followObject, userFollowingId, batch, feedCreator)
    } else if (followObjectsType === 'contacts') {
        await createContactFollowedFeed(projectId, followObject, followObjectId, userFollowingId, batch, feedCreator)
    } else if (followObjectsType === 'users') {
        await createUserFollowedFeed(
            projectId,
            followObject,
            followObjectId,
            userFollowingId,
            batch,
            feedCreator,
            project
        )
    } else if (followObjectsType === 'notes') {
        await createNoteFollowedFeed(projectId, followObjectId, userFollowingId, batch, feedCreator)
    } else if (followObjectsType === 'goals') {
        await createGoalFollowedFeed(projectId, followObjectId, userFollowingId, batch, feedCreator)
    } else if (followObjectsType === 'skills') {
        await createSkillFollowedFeed(projectId, followObjectId, userFollowingId, batch, feedCreator)
    } else if (followObjectsType === 'assistants') {
        if (!isGlobalAssistant(followObjectId))
            await createAssistantFollowedFeed(projectId, followObjectId, userFollowingId, batch, feedCreator)
    }

    if (!externalBatch) {
        await batch.commit()
    }
}

async function removeFollowerWithoutFeeds(projectId, userFollowingId, followObjectsType, followObjectId, batch) {
    updateEditonForFollowUnfollowAnObject(projectId, followObjectId, followObjectsType, userFollowingId)

    const userFollowingRef = db.doc(`usersFollowing/${projectId}/entries/${userFollowingId}`)
    batch.update(userFollowingRef, {
        [`${followObjectsType}.${followObjectId}`]: firebase.firestore.FieldValue.delete(),
    })

    batch.set(
        db.doc(`followers/${projectId}/${followObjectsType}/${followObjectId}`),
        { usersFollowing: firebase.firestore.FieldValue.arrayRemove(userFollowingId) },
        { merge: true }
    )

    if (followObjectsType === 'notes') {
        const note = (await db.doc(`noteItems/${projectId}/notes/${followObjectId}`).get()).data()
        if (note) {
            const updateData = {
                followersIds: firebase.firestore.FieldValue.arrayRemove(userFollowingId),
                isVisibleInFollowedFor: firebase.firestore.FieldValue.arrayRemove(userFollowingId),
            }
            db.doc(`noteItems/${projectId}/notes/${followObjectId}`).set(updateData, { merge: true })
        }
    }
}

export async function removeFollower(projectId, followData, externalBatch) {
    const { followObjectsType, followObjectId, followObject, feedCreator } = followData
    const userId = feedCreator.uid

    const batch = externalBatch ? externalBatch : new BatchWrapper(db)

    removeFollowerWithoutFeeds(projectId, userId, followObjectsType, followObjectId, batch)
    removeFollowerFromChat(projectId, followObjectId, userId)

    if (followObject.noteId || (followObject.noteIdsByProject && followObject.noteIdsByProject[projectId]))
        removeFollowerWithoutFeeds(
            projectId,
            userId,
            'notes',
            followObject.noteId || followObject.noteIdsByProject[projectId],
            batch
        )

    if (followObjectsType === 'users') {
        await createUserUnfollowedFeed(projectId, followObject, followObjectId, batch, feedCreator)
    } else if (followObjectsType === 'contacts') {
        await createContactUnfollowedFeed(projectId, followObject, followObjectId, batch, feedCreator)
    } else if (followObjectsType === 'projects') {
        await createProjectUnfollowedFeed(projectId, followObject, batch, feedCreator)
    } else if (followObjectsType === 'tasks') {
        await createTaskUnfollowedFeed(projectId, followObjectId, batch, feedCreator)

        const subtaskIds = followObject
            ? followObject.subtaskIds
            : await getFeedObjectLastState(projectId, followObjectsType, followObjectId).subtaskIds

        if (subtaskIds) {
            subtaskIds.forEach(subtaskId => {
                removeFollowerWithoutFeeds(projectId, userId, followObjectsType, subtaskId, batch)
                removeFollowerFromChat(projectId, subtaskId, userId)
                deleteObjectFeedCounter(projectId, userId, subtaskId, followObjectsType, BOTH_TABS, batch)
                deleteObjectFeedStore(projectId, userId, subtaskId, 'followed')
            })
        }
    } else if (followObjectsType === 'notes') {
        if (followObject) await deleteLinkedGuidesNotesIfProjectIsTemplate(projectId, followObject)
        await createNoteUnfollowedFeed(projectId, followObjectId, batch, feedCreator)
    } else if (followObjectsType === 'goals') {
        await createGoalUnfollowedFeed(projectId, followObjectId, batch, feedCreator)
    } else if (followObjectsType === 'skills') {
        await createSkillUnfollowedFeed(projectId, followObjectId, batch, feedCreator)
    } else if (followObjectsType === 'assistants') {
        if (!isGlobalAssistant(followObjectId))
            await createAssistantUnfollowedFeed(projectId, followObjectId, batch, feedCreator)
    }

    if (!externalBatch) {
        await batch.commit()
    }
}

export async function watchFollowers(projectId, followObjectsType, followObjectId, callback, watchId = false) {
    const unsub = db.doc(`followers/${projectId}/${followObjectsType}/${followObjectId}`).onSnapshot(doc => {
        const parsedDoc = doc.data()
        callback(parsedDoc ? parsedDoc.usersFollowing : [])
    })

    if (watchId && !hasProperty(followersUnsubsList, [projectId, followObjectsType, followObjectId, watchId])) {
        setProperty(followersUnsubsList, [projectId, followObjectsType, followObjectId, watchId], unsub)
        followersUnsubsList = unsub
    } else {
        followersUnsubs = unsub
    }
}

export async function unsubsWatchFollowers(projectId, followObjectsType, followObjectId, watchId = false) {
    if (watchId && hasProperty(followersUnsubsList, [projectId, followObjectsType, followObjectId, watchId])) {
        followersUnsubsList[projectId][followObjectsType][followObjectId][watchId]()
        delete followersUnsubsList[projectId][followObjectsType][followObjectId][watchId]
    } else {
        followersUnsubs()
    }
}

/////////////////////////////NEW VERSION OF FEEDS V4//////////////////////////

export async function unsubNewFeedsTab(projectId, tab) {
    feedsCountUnsub[tab][projectId]()
}

export async function watchAllNewFeedsAllTabs(projects, userId, followedCallback, allCallback) {
    for (let i = 0; i < projects.length; i++) {
        const projectId = projects[i].id
        watchNewFeedsAllTabs(projectId, userId, followedCallback, allCallback)
    }
}

export function watchNewFeedsAllTabs(projectId, userId, followedCallback, allCallback) {
    watchNewFeedsTab(projectId, userId, 'followed', followedCallback)
    watchNewFeedsTab(projectId, userId, 'all', allCallback)
}

function watchNewFeedsTab(projectId, userId, tab, callback) {
    const MAX_NEW_FEEDS_TO_SHOW = 99
    feedsCountUnsub[tab][projectId] = db
        .doc(`/feedsCount/${projectId}/${userId}/${tab}`)
        .onSnapshot(notificationsData => {
            const newFeedsData = selectNewFeeds(notificationsData.data(), MAX_NEW_FEEDS_TO_SHOW, userId)
            callback(projectId, newFeedsData)
        })
}

function selectNewFeeds(newFeeds, amountFeedsToShow, userId) {
    const newFeedsData = { feedsAmount: 0, feedsData: [] }
    if (newFeeds) {
        const objectTypes = Object.keys(newFeeds)
        let linealFeeds = []
        if (objectTypes.length > 0) {
            for (let t = 0; t < objectTypes.length; t++) {
                const type = objectTypes[t]
                const objectsIds = Object.keys(newFeeds[type])
                if (objectsIds.length > 0) {
                    for (let i = 0; i < objectsIds.length; i++) {
                        const objectId = objectsIds[i]
                        const feeds = newFeeds[type][objectId]

                        if (!feeds.isPrivate || feeds.isPrivate === userId) {
                            delete feeds.isPrivate
                            const feedsIds = Object.keys(feeds)

                            for (let n = 0; n < feedsIds.length; n++) {
                                const feedId = feedsIds[n]
                                const feedData = feeds[feedId]
                                feedData.feed.id = feedId
                                feedData.feed.objectId = objectId
                                feedData.objectId = objectId
                                feedData.objectTypes = type
                                linealFeeds.push(feedData.feed)
                            }
                        }
                    }

                    orderFeedsByDate(linealFeeds)

                    newFeedsData.feedsAmount = linealFeeds.length
                    newFeedsData.feedsData = linealFeeds.slice(0, amountFeedsToShow)
                }
            }
        }
    }

    return newFeedsData
}

function orderFeedsByDate(feedsData) {
    feedsData.sort(function (a, b) {
        if (a.lastChangeDate > b.lastChangeDate) {
            return -1
        }
        if (a.lastChangeDate < b.lastChangeDate) {
            return 1
        }
        return 0
    })
}

export function resetAllNewFeeds(projectId, feedActiveTab) {
    const loggedUserId = store.getState().loggedUser.uid
    const notificationPath = feedActiveTab === FOLLOWED_TAB ? 'followed' : 'all'
    db.doc(`feedsCount/${projectId}/${loggedUserId}/${notificationPath}`).delete()
}

export async function unsubStoreFeedsTab(projectId) {
    feedsReduxStoreUnsub.followed[projectId] ? feedsReduxStoreUnsub.followed[projectId]() : null
    feedsReduxStoreUnsub.all[projectId] ? feedsReduxStoreUnsub.all[projectId]() : null
}

export function watchNewFeedsAllTabsRedux(projectId, userId) {
    const followedPath = `/feedsStore/${projectId}/${userId}/feeds/followed`
    watchNewFeedsTabRedux(projectId, 'followed', followedPath, storeFollowedFeeds)

    const allPath = `/feedsStore/${projectId}/all`
    watchNewFeedsTabRedux(projectId, 'all', allPath, storeAllFeeds)
}

function storeFollowedFeeds(projectId, feeds) {
    store.dispatch([setFollowedFeeds(projectId, feeds), stopLoadingData()])
}

function storeAllFeeds(projectId, feeds) {
    store.dispatch([setAllFeeds(projectId, feeds), stopLoadingData()])
}

function watchNewFeedsTabRedux(projectId, tab, path, callback) {
    store.dispatch(startLoadingData())
    const MAX_NUMBER_OF_FEEDS_TO_SHOW = 99
    const MAX_NUMBER_OF_FEEDS_TO_REVIEW = 200
    const { loggedUser, currentUser } = store.getState()
    const loggedUserId = loggedUser.uid
    const currentUserId = currentUser.uid
    feedsReduxStoreUnsub[tab][projectId] = db
        .collection(path)
        .limit(MAX_NUMBER_OF_FEEDS_TO_REVIEW)
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .orderBy('lastChangeDate', 'desc')
        .onSnapshot(feedsData => {
            const feeds = []
            feedsData.forEach(doc => {
                const feed = doc.data()
                if (feed.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || feed.isPublicFor.includes(currentUserId)) {
                    feed.id = doc.id
                    feeds.push(feed)
                }
            })
            feeds.splice(MAX_NUMBER_OF_FEEDS_TO_SHOW)
            callback(projectId, feeds)
        })
}

export async function getFeedObject(projectId, dateFormated, objectId, feedType, lastChangeDate) {
    const object = (await db.doc(`projectsFeeds/${projectId}/${dateFormated}/${objectId}`).get()).data()
    if (object) {
        object.id = objectId
        return object
    } else {
        const objectType = getFeedObjectTypes(feedType)
        const feedObject = await generateMissingFeedObject(
            projectId,
            dateFormated,
            objectType,
            objectId,
            lastChangeDate
        )
        feedObject.id = objectId
        return feedObject
    }
}

async function generateMissingFeedObject(projectId, dateFormated, objectType, objectId, lastChangeDate) {
    let feedObject = null
    if (objectType === 'tasks') {
        const task = (await getTaskData(projectId, objectId)) || TasksHelper.getNewDefaultTask()
        feedObject = generateTaskObjectModel(lastChangeDate, task, objectId)
    } else if (objectType === 'projects') {
        const project = ProjectHelper.getProjectById(projectId)
        feedObject = generateProjectObjectModel(lastChangeDate, project)
    } else if (objectType === 'contacts') {
        const contact = await getContactData(projectId, objectId)
        feedObject = generateContactObjectModel(lastChangeDate, contact, objectId)
    } else if (objectType === 'users') {
        const { loggedUser } = store.getState()
        feedObject = generateUserObjectModel(lastChangeDate, objectId, loggedUser.assistantId)
    } else if (objectType === 'notes') {
        const note = await getNote(projectId, objectId)
        feedObject = generateNoteObjectModel(lastChangeDate, note, objectId)
    } else if (objectType === 'goals') {
        const goal = await getGoalData(projectId, objectId)
        feedObject = generateGoalObjectModel(lastChangeDate, goal, objectId)
    } else if (objectType === 'skills') {
        const skill = await getSkillData(projectId, objectId)
        feedObject = generateSkillObjectModel(lastChangeDate, skill, objectId)
    } else if (objectType === 'assistants') {
        const assistant = await getAssistantData(projectId, objectId)
        feedObject = generateAssistantObjectModel(lastChangeDate, assistant, objectId)
    }
    const batch = new BatchWrapper(db)
    batch.set(db.doc(`projectsFeeds/${projectId}/${dateFormated}/${objectId}`), feedObject)
    setFeedObjectLastState(projectId, objectType, objectId, feedObject, batch)
    batch.commit()
    return feedObject
}

export async function getLastObjectFeed(projectId, objectTypes, feedObjectId, nLast = 1, callback) {
    const feeds = []
    const feedsData = await db
        .collection(`projectsInnerFeeds/${projectId}/${objectTypes}/${feedObjectId}/feeds/`)
        .limit(nLast)
        .orderBy('lastChangeDate', 'desc')
        .get()

    feedsData.forEach(doc => {
        const feed = doc.data()
        feed.id = doc.id
        feed.projectId = projectId
        feeds.push(feed)
    })
    callback(feeds)
}

export function watchDetailedViewFeeds(projectId, objectTypes, feedObjectId, callback) {
    const MAX_NUMBER_OF_FEEDS_TO_SHOW = 99
    const { loggedUser } = store.getState()
    const loggedUserId = loggedUser.uid
    feedsDetailedViewUnsub = db
        .collection(`projectsInnerFeeds/${projectId}/${objectTypes}/${feedObjectId}/feeds/`)
        .limit(MAX_NUMBER_OF_FEEDS_TO_SHOW)
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
        .orderBy('lastChangeDate', 'desc')
        .onSnapshot(feedsData => {
            const feeds = []
            feedsData.forEach(doc => {
                const feed = doc.data()
                feed.id = doc.id
                feeds.push(feed)
            })
            callback(feeds)
        })
}

export function unsubDetailedViewFeeds() {
    feedsDetailedViewUnsub ? feedsDetailedViewUnsub() : null
}

function deleteObjectFeedCounter(projectId, userId, objectId, objectTypes, tabsToRemove, externalBatch) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(db)
    const entryObjectsCounter = {
        [objectTypes]: { [objectId]: firebase.firestore.FieldValue.delete() },
    }

    if (tabsToRemove === FOLLOWED_TAB || tabsToRemove === BOTH_TABS) {
        batch.set(db.doc(`/feedsCount/${projectId}/${userId}/followed`), entryObjectsCounter, { merge: true })
    }
    if (tabsToRemove === ALL_TAB || tabsToRemove === BOTH_TABS) {
        batch.set(db.doc(`/feedsCount/${projectId}/${userId}/all`), entryObjectsCounter, { merge: true })
    }

    if (!externalBatch) {
        batch.commit()
    }
}

async function deleteObjectFeedStore(projectId, userId, objectId, path) {
    const feedsToDelete = (
        await db.collection(`/feedsStore/${projectId}/${userId}/feeds/${path}`).where('objectId', '==', objectId).get()
    ).docs

    const batch = new BatchWrapper(db)
    feedsToDelete.forEach(feedDoc => {
        batch.delete(db.doc(`/feedsStore/${projectId}/${userId}/feeds/${path}/${feedDoc.id}`))
    })
    batch.commit()
}

////////// FEEDS COUNT //////////////////

export function getProjectUsersIds(projectId) {
    const { projectUsers } = store.getState()
    return projectUsers[projectId]?.map(user => user.uid) || []
}

export async function increaseFeedCount(
    currentDateFormated,
    projectUsersIdsForSpecialFeeds,
    projectId,
    objectsType,
    objectId,
    batch,
    feedId,
    feed,
    feedObject,
    notificationData
) {
    const loggedUserId = store.getState().loggedUser.uid
    const followersIds = await getObjectFollowers(projectId, objectsType, objectId, batch)

    const usersWithAccessIds =
        feed.isPublicFor && !feed.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
            ? feed.isPublicFor
            : projectUsersIdsForSpecialFeeds.length > 0
            ? projectUsersIdsForSpecialFeeds
            : batch.projectUsersIdsForSpecialFeeds &&
              batch.projectUsersIdsForSpecialFeeds[objectId] &&
              batch.projectUsersIdsForSpecialFeeds[objectId].length > 0
            ? batch.projectUsersIdsForSpecialFeeds[objectId]
            : getProjectUsersIds(projectId)

    const usersToNotifyIds = usersWithAccessIds.filter(userId => userId !== loggedUserId)
    const entryObjectsCounter = generateFeedCounterEntry(currentDateFormated, objectsType, objectId, feedId, feed)

    storeAllTabFeeds(projectId, feedId, feed, batch)

    followersIds.forEach(userId => {
        storeFollowedTabFeeds(projectId, userId, feedId, feed, batch)
    })

    usersToNotifyIds.forEach(userId => {
        const newFeedNotificationPath = followersIds.includes(userId) ? 'followed' : 'all'
        increaseNewFeedCount(
            projectId,
            userId,
            objectsType,
            objectId,
            batch,
            feed,
            feedObject,
            newFeedNotificationPath,
            entryObjectsCounter,
            notificationData
        )
    })
}

async function getObjectFollowers(projectId, objectsType, objectId, batch) {
    if (!batch.followersIds || !batch.followersIds[objectId]) {
        const followersIds = await getObjectFollowersIds(projectId, objectsType, objectId)

        const feedChainFollowersIds =
            batch.feedChainFollowersIds && batch.feedChainFollowersIds[objectId]
                ? batch.feedChainFollowersIds[objectId]
                : []

        const newFollowersIds = feedChainFollowersIds.filter(uid => !followersIds.includes(uid))
        const totalFollowersIds = [...followersIds, ...newFollowersIds]
        batch.followersIds = { ...batch.followersIds, [objectId]: totalFollowersIds }
    }
    return batch.followersIds[objectId]
}

export async function getObjectFollowersIds(projectId, objectsType, objectId) {
    const followersIds = (await db.doc(`followers/${projectId}/${objectsType}/${objectId}`).get()).data()
    return followersIds && followersIds.usersFollowing ? followersIds.usersFollowing : []
}

function generateFeedCounterEntry(currentDateFormated, objectsType, objectId, feedId, feed) {
    const entryData = {
        dateFormated: currentDateFormated,
        feed,
    }

    return {
        [objectsType]: { [objectId]: { [feedId]: entryData } },
    }
}

function storeFollowedTabFeeds(projectId, userId, feedId, feed, batch) {
    batch.set(db.doc(`/feedsStore/${projectId}/${userId}/feeds/followed/${feedId}`), feed, {
        merge: true,
    })
}

function storeAllTabFeeds(projectId, feedId, feed, batch) {
    batch.set(db.doc(`/feedsStore/${projectId}/all/${feedId}`), feed, {
        merge: true,
    })
}

async function increaseNewFeedCount(
    projectId,
    userId,
    objectsType,
    objectId,
    batch,
    feed,
    feedObject,
    notificationPath,
    entryObjectsCounter,
    notificationData
) {
    batch.set(db.doc(`/feedsCount/${projectId}/${userId}/${notificationPath}`), entryObjectsCounter, {
        merge: true,
    })

    if (
        objectsType !== 'notes' &&
        objectsType !== 'goals' &&
        objectsType !== 'skills' &&
        objectsType !== 'assistants'
    ) {
        registerFeedEmail(projectId, userId, objectsType, objectId, feed, feedObject, notificationData)
        sendPushNotifications(projectId, userId, objectsType, objectId, feed, feedObject, notificationData)
    }
}

//// ROBOT FOR CLEAN FEEDS

const MAX_AMOUNT_OF_FEEDS_STORED = 200

export function cleanStoreFeeds(projectId, projectUsersIds) {
    deleteOldFeeds(`feedsStore/${projectId}/all`)

    projectUsersIds.forEach(userId => {
        deleteOldFeeds(`feedsStore/${projectId}/${userId}/feeds/followed`)
    })
}

export async function cleanInnerFeeds(projectId, objectId, objectTypes) {
    deleteOldFeeds(`projectsInnerFeeds/${projectId}/${objectTypes}/${objectId}/feeds`)
}

async function deleteOldFeeds(path) {
    const feedsDocs = (await db.collection(path).orderBy('lastChangeDate', 'desc').get()).docs
    const feedsIds = []
    feedsDocs.forEach(function (doc) {
        feedsIds.push(doc.id)
    })

    feedsIds.splice(0, MAX_AMOUNT_OF_FEEDS_STORED)
    feedsIds.forEach(id => {
        db.doc(`${path}/${id}`).delete()
    })
}

export function cleanNewFeeds(projectId, projectUsersIds) {
    projectUsersIds.forEach(userId => {
        cleanNewFeedsTab(projectId, userId, 'followed')
        cleanNewFeedsTab(projectId, userId, 'all')
    })
}

async function cleanNewFeedsTab(projectId, userId, tab) {
    const newFeeds = (await db.doc(`/feedsCount/${projectId}/${userId}/${tab}`).get()).data()
    const linealFeeds = parseNewFeeds(newFeeds)

    const toLeftNewFeeds = linealFeeds.splice(0, MAX_AMOUNT_OF_FEEDS_STORED)
    const newFeedsObject = parseInvertedNewFeeds(toLeftNewFeeds)

    db.doc(`/feedsCount/${projectId}/${userId}/${tab}`).set(newFeedsObject)
}

function parseNewFeeds(newFeeds) {
    const linealFeeds = []
    if (newFeeds) {
        const objectTypes = Object.keys(newFeeds)
        if (objectTypes.length > 0) {
            for (let t = 0; t < objectTypes.length; t++) {
                const type = objectTypes[t]
                const objectsIds = Object.keys(newFeeds[type])
                if (objectsIds.length > 0) {
                    for (let i = 0; i < objectsIds.length; i++) {
                        const objectId = objectsIds[i]
                        const feeds = newFeeds[type][objectId]
                        const feedsIds = Object.keys(feeds)

                        for (let n = 0; n < feedsIds.length; n++) {
                            const feedId = feedsIds[n]
                            const feed = feeds[feedId].feed
                            const dateFormated = feeds[feedId].dateFormated
                            feed.id = feedId
                            feed.objectId = objectId
                            feed.objectTypes = type
                            feed.dateFormated = dateFormated
                            linealFeeds.push(feed)
                        }
                    }
                }
            }
        }
    }
    orderFeedsByDate(linealFeeds)
    return linealFeeds
}

function parseInvertedNewFeeds(newFeeds) {
    let newFeedsObject = {}
    newFeeds.forEach(newFeed => {
        const { id, objectId, dateFormated, objectTypes } = newFeed
        delete newFeed.id
        delete newFeed.dateFormated
        delete newFeed.objectTypes

        const cleanFeed = { dateFormated, feed: newFeed }
        const cleanObject = { [id]: cleanFeed }
        if (newFeedsObject[objectTypes]) {
            if (newFeedsObject[objectTypes][objectId]) {
                newFeedsObject[objectTypes][objectId] = {
                    ...newFeedsObject[objectTypes][objectId],
                    [id]: cleanFeed,
                }
            } else {
                newFeedsObject[objectTypes] = { ...newFeedsObject[objectTypes], [objectId]: cleanObject }
            }
        } else {
            newFeedsObject = { ...newFeedsObject, [objectTypes]: { [objectId]: cleanObject } }
        }
    })
    return newFeedsObject
}

export function storeOldFeeds(projectId, formatedDate, feedObjectId, feedObject, feedId, feed) {
    db.doc(`oldFeeds/${projectId}/${formatedDate}/${feedObjectId}`).set(feedObject, { merge: true })
    db.doc(`oldFeeds/${projectId}/${formatedDate}/${feedObjectId}/feeds/${feedId}`).set(feed)
    logEvent('update_feeds', {
        objectId: feedObjectId,
        objectType: feedObject.type,
        feedId: feedId,
        feedType: feed.type,
    })
}

export function acceptJoinEvent(projectId, roomId, userEmail) {
    const load = db.collection(`events/${projectId}/rooms`).doc(roomId)
    load.get().then(function (doc) {
        if (doc.exists) {
            const guests = doc.data().guests
            const foundIndex = doc.data().guests.findIndex(x => x.email === userEmail)
            guests[foundIndex] = { attend: 1, email: userEmail }
            db.collection(`events/${projectId}/rooms`).doc(roomId).update({ guests })
        }
    })
}

export function rejectJoinEvent(projectId, roomId, userEmail, reasons, callback) {
    const load = db.collection(`events/${projectId}/rooms`).doc(roomId)
    load.get().then(function (doc) {
        if (doc.exists) {
            const guests = doc.data().guests
            const foundIndex = doc.data().guests.findIndex(x => x.email === userEmail)
            guests[foundIndex] = { attend: -1, email: userEmail, reasons }
            db.collection(`events/${projectId}/rooms`)
                .doc(roomId)
                .update({ guests })
                .then(() => callback)
        }
    })
}

export function deleteEvent(projectId, roomId) {
    db.collection(`events/${projectId}/rooms`).doc(roomId).delete()
}

export function getMeetings(projectId, setMeetings, setZero) {
    db.collection(`events/${projectId}/rooms`).onSnapshot(function handleSnapshot(snapshot) {
        const meets = snapshot.docs
            .filter(item => item)
            .map(doc => {
                return {
                    id: doc.id,
                    ...doc.data(),
                }
            })
        setMeetings(meets)
        setZero()
    })
}

export async function getPaymentOnce(userId) {
    const paymant = (await db.doc(`/payments/${userId}`).get()).data()
    if (paymant) {
        return paymant
    }
    return null
}

export function getObjectFromUrl(objectType, url, callback) {
    const urlParts = url.split('/')

    if (objectType === 'task') {
        // It's a note object

        db.doc(`items/${urlParts[4]}/tasks/${urlParts[6]}`)
            .get()
            .then(doc => {
                if (doc.exists) {
                    callback({ object: doc.data(), objectName: doc.data().name })
                } else {
                    callback({ object: null, objectName: `Doesn't exist` })
                }
            })
    } else if (objectType === 'note') {
        // It's a tasks object
        db.doc(`${`noteItems`}/${urlParts[4]}/notes/${urlParts[6]}`)
            .get()
            .then(doc => {
                if (doc.exists) {
                    callback({ object: doc.data(), objectName: doc.data().title })
                } else {
                    callback({ object: null, objectName: `Doesn't exist` })
                }
            })
    } else if (objectType === 'contact') {
        // It's a contacts object

        const promises = [getUserData(urlParts[6], false), getContactData(urlParts[4], urlParts[6])]
        Promise.all(promises).then(res => {
            if (res[0]) {
                callback({ object: res[0], objectName: res[0].displayName })
            } else if (res[1]) {
                callback({ object: res[1], objectName: res[1].displayName }, true)
            } else {
                callback({ object: null, objectName: `Contact doesn't exist` })
            }
        })
    } else if (objectType === 'goal') {
        // It's a goals object
        getGoalData(urlParts[4], urlParts[6]).then(goal => {
            if (goal) {
                callback({ object: goal, objectName: goal.extendedName })
            } else {
                callback({ object: null, objectName: `Doesn't exist` })
            }
        })
    } else if (objectType === 'skill') {
        // It's a skills object
        getSkillData(urlParts[4], urlParts[6]).then(skill => {
            if (skill) {
                callback({ object: skill, objectName: skill.extendedName })
            } else {
                callback({ object: null, objectName: `Doesn't exist` })
            }
        })
    } else if (objectType === 'topic') {
        // It's a topic object
        db.doc(`feedsObjectsLastStates/${urlParts[4]}/customs/${urlParts[6]}`)
            .get()
            .then(doc => {
                if (doc.exists) {
                    callback({ object: doc.data(), objectName: doc.data().name })
                } else {
                    callback({ object: null, objectName: `Doesn't exist` })
                }
            })
    } else if (objectType === 'assistant') {
        // It's an assistant object
        getAssistantData(urlParts[4], urlParts[6]).then(assistant => {
            if (assistant) {
                callback({ object: assistant, objectName: assistant.displayName })
            } else {
                callback({ object: null, objectName: `Doesn't exist` })
            }
        })
    }
}

export async function sendPushNotification(data) {
    const sendPushNotification = functions.httpsCallable('sendPushNotificationSecondGen')
    sendPushNotification(data)
}

//MENTION ALL

export function watchSubtasks(projectId, taskId, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = db
        .collection(`items/${projectId}/tasks`)
        .where('parentId', '==', taskId)
        .onSnapshot(subtasksData => {
            const subtasks = []
            subtasksData.forEach(doc => {
                const subtask = doc.data()
                subtask.id = doc.id
                subtasks.push(subtask)
            })
            callback(subtasks)
        })
}

export function unwatch(watcherKey) {
    if (globalWatcherUnsub[watcherKey]) {
        globalWatcherUnsub[watcherKey]()
        delete globalWatcherUnsub[watcherKey]
    }
}

//GOALS ////

async function processFollowersAssignessInGoals(projectId, assigneesIds, goal, mentionedUserIds, batch) {
    const { loggedUser: feedCreator } = store.getState()
    for (let i = 0; i < assigneesIds.length; i++) {
        const assigneeId = assigneesIds[i]
        if (feedCreator.uid !== assigneeId && !mentionedUserIds.includes(assigneeId)) {
            const assignee = TasksHelper.getUserInProject(projectId, assigneeId)
            if (assignee) {
                const followGoalAssigneeData = {
                    followObjectsType: FOLLOWER_GOALS_TYPE,
                    followObjectId: goal.id,
                    followObject: goal,
                    feedCreator: assignee,
                }
                await addFollower(projectId, followGoalAssigneeData, batch)
            }
        }
    }
}

export async function createGoalUpdatesChain(projectId, goal) {
    const batch = new BatchWrapper(db)

    const fullText = goal.extendedName + ' ' + goal.description
    const mentionedUserIds = getMentionedUsersIdsWhenEditText(fullText, '')
    insertFollowersUserToFeedChain(mentionedUserIds, [], goal.assigneesIds, goal.id, batch)

    await createGoalCreatedFeed(projectId, goal, null, goal.id, batch)

    if (goal.assigneesIds.length > 0) {
        await createGoalAssigeesChangedFeed(projectId, [], goal.assigneesIds, goal.id, batch)
    }

    if (goal.hasStar !== '#FFFFFF') {
        await createGoalHighlightedChangedFeed(projectId, goal.id, goal.hasStar, batch)
    }

    if (goal.description.trim() !== '') {
        await createGoalDescriptionChangedFeed(projectId, '', goal.description, goal.id, batch)
    }

    if (!isEqual(goal.isPublicFor, [FEED_PUBLIC_FOR_ALL])) {
        await updateGoalPrivacyFeedsChain(projectId, goal.isPublicFor, goal.id, goal, batch)
    }

    for (let i = 0; i < goal.assigneesIds.length; i++) {
        const assigneeId = goal.assigneesIds[i]
        const newCapacity = goal.assigneesCapacity[assigneeId]
        if (newCapacity && newCapacity !== CAPACITY_NONE) {
            await createGoalCapacityChangedFeed(projectId, goal.id, assigneeId, CAPACITY_NONE, newCapacity, batch)
        }
    }

    await processFollowersAssignessInGoals(projectId, goal.assigneesIds, goal, mentionedUserIds, batch)

    await processFollowersWhenEditTexts(projectId, FOLLOWER_GOALS_TYPE, goal.id, goal, mentionedUserIds, true, batch)

    batch.commit()
}

export async function deleteGoalFeedsChain(projectId, goal) {
    const batch = new BatchWrapper(db)
    await createGoalDeletedFeed(projectId, goal.id, batch)

    const followGoalData = {
        followObjectsType: FOLLOWER_GOALS_TYPE,
        followObjectId: goal.id,
        followObject: goal,
        feedCreator: store.getState().loggedUser,
    }

    await tryAddFollower(projectId, followGoalData, batch)

    batch.commit()
}

export async function updateGoalUpdatesChain(projectId, oldGoal, updatedGoal, avoidFollow) {
    const { loggedUser } = store.getState()
    const batch = new BatchWrapper(db)

    const mentionedUserIds = getMentionedUsersIdsWhenEditText(updatedGoal.extendedName, oldGoal.extendedName)

    const newAssigneesIds = updatedGoal.assigneesIds.filter(id => !oldGoal.assigneesIds.includes(id))
    insertFollowersUserToFeedChain(mentionedUserIds, [], newAssigneesIds, updatedGoal.id, batch)

    if (avoidFollow) {
        batch.feedChainFollowersIds[updatedGoal.id] = batch.feedChainFollowersIds[updatedGoal.id].filter(
            uid => uid !== loggedUser.uid
        )
    }

    if (oldGoal.extendedName !== updatedGoal.extendedName) {
        await createGoalNameChangedFeed(
            projectId,
            oldGoal.extendedName,
            updatedGoal.extendedName,
            updatedGoal.id,
            batch
        )
    }
    if (oldGoal.description !== updatedGoal.description) {
        await updateGoalDescriptionFeedsChain(
            projectId,
            updatedGoal.id,
            updatedGoal.description,
            updatedGoal,
            oldGoal.description,
            batch
        )
    }

    if (!isEqual(oldGoal.assigneesIds, updatedGoal.assigneesIds)) {
        await createGoalAssigeesChangedFeed(
            projectId,
            oldGoal.assigneesIds,
            updatedGoal.assigneesIds,
            updatedGoal.id,
            batch
        )
    }

    if (!isEqual(oldGoal.isPublicFor, updatedGoal.isPublicFor)) {
        await updateGoalPrivacyFeedsChain(projectId, updatedGoal.isPublicFor, updatedGoal.id, updatedGoal, batch)
    }

    for (let i = 0; i < updatedGoal.assigneesIds.length; i++) {
        const assigneeId = updatedGoal.assigneesIds[i]
        const oldCapacity = oldGoal.assigneesCapacity[assigneeId]
        const newCapacity = updatedGoal.assigneesCapacity[assigneeId]
        if (newCapacity !== oldCapacity && !(!oldCapacity && newCapacity === CAPACITY_NONE)) {
            await createGoalCapacityChangedFeed(projectId, updatedGoal.id, assigneeId, oldCapacity, newCapacity, batch)
        }
    }

    if (oldGoal.progress !== updatedGoal.progress) {
        await createGoalProgressChangedFeed(projectId, updatedGoal.progress, updatedGoal.id, batch)
    }

    if (oldGoal.hasStar !== updatedGoal.hasStar) {
        await createGoalHighlightedChangedFeed(projectId, updatedGoal.id, updatedGoal.hasStar !== '#FFFFFF', batch)
    }

    const newAssigneesIdsToFollow = avoidFollow
        ? newAssigneesIds.filter(uid => uid !== loggedUser.uid)
        : newAssigneesIds
    const mentionedUserIdsToFollow = avoidFollow
        ? mentionedUserIds.filter(uid => uid !== loggedUser.uid)
        : mentionedUserIds

    await processFollowersAssignessInGoals(
        projectId,
        newAssigneesIdsToFollow,
        updatedGoal,
        mentionedUserIdsToFollow,
        batch
    )

    await processFollowersWhenEditTexts(
        projectId,
        FOLLOWER_GOALS_TYPE,
        updatedGoal.id,
        updatedGoal,
        mentionedUserIdsToFollow,
        avoidFollow ? false : true,
        batch
    )

    batch.commit()
}

export async function updateGoalHighlightFeedsChain(projectId, hasStar, goal) {
    const batch = new BatchWrapper(db)
    await createGoalHighlightedChangedFeed(projectId, goal.id, hasStar !== '#FFFFFF', batch)

    const followGoalData = {
        followObjectsType: FOLLOWER_GOALS_TYPE,
        followObjectId: goal.id,
        followObject: goal,
        feedCreator: store.getState().loggedUser,
    }

    await tryAddFollower(projectId, followGoalData, batch)
    batch.commit()
}

export async function updateGoalProgressFeedsChain(projectId, progress, goal) {
    const batch = new BatchWrapper(db)
    await createGoalProgressChangedFeed(projectId, progress, goal.id, batch)

    const followGoalData = {
        followObjectsType: FOLLOWER_GOALS_TYPE,
        followObjectId: goal.id,
        followObject: goal,
        feedCreator: store.getState().loggedUser,
    }

    await tryAddFollower(projectId, followGoalData, batch)
    batch.commit()
}

export async function updateGoalAssigneesFeedsChain(
    projectId,
    oldAssigneesIds,
    newAssigneesIds,
    goal,
    oldAssigneesCapacity,
    newAssigneesCapacity
) {
    const batch = new BatchWrapper(db)

    if (!isEqual(oldAssigneesIds, newAssigneesIds)) {
        await createGoalAssigeesChangedFeed(projectId, oldAssigneesIds, newAssigneesIds, goal.id, batch)
    }

    for (let i = 0; i < newAssigneesIds.length; i++) {
        const assigneeId = newAssigneesIds[i]
        const oldCapacity = oldAssigneesCapacity[assigneeId]
        const newCapacity = newAssigneesCapacity[assigneeId]

        if (newCapacity !== oldCapacity && !(!oldCapacity && newCapacity === CAPACITY_NONE)) {
            await createGoalCapacityChangedFeed(projectId, goal.id, assigneeId, oldCapacity, newCapacity, batch)
        }
    }

    const newIds = newAssigneesIds.filter(id => !oldAssigneesIds.includes(id))
    await processFollowersAssignessInGoals(projectId, newIds, goal, [], batch)

    const followGoalData = {
        followObjectsType: FOLLOWER_GOALS_TYPE,
        followObjectId: goal.id,
        followObject: goal,
        feedCreator: store.getState().loggedUser,
    }

    await tryAddFollower(projectId, followGoalData, batch)
    batch.commit()
}

export async function updateGoalAssigneesCapacitiesFeedsChain(projectId, goal, oldCapacity, newCapacity, assigneeId) {
    const batch = new BatchWrapper(db)
    if (newCapacity !== oldCapacity && !(!oldCapacity && newCapacity === CAPACITY_NONE)) {
        await createGoalCapacityChangedFeed(projectId, goal.id, assigneeId, oldCapacity, newCapacity, batch)
    }
    const followGoalData = {
        followObjectsType: FOLLOWER_GOALS_TYPE,
        followObjectId: goal.id,
        followObject: goal,
        feedCreator: store.getState().loggedUser,
    }

    await tryAddFollower(projectId, followGoalData, batch)
    batch.commit()
}

export async function updateGoalDescriptionFeedsChain(
    projectId,
    goalId,
    description,
    goal,
    oldDescription,
    externalBatch
) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(db)

    const mentionedUserIds = getMentionedUsersIdsWhenEditText(description, oldDescription)
    insertFollowersUserToFeedChain(mentionedUserIds, [], [], goalId, batch)

    await createGoalDescriptionChangedFeed(projectId, oldDescription, description, goalId, batch)
    await processFollowersWhenEditTexts(projectId, FOLLOWER_GOALS_TYPE, goalId, goal, mentionedUserIds, true, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function updateGoalPrivacyFeedsChain(projectId, isPublicFor, goalId, goal, externalBatch) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(db)
    await createGoalPrivacyChangedFeed(projectId, goalId, goal, isPublicFor, batch)
    const followGoalData = {
        followObjectsType: FOLLOWER_GOALS_TYPE,
        followObjectId: goalId,
        feedCreator: store.getState().loggedUser,
        followObject: goal,
    }
    await tryAddFollower(projectId, followGoalData, batch)
    if (!externalBatch) {
        batch.commit()
    }
}

export async function updateGoalNameFeedsChain(projectId, goalId, oldName, newName, goal) {
    const batch = new BatchWrapper(db)
    const mentionedUserIds = getMentionedUsersIdsWhenEditText(newName, oldName)
    insertFollowersUserToFeedChain(mentionedUserIds, [], [], goalId, batch)
    await createGoalNameChangedFeed(projectId, oldName, newName, goalId, batch)
    await processFollowersWhenEditTexts(projectId, FOLLOWER_GOALS_TYPE, goalId, goal, mentionedUserIds, true, batch)
    batch.commit()
}

export async function updateGoalProjectFeedsChain(oldProject, newProject, goal, assigneesIds) {
    const batch = new BatchWrapper(db)

    const followGoalData = {
        followObjectsType: FOLLOWER_GOALS_TYPE,
        followObjectId: goal.id,
        followObject: goal,
        feedCreator: store.getState().loggedUser,
    }

    await createGoalProjectChangedFeed(newProject.id, goal.id, 'from', oldProject.name, oldProject.color, batch)
    await tryAddFollower(newProject.id, followGoalData, batch)
    await processFollowersAssignessInGoals(newProject.id, assigneesIds, goal, [], batch)

    await createGoalProjectChangedFeed(oldProject.id, goal.id, 'to', newProject.name, newProject.color, batch)
    await tryAddFollower(oldProject.id, followGoalData, batch)

    batch.commit()
}

/// GOALS ENDDD

export async function updateHastagsColors(projectId, text, colorKey, updateColors) {
    const parsedText = text.toLowerCase()
    const hashtagsData = await db
        .collection(`tagsColors/${projectId}/hashtags`)
        .where('text', '==', parsedText)
        .limit(1)
        .get()

    let hashtagId = ''
    hashtagsData.forEach(hashtagDoc => {
        hashtagId = hashtagDoc.id
    })

    if (hashtagId) {
        if (updateColors) {
            dispatchHashtagsColors(projectId, parsedText, colorKey)
            db.doc(`tagsColors/${projectId}/hashtags/${hashtagId}`).set({ colorKey, text: parsedText })
        }
    } else {
        hashtagId = getId()
        dispatchHashtagsColors(projectId, parsedText, colorKey)
        db.doc(`tagsColors/${projectId}/hashtags/${hashtagId}`).set({ colorKey, text: parsedText })
    }
}

export function watchHastagsColors(projectId, hashtagId, text, callback) {
    const parsedText = text.toLowerCase()
    unsubHastagsColors[hashtagId] = db
        .collection(`tagsColors/${projectId}/hashtags`)
        .where('text', '==', parsedText)
        .limit(1)
        .onSnapshot(hashtagsDocs => {
            let colorKey
            hashtagsDocs.forEach(doc => {
                const hashtagData = doc.data()
                colorKey = hashtagData.colorKey
            })
            if (!colorKey) {
                colorKey = COLOR_KEY_4
                hashtagId = getId()
                db.doc(`tagsColors/${projectId}/hashtags/${hashtagId}`).set({ colorKey, text: parsedText })
            }
            dispatchHashtagsColors(projectId, parsedText, colorKey)
            callback?.()
        })
}

function dispatchHashtagsColors(projectId, parsedText, colorKey) {
    const storeState = store.getState()
    if (
        !storeState[projectId] ||
        !storeState[projectId][parsedText] ||
        storeState[projectId][parsedText] !== colorKey
    ) {
        store.dispatch(setHashtagsColors(projectId, parsedText, colorKey))
    }
}

export function unwatchHastagsColors(hashtagId) {
    if (unsubHastagsColors[hashtagId]) {
        unsubHastagsColors[hashtagId]()
        delete unsubHastagsColors[hashtagId]
    }
}

export function getNotesCollaborationServerData() {
    return { NOTES_COLLABORATION_SERVER }
}

export function getIpRegistryVariables() {
    return { IP_REGISTRY_API_KEY }
}

export const getAppUrlHost = () => {
    const { host } = getUrlParts(HOSTING_URL)
    return host
}

export const getHostingUrl = () => {
    return HOSTING_URL
}

export const inProductionEnvironment = () => {
    return CURRENT_ENVIORNMENT === 'Production'
}

export const inStagingEnvironment = () => {
    return CURRENT_ENVIORNMENT === 'Staging'
}

export function getAlgoliaSearchOnlyKeys() {
    return { ALGOLIA_APP_ID, ALGOLIA_SEARCH_ONLY_API_KEY }
}

export function getGiphyApiKey() {
    return { GIPHY_API_KEY }
}

export function getAnalyticsVariables() {
    return { GOOGLE_ANALYTICS_KEY, GOOGLE_ADS_GUIDE_CONVERSION_TAG }
}

export function getSentryVariables() {
    return { SENTRY_DSN }
}

///NOTES REVISION HISTORY

export const updateNotesEditedDailyList = async (projectId, noteId) => {
    await db.doc(`notesEditedDaily/${noteId}`).set({ projectId })
}

export const watchNoteRevisionHistoryCopies = (projectId, noteId, callback) => {
    noteRevisionHistoryCopiesUnsub = db
        .collection(`${'noteItemsVersions'}/${projectId}/${noteId}`)
        .onSnapshot(notesCopiesData => {
            const notesCopies = []
            notesCopiesData.forEach(doc => {
                const noteCopy = doc.data()
                noteCopy.versionId = doc.id
                notesCopies.push(noteCopy)
            })
            callback(notesCopies)
        })
}

export const unwatchNoteRevisionHistoryCopies = () => {
    noteRevisionHistoryCopiesUnsub()
}

export const restoreDailyNoteCopy = async (projectId, noteId, paths) => {
    let promises = []
    promises.push(getNoteVersionData(projectId, noteId, `${paths.noteDailyVersionsData}/${projectId}/${noteId}`))
    promises.push(db.doc(`${paths.noteItemsDailyVersions}/${projectId}/notes/${noteId}`).get())
    promises.push(getNoteData(projectId, noteId))

    const promisesData = await Promise.all(promises)
    const noteContent = promisesData[0]
    const dailyNote = promisesData[1].data()
    const originalNoteContent = promisesData[2]

    const note = {
        title: dailyNote.title,
        extendedTitle: dailyNote.extendedTitle,
        preview: dailyNote.preview,
        linkedParentNotesIds: dailyNote.linkedParentNotesIds,
        linkedParentTasksIds: dailyNote.linkedParentTasksIds,
        linkedParentContactsIds: dailyNote.linkedParentContactsIds,
        linkedParentProjectsIds: dailyNote.linkedParentProjectsIds,
        linkedParentGoalsIds: dailyNote.linkedParentGoalsIds,
        linkedParentSkillsIds: dailyNote.linkedParentSkillsIds || [],
        linkedParentAssistantIds: dailyNote.linkedParentAssistantIds || [],
        linkedParentsInContentIds: dailyNote.linkedParentsInContentIds ? dailyNote.linkedParentsInContentIds : {},
        linkedParentsInTitleIds: dailyNote.linkedParentsInTitleIds ? dailyNote.linkedParentsInTitleIds : {},
        versionId: dailyNote.versionId,
    }

    updateInnerTasksWhenRestoreNote(projectId, noteId, noteContent)

    const defaultStorageRef = firebase.storage().ref()
    promises = []
    promises.push(db.doc(`${paths.noteItems}/${projectId}/notes/${noteId}`).update(note))
    promises.push(restoreDailyNoteContentCopy(projectId, noteId, noteContent, originalNoteContent, paths))
    promises.push(db.doc(`${paths.noteItemsDailyVersions}/${projectId}/notes/${noteId}`).delete())
    promises.push(defaultStorageRef.child(`${paths.noteDailyVersionsData}/${projectId}/${noteId}`).delete())
    promises.push(updateNotesEditedDailyList(projectId, noteId))
    await Promise.all(promises)
}

const restoreDailyNoteContentCopy = async (projectId, noteId, noteContent, originalNoteContent, paths) => {
    const storageRef = notesStorage.ref()
    promises = []
    promises.push(processRestoredNote(noteId, originalNoteContent, noteContent))
    promises.push(storageRef.child(`${paths.notesData}/${projectId}/${noteId}`).put(new Uint8Array(noteContent)))
    await Promise.all(promises)
}

export const restoreNoteCopy = async (projectId, noteId, restoredNoteVersion, paths) => {
    const note = {
        title: restoredNoteVersion.title,
        extendedTitle: restoredNoteVersion.extendedTitle,
        preview: restoredNoteVersion.preview,
        linkedParentNotesIds: restoredNoteVersion.linkedParentNotesIds,
        linkedParentTasksIds: restoredNoteVersion.linkedParentTasksIds,
        linkedParentContactsIds: restoredNoteVersion.linkedParentContactsIds,
        linkedParentProjectsIds: restoredNoteVersion.linkedParentProjectsIds,
        linkedParentGoalsIds: restoredNoteVersion.linkedParentGoalsIds,
        linkedParentSkillsIds: restoredNoteVersion.linkedParentSkillsIds || [],
        linkedParentAssistantIds: restoredNoteVersion.linkedParentAssistantIds || [],
        linkedParentsInContentIds: restoredNoteVersion.linkedParentsInContentIds
            ? restoredNoteVersion.linkedParentsInContentIds
            : {},
        linkedParentsInTitleIds: restoredNoteVersion.linkedParentsInTitleIds
            ? restoredNoteVersion.linkedParentsInTitleIds
            : {},
        versionId: restoredNoteVersion.versionId,
    }
    const promises = []
    promises.push(db.doc(`${paths.noteItems}/${projectId}/notes/${noteId}`).update(note))
    promises.push(restoreNoteContentCopy(projectId, noteId, restoredNoteVersion.versionId, paths))
    promises.push(updateNotesEditedDailyList(projectId, noteId))
    await Promise.all(promises)
}

const restoreNoteContentCopy = async (projectId, noteId, versionId, paths) => {
    let promises = []
    promises.push(
        getNoteVersionData(projectId, noteId, `${paths.noteVersionsData}/${projectId}/${noteId}/${versionId}`)
    )
    promises.push(getNoteData(projectId, noteId))
    const contents = await Promise.all(promises)
    const noteContent = contents[0]
    const originalNoteContent = contents[1]

    updateInnerTasksWhenRestoreNote(projectId, noteId, noteContent)

    const storageRef = notesStorage.ref()
    promises = []
    promises.push(processRestoredNote(noteId, originalNoteContent, noteContent))
    promises.push(storageRef.child(`${paths.notesData}/${projectId}/${noteId}`).put(new Uint8Array(noteContent)))
    await Promise.all(promises)
}

const getNoteVersionData = async (projectId, noteId, path) => {
    const storageRef = firebase.storage().ref()
    return storageRef
        .child(path)
        .getDownloadURL()
        .then(url => {
            return new Promise(function (resolve, reject) {
                const xhr = new XMLHttpRequest()
                xhr.open('GET', url)
                xhr.responseType = 'arraybuffer'
                xhr.onload = function () {
                    if (this.status >= 200 && this.status < 300) {
                        resolve(xhr.response)
                    } else {
                        reject({
                            status: this.status,
                            statusText: xhr.statusText,
                        })
                    }
                }
                xhr.onerror = function () {
                    reject({
                        status: this.status,
                        statusText: xhr.statusText,
                    })
                }
                xhr.send()
            })
        })
        .catch(error => {
            console.log('Note data not exists: ' + error)
            return null
        })
}

export const createDailyNoteCopy = async (projectId, noteId, note, paths) => {
    const noteCopy = { ...note }
    delete noteCopy.id
    const promises = []
    promises.push(db.doc(`${paths.noteItemsDailyVersions}/${projectId}/notes/${noteId}`).set(noteCopy))
    promises.push(createDailyNoteContentCopy(projectId, noteId, paths))
    await Promise.all(promises)
}

const createDailyNoteContentCopy = async (projectId, noteId, paths) => {
    const noteContent = await getNoteData(projectId, noteId)
    const storageRef = firebase.storage().ref()
    await storageRef.child(`${paths.noteDailyVersionsData}/${projectId}/${noteId}`).put(new Uint8Array(noteContent))
}

export const saveNoteCopy = async (projectId, note, versionName, paths) => {
    const MAX_AMOUNT_OF_VERSIONS = 10
    const storageRef = firebase.storage().ref()
    const versionId = v4()
    const noteId = note.id

    let promises = []
    promises.push(getFirebaseTimestampDirectly())
    promises.push(getNoteData(projectId, noteId))
    promises.push(db.collection(`${paths.noteItemsVersions}/${projectId}/${noteId}`).get())
    const promisesResults = await Promise.all(promises)

    const versionDate = promisesResults[0]
    const noteContent = promisesResults[1]
    const notesVersionsItemsDocs = promisesResults[2].docs

    const noteCopy = { ...note }
    delete noteCopy.id
    noteCopy.versionName = versionName
    noteCopy.versionDate = versionDate
    noteCopy.versionId = CURRENT_DAY_VERSION_ID

    promises = []
    if (notesVersionsItemsDocs.length >= MAX_AMOUNT_OF_VERSIONS) {
        let oldestCopyDate
        let oldestCopyId
        notesVersionsItemsDocs.forEach(doc => {
            const noteVersion = doc.data()
            if (!oldestCopyDate || oldestCopyDate > noteVersion.versionDate) {
                oldestCopyDate = noteVersion.versionDate
                oldestCopyId = doc.id
            }
        })
        promises.push(storageRef.child(`${paths.noteVersionsData}/${projectId}/${noteId}/${oldestCopyId}`).delete())
        promises.push(db.doc(`${paths.noteItemsVersions}/${projectId}/${noteId}/${oldestCopyId}`).delete())
    }
    promises.push(db.doc(`${paths.noteItemsVersions}/${projectId}/${noteId}/${versionId}`).set(noteCopy))
    promises.push(
        storageRef
            .child(`${paths.noteVersionsData}/${projectId}/${noteId}/${versionId}`)
            .put(new Uint8Array(noteContent))
    )
    await Promise.all(promises)
}

export const registerError = error => {
    const id = getId()
    const {
        loggedUser,
        route,
        selectedNavItem,
        selectedProjectIndex: index,
        loggedUserProjects: projects,
    } = store.getState()

    const object = {
        userId: loggedUser?.uid || '',
        routeView: route || '',
        routeTab: selectedNavItem || '',
        projectId: (checkIfSelectedAllProjects(index) ? 'all_projects' : projects?.[index]?.id) || '',
        datetime: Date.now(),
        errorMessage: error?.message || '',
        errorStackTrace: JSON.stringify(error?.stack || ''),
    }

    db.collection('runtimeErrors').doc(id).set(object)
}

export function getFirestoreTime() {
    return firebase.firestore.FieldValue.serverTimestamp()
}

export async function createNoteInObject(
    projectId,
    objectId,
    creatorId,
    objectName,
    objectType,
    objectPrivacy,
    setSelectedNote
) {
    const { loggedUser } = store.getState()
    const noteId = getId()
    const followersIds = await getObjectFollowersIds(projectId, objectType, objectId)
    const followers = objectPrivacy.includes(FEED_PUBLIC_FOR_ALL)
        ? [...followersIds, loggedUser.uid]
        : [...objectPrivacy.filter(userId => followersIds.includes(userId)), loggedUser.uid]

    const noteData = {
        ...TasksHelper.getNewDefaultNote(),
        id: noteId,
        title: objectName,
        extendedTitle: objectName,
        parentObject: { id: objectId, type: objectType },
        isPrivate: !objectPrivacy.includes(FEED_PUBLIC_FOR_ALL),
        isPublicFor: objectPrivacy,
        isVisibleInFollowedFor: uniq(followers),
        userId: creatorId,
        creatorId,
    }
    await uploadNewNote(projectId, noteData, false).then(async note => {
        if (objectType === 'tasks') {
            await setTaskNote(projectId, objectId, noteId)
        } else if (objectType === 'goals') {
            await updateGoalNote(projectId, objectId, noteId)
        } else if (objectType === 'users') {
            await setUserNote(projectId, objectId, noteId)
        } else if (objectType === 'contacts') {
            await updateContactNote(projectId, objectId, noteId)
        } else if (objectType === 'topics') {
            await updateChatNote(projectId, objectId, noteId)
        } else if (objectType === 'skills') {
            await updateSkillNote(projectId, objectId, noteId)
        } else if (objectType === 'assistants') {
            await updateAssistantNote(projectId, objectId, noteId)
        }
        setSelectedNote(note)
        followers.forEach(userId => {
            addFollowerWithoutFeeds(projectId, userId, 'notes', note.id, null)
        })
    })
}

// Calendar Functions

export async function checkIfCalendarConnected(projectId) {
    console.log('[Calendar Sync] Called with projectId:', projectId)
    const { uid, apisConnected, email: userEmail } = store.getState().loggedUser
    console.log('[Calendar Sync] apisConnected:', apisConnected)
    console.log('[Calendar Sync] userEmail:', userEmail)

    if (!apisConnected) {
        console.log('[Calendar Sync] FAILED: No apisConnected')
        return
    }

    if (!apisConnected[projectId]) {
        console.log('[Calendar Sync] FAILED: No config for projectId', projectId)
        console.log('[Calendar Sync] Available projects:', Object.keys(apisConnected))
        return
    }

    if (!apisConnected[projectId]?.calendar) {
        console.log('[Calendar Sync] FAILED: Calendar not connected for project', projectId)
        console.log('[Calendar Sync] Project config:', apisConnected[projectId])
        return
    }

    if (!GooleApi.checkAccessGranted()) {
        console.log('[Calendar Sync] FAILED: No Google API access granted')
        return
    }

    const emailToUse = apisConnected?.[projectId]?.calendarEmail || userEmail
    const currentEmail = GooleApi.getBasicUserProfile()?.getEmail()
    console.log('[Calendar Sync] Email check - current:', currentEmail, 'expected:', emailToUse)

    // Avoid prompting for auth on view load. If the active account
    // does not match the project's account, skip silent sync.
    if (currentEmail && currentEmail !== emailToUse) {
        console.log('[Calendar Sync] FAILED: Email mismatch - current account is', currentEmail, 'but need', emailToUse)
        return
    }

    console.log('[Calendar Sync] All checks passed, fetching calendar events...')
    await Promise.resolve(GooleApi.listTodayEvents(30)).then(async ({ result }) => {
        if (result) {
            store.dispatch(startLoadingData())
            const promises = []
            if (result.items.length > 0) {
                promises.push(
                    runHttpsCallableFunction('addCalendarEventsToTasksSecondGen', {
                        events: result.items,
                        projectId,
                        uid,
                        email: emailToUse,
                    })
                )
            }
            promises.push(
                runHttpsCallableFunction('removeOldCalendarTasksSecondGen', {
                    uid,
                    dateFormated: moment().format('DDMMYYYY'),
                    events: result?.items.map(event => {
                        const userAttendee = event.attendees?.find(item => item.email === emailToUse)
                        const userResponseStatus = userAttendee?.responseStatus
                        return {
                            id: event.id,
                            responseStatus: userResponseStatus,
                        }
                    }),
                    removeFromAllDates: false,
                })
            )
            await Promise.all(promises)
                .then(() => {
                    console.log('[Calendar Sync] Successfully synced calendar events')
                    store.dispatch(stopLoadingData())
                })
                .catch(e => {
                    console.error('[Calendar Sync] Error syncing:', e)
                    store.dispatch(stopLoadingData())
                })
        } else {
            console.log('[Calendar Sync] No calendar events returned from Google API')
        }
    })
}

export async function checkIfGmailIsConnected(projectId) {
    const { uid, apisConnected, email } = store.getState().loggedUser
    if (apisConnected && apisConnected[projectId]?.gmail && GooleApi.checkGmailAccessGranted()) {
        const emailToUse = apisConnected?.[projectId]?.gmailEmail || email
        // Avoid prompting for auth on view load. If the active account
        // does not match the project's account, skip silent sync.
        const currentEmail = GooleApi.getBasicUserProfile()?.getEmail()
        if (currentEmail && currentEmail !== emailToUse) {
            return
        }
        await GooleApi.listGmail()
            .then(result => {
                connectToGmail({
                    projectId,
                    date: Date.now(),
                    uid,
                    unreadMails: result.threadsTotal,
                    email: emailToUse,
                })
            })
            .catch(console.error)
    }
}

// Copy Project functions

export const duplicateProject = async (projectId, options) => {
    const user = store.getState().loggedUser
    const moveTasksFn = functions.httpsCallable('onCopyProjectSecondGen')
    await moveTasksFn({ projectId, user, options })
}

const getTemplateIdWhenSingUp = async initialUrl => {
    if (initialUrl) {
        const projectId = initialUrl.split('/')[2]
        if (projectId) {
            const project = (await db.doc(`/projects/${projectId}`).get()).data()
            if (project && project.isTemplate) {
                return projectId
            }
        }
    }

    return ''
}

export const addToMarketingList = async (email, initialUrl) => {
    if (inProductionEnvironment()) {
        const templateId = await getTemplateIdWhenSingUp(initialUrl)
        const listId = parseInt(SIB_MARKETING_SERVICE_LIST, 10)
        const languageIndex = getUserLanguageIndexForSendinBlue()
        fetch('https://api.sendinblue.com/v3/contacts', {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'api-key': SIB_API_KEY,
            },
            body: JSON.stringify({
                email,
                listIds: [listId],
                attributes: { LANGUAGE: languageIndex, templateId },
                updateEnabled: true,
            }),
        })
    }
}

export function UpdateHourlyRatesAndCurrency(projectId, currency, hourlyPerUser) {
    const newHourlyRates = { ...hourlyPerUser }
    Object.entries(newHourlyRates).forEach(entry => {
        if (!entry[1]) newHourlyRates[entry[0]] = 0
    })
    db.doc(`projects/${projectId}`).update({
        hourlyRatesData: { currency, hourlyRates: newHourlyRates },
    })
}

export function watchInvoiceData(projectId, watcherKey, callback) {
    const { loggedUser } = store.getState()
    globalWatcherUnsub[watcherKey] = db.doc(`invoiceData/${projectId}/${loggedUser.uid}/data`).onSnapshot(snapshot => {
        const data = snapshot.data()
        callback(data ? data : {})
    })
}

export async function updateInvoiceFromData(projectId, fromData, setFromData) {
    const { loggedUser } = store.getState()
    const data = { ...fromData }

    if (data.logoUpdated) {
        if (data.logo) {
            const picture = await HelperFunctions.convertURItoBlob(data.logo)
            const attachRef = firebase.storage().ref(`invoiceLogos/${projectId}/${loggedUser.uid}/logo`)
            await attachRef.put(picture, { contentType: 'image/png' })
            data.logo = await attachRef.getDownloadURL()
            setFromData(fromData => {
                return { ...fromData, logo: data.logo }
            })
        } else {
            var desertRef = firebase.storage().ref().child(`invoiceLogos/${projectId}/${loggedUser.uid}/logo`)
            desertRef.delete()
        }
    }

    delete data.logoUpdated
    db.doc(`invoiceData/${projectId}/${loggedUser.uid}/data`).set({ fromData: data }, { merge: true })
}

export function updateInvoiceToData(projectId, toData) {
    const { loggedUser } = store.getState()
    db.doc(`invoiceData/${projectId}/${loggedUser.uid}/data`).set({ toData }, { merge: true })
}

export const generateCustomInvoiceNumber = async userId => {
    await db
        .doc(`invoiceNumbers/customInvoiceNumber/users/${userId}`)
        .set({ number: firebase.firestore.FieldValue.increment(1) }, { merge: true })
    const { number } = (await db.doc(`invoiceNumbers/customInvoiceNumber/users/${userId}`).get()).data()

    const numberLength = number.toString().length
    const maxZeros = 4
    const amountZeros = numberLength >= maxZeros ? 0 : maxZeros - numberLength
    const invoiceNumber = `${moment().year()} - ${'0'.repeat(amountZeros)}${number}`

    return invoiceNumber
}

export const resetTimesDoneInExpectedDayPropertyInTasksIfNeeded = async () => {
    const { loggedUser } = store.getState()
    const { uid: userId, projectIds } = loggedUser

    const endOfToday = moment().endOf('day').valueOf()

    let promises = []
    projectIds.forEach(projectId => {
        promises.push(
            db
                .collection(`items/${projectId}/tasks`)
                .where('userId', '==', userId)
                .where('completed', '==', null)
                .where('recurrence', 'in', [
                    RECURRENCE_DAILY,
                    RECURRENCE_EVERY_WORKDAY,
                    RECURRENCE_WEEKLY,
                    RECURRENCE_EVERY_2_WEEKS,
                    RECURRENCE_EVERY_3_WEEKS,
                    RECURRENCE_MONTHLY,
                    RECURRENCE_EVERY_3_MONTHS,
                    RECURRENCE_EVERY_6_MONTHS,
                    RECURRENCE_ANNUALLY,
                ])
                .where('timesDoneInExpectedDay', '>', 0)
                .get()
        )
    })
    const results = await Promise.all(promises)

    promises = []
    results.forEach((tasksDocs, index) => {
        const projectId = projectIds[index]
        tasksDocs.forEach(doc => {
            const task = doc.data()
            const { dueDate } = task

            if (dueDate) {
                const endExpectedDay = moment(task.dueDate).endOf('day').valueOf()
                if (endOfToday > endExpectedDay) {
                    promises.push(db.doc(`items/${projectId}/tasks/${doc.id}`).update({ timesDoneInExpectedDay: 0 }))
                }
            }
        })
    })
    await Promise.all(promises)
}

export async function runHttpsCallableFunction(functionName, data, options = {}) {
    // Ensure functions is initialized before using it
    if (!functions) {
        console.warn(`⚠️  Functions not initialized when calling ${functionName}, initializing now...`)
        require('firebase/functions')

        // Use the same helper function for consistent environment detection
        const useEmulator = shouldUseEmulator()

        if (useEmulator) {
            functions = firebase.app().functions('europe-west1')
            functions.useEmulator('127.0.0.1', 5001)
            console.log('🔧 Emergency functions initialization completed with emulator (europe-west1)')
        } else {
            functions = firebase.app().functions('europe-west1')
            console.log('🔧 Emergency functions initialization completed for production (europe-west1)')
        }
    }

    // Create callable function with custom timeout if specified
    const callableOptions = {}
    if (options.timeout) {
        callableOptions.timeout = options.timeout
        console.log(`⏱️  Setting custom timeout for ${functionName}: ${options.timeout}ms`)
    }

    const func = functions.httpsCallable(functionName, callableOptions)
    const result = await func(data)

    // Debug logging for Firebase function calls
    console.log(`🔧 Firebase function ${functionName} raw result:`, result)

    // In Firebase v8, callable functions return the data directly
    // But let's check if it's wrapped in a .data property just in case
    if (result && typeof result.data !== 'undefined') {
        console.log(`🔧 Firebase function ${functionName} has .data property, using result.data`)
        return result.data
    }

    console.log(`🔧 Firebase function ${functionName} returning result directly`)
    return result
}

export function watchUserProjects(userId, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = db
        .collection(`projects`)
        .where('userIds', 'array-contains', userId)
        .onSnapshot(docs => {
            const projects = []
            docs.forEach(doc => {
                const project = mapProjectData(doc.id, doc.data())
                projects.push(project)
            })
            callback(projects)
        })
}

export function watchActiveAndArchivedProjects(userId, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = db
        .collection(`projects`)
        .where('parentTemplateId', '==', '')
        .where('isTemplate', '==', false)
        .where('userIds', 'array-contains', userId)
        .onSnapshot(docs => {
            const projects = []
            docs.forEach(doc => {
                const project = mapProjectData(doc.id, doc.data())
                projects.push(project)
            })
            callback(projects)
        })
}

export function watchGuides(userId, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = db
        .collection(`projects`)
        .where('parentTemplateId', '!=', '')
        .where('userIds', 'array-contains', userId)
        .onSnapshot(docs => {
            const guides = []
            docs.forEach(doc => {
                const guide = mapProjectData(doc.id, doc.data())
                guides.push(guide)
            })
            callback(guides)
        })
}

export function watchTemplates(userId, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = db
        .collection(`projects`)
        .where('isTemplate', '==', true)
        .where('userIds', 'array-contains', userId)
        .onSnapshot(docs => {
            const templates = []
            docs.forEach(doc => {
                const template = mapProjectData(doc.id, doc.data())
                templates.push(template)
            })
            callback(templates)
        })
}

export function updateLastLoggedUserDate() {
    const { projectIds, realArchivedProjectIds, realTemplateProjectIds } = store.getState().loggedUser
    const uniqProjects = new Set([...projectIds, ...realArchivedProjectIds, ...realTemplateProjectIds])

    const lastLoggedUserDate = Date.now()

    uniqProjects.forEach(projectId => {
        db.doc(`projects/${projectId}`).update({ lastLoggedUserDate, active: true })
    })
}
