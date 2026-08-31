import firebase from 'firebase/compat/app'
import { cloneDeep } from 'lodash'
import moment from 'moment'

import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import store from '../../../redux/store'
import {
    addFollower,
    addFollowerWithoutFeeds,
    addWorkflowStepFeedChain,
    createDefaultProject,
    forceUsersToReloadApp,
    getDb,
    getId,
    getObjectFollowersIds,
    getProjectData,
    getUserDataByUidOrEmail,
    globalWatcherUnsub,
    inProductionEnvironment,
    logEvent,
    mapUserData,
    removeInvitedUserFromProject,
    removeWorkflowStepFeedChain,
    restartFirestoreNetwork,
    runHttpsCallableFunction,
    selectAndSetNewDefaultProject,
    tryAddFollower,
    updateRemovedWorkflowStepSubtaks,
    updateRemovedWorkflowStepTaks,
} from '../firestore'
import { readDocumentDirectlyFromServer } from '../firestoreDirectRead'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'
import Backend from '../../BackendBridge'
import SettingsHelper from '../../../components/SettingsView/SettingsHelper'
import {
    createUserAllMembersFollowingFeed,
    createUserAssistantChangedFeed,
    createUserCompanyChangedFeed,
    createUserDescriptionChangedFeed,
    createUserFollowingAllMembersFeed,
    createUserHighlightChangedFeed,
    createUserJoinedFeed,
    createUserPrivacyChangedFeed,
    createUserRoleChangedFeed,
} from './userUpdates'
import { addWorkstreamMember, getUserWorkstreams, removeWorkstreamMember } from '../Workstreams/workstreamsFirestore'
import {
    setProjectInitialData,
    setUserInfoModalWhenUserJoinsToGuide,
    setUsersInProject,
    showConfirmPopup,
} from '../../../redux/actions'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import { addUserToTemplate } from '../Projects/guidesFirestore'
import { FOLLOWER_PROJECTS_TYPE, FOLLOWER_USERS_TYPE } from '../../../components/Followers/FollowerConstants'
import { UNLOCK_GOAL_COST } from '../../../components/Guides/guidesHelper'
import { updateChatAssistantWithoutFeeds, updateChatPrivacy } from '../Chats/chatsFirestore'
import { updateNotePrivacy } from '../Notes/notesFirestore'
import { DEFAULT_WORKSTREAM_ID } from '../../../components/Workstreams/WorkstreamHelper'
import {
    getInitialProjectData,
    watchProjectData,
    watchProjectDataThatIsOnlyForProjectMembers,
} from '../../InitialLoad/initialLoadHelper'
import {
    copyPreConfigTasksToNewAssistant,
    getAssistantTemplateSnapshot,
    moveAssistantToProject,
    setAssistantLikeDefault,
    uploadNewAssistant,
} from '../Assistants/assistantsFirestore'
import { GLOBAL_PROJECT_ID, isGlobalAssistant } from '../../../components/AdminPanel/Assistants/assistantsHelper'
import { getWorkflowSortIndexUpdates } from '../../workflowOrder'
import { validateDefaultProjectSelection } from '../../defaultProjectAuthorization'

//ACCESS FUNCTIONS

const describeSnapshotSource = snapshot => {
    const metadata = snapshot && snapshot.metadata
    // No metadata at all means the source is genuinely unknown — do NOT report that as
    // "server-confirmed", which is what the first version of this diagnostic did.
    if (!metadata) return 'source unknown: the snapshot carried no metadata'
    return metadata.fromCache
        ? 'served from the local cache because the backend was unreachable — it may exist on the server'
        : 'the read reported no cache fallback'
}

const getCurrentAuthUid = () => {
    try {
        return firebase.auth().currentUser ? firebase.auth().currentUser.uid : null
    } catch (error) {
        // auth not initialized yet
        return null
    }
}

const getCurrentAuthUser = () => {
    try {
        return firebase.auth().currentUser || null
    } catch (error) {
        return null
    }
}

const isPermissionDenied = error =>
    error?.code === 'permission-denied' || String(error?.message || error).includes('permission-denied')

const asDirectlyVerifiedSnapshot = directSnapshot => ({
    exists: directSnapshot.exists,
    data: () => directSnapshot.data,
    metadata: { fromCache: false },
    directlyVerified: true,
})

const readUserDocumentWithFreshAuth = async (userId, isLoggedUser) => {
    const authUser = getCurrentAuthUser()
    const isOwnLoggedUser = isLoggedUser && authUser?.uid === userId

    // Auth state can become visible a fraction before Firestore receives its first ID token.
    // Waiting for the already-cached token avoids a noisy denied boot read without making
    // offline startup depend on a refresh request.
    if (isOwnLoggedUser && typeof authUser.getIdToken === 'function') {
        try {
            await authUser.getIdToken()
        } catch (error) {
            // Firestore may still satisfy the read from its local cache.
        }
    }

    try {
        return await getDb().doc(`/users/${userId}`).get()
    } catch (error) {
        if (!isOwnLoggedUser || !isPermissionDenied(error) || typeof authUser.getIdToken !== 'function') throw error

        // A token minted just before a rules deployment can be rejected by the first Firestore
        // request. Refresh once, then preserve the existing failed-read behavior if it still fails.
        await authUser.getIdToken(true)
        try {
            return await getDb().doc(`/users/${userId}`).get()
        } catch (retryError) {
            if (!isPermissionDenied(retryError)) throw retryError

            // onAuthStateChanged may run before the compat Firestore connection has adopted the
            // freshly signed-in user's token. The authenticated REST endpoint uses that token
            // immediately, so it can authoritatively distinguish an existing account from a new
            // user while the realtime transport is being restarted.
            const directSnapshot = await readDocumentDirectlyFromServer(`users/${userId}`)
            try {
                await restartFirestoreNetwork('adopt the authenticated user during login')
            } catch (restartError) {
                console.warn('[Firestore] Could not restart after verifying the logged user directly:', restartError)
            }
            return asDirectlyVerifiedSnapshot(directSnapshot)
        }
    }
}

/**
 * Reads a user document and reports WHY there is no user: a genuinely missing document
 * (`missing: true`) or a failed read (`error` set, e.g. a transient `permission-denied` while
 * the ID token refreshes). The login flow must not treat the second case as "account is broken"
 * and offer to delete the Firebase Auth user.
 *
 * A first "missing" answer is never trusted on its own. Production produced it repeatedly for a
 * document that provably exists (uid lejVqrT6…, created 2020-08-27, read back fine with an admin
 * token at the same moment — 2026-08-13), including with no cache fallback reported. The absence
 * signal is therefore known-unreliable, while the consequence of believing it is severe:
 * `AppContent.handleMissingUserDocument` runs `processNewUser`, whose `uploadNewUser` does a
 * `batch.set` on `users/{uid}` with a fresh-signup document — overwriting projectIds, gold,
 * premium status and settings — and offers to delete the Firebase Auth user if that fails.
 *
 * So an apparent absence is verified through Firestore's authenticated REST document endpoint.
 * That request has no local cache or snapshot-listener state, which makes it independent from the
 * full client's bad view. A recovered document is returned normally, and a direct read that
 * cannot reach the server is reported as a failed read so the caller retries instead of
 * recovering.
 *
 * `options.absenceIsExpected` marks a PROBE: a caller that is only asking "is this id a user?"
 * about an id that may equally be a contact, an assistant or a workstream (AT-2428). For that
 * question an absence is an ordinary answer, not an anomaly, so the probe skips the verification
 * round trip and logs nothing — it must not spend a REST read, nor report a production ERROR,
 * for every contact the app opens. The safety net is unchanged rather than weakened: a probe is
 * only allowed to answer "not a user" cheaply, and a caller that finds NOTHING to explain the
 * absence has to escalate to a verified read (`getUserData` with no options), which is what still
 * recovers a real user whose realtime read was wrong and still logs loudly when it is genuinely
 * gone. `verified` on the result says which of the two answers the caller got.
 */
export async function fetchUserDataResult(userId, isLoggedUser, options = {}) {
    const { absenceIsExpected = false, permissionDeniedIsExpected = false } = options
    try {
        const docSnapshot = await readUserDocumentWithFreshAuth(userId, isLoggedUser)
        if (!docSnapshot.exists) {
            if (absenceIsExpected) return { user: null, missing: true, error: null, verified: false }
            if (docSnapshot.directlyVerified) {
                return { user: null, missing: true, error: null, verified: true }
            }

            let directSnapshot
            try {
                directSnapshot = await readDocumentDirectlyFromServer(`users/${userId}`)
            } catch (verifyError) {
                // The independent server could not be reached, so the absence is unconfirmed.
                // Report a failed read: the caller retries and never runs account recovery.
                console.warn(
                    `User document /users/${userId} appeared missing and the direct server read failed; ` +
                        'treating it as a failed read rather than a missing account.',
                    verifyError
                )
                return { user: null, missing: false, error: verifyError, verified: false }
            }

            if (directSnapshot.exists) {
                const confirmedData = directSnapshot.data
                const recoveredUser = confirmedData ? mapUserData(userId, confirmedData, isLoggedUser) : null
                console.warn(
                    `User document /users/${userId} was reported missing by the realtime client ` +
                        `(${describeSnapshotSource(docSnapshot)}), but a direct server read found it. ` +
                        'Using the document and reconnecting the realtime streams; no account recovery is needed.'
                )
                try {
                    await restartFirestoreNetwork('recover a user document omitted during initial load')
                } catch (restartError) {
                    // The direct result is still authoritative and safe to use. The post-boot
                    // integrity checks will make another bounded attempt to reconnect.
                    console.warn(
                        '[Firestore] Could not restart the realtime connection after a recovered user read:',
                        restartError
                    )
                }
                return { user: recoveredUser, missing: !recoveredUser, error: null, verified: true }
            }

            const authUid = getCurrentAuthUid()
            console.error(
                `User document not found in Firestore: /users/${userId} (confirmed by a direct server read)`,
                {
                    requestedUserId: JSON.stringify(userId),
                    idLength: typeof userId === 'string' ? userId.length : null,
                    authUid: JSON.stringify(authUid),
                    isOwnDoc: authUid === userId,
                    firebaseProject: getDb()?.app?.options?.projectId || null,
                    firstReadSource: describeSnapshotSource(docSnapshot),
                    calledFrom: new Error().stack,
                }
            )
            return { user: null, missing: true, error: null, verified: true }
        }

        // A cached document is not proof that this signed-in user may still read it. This matters
        // for the global Administrator profile: an older session can leave a full private user
        // document in IndexedDB, the cached get succeeds, and the listener then fails against the
        // current strict rules. Verify optional cross-user reads independently before exposing the
        // cached profile or arming that listener.
        if (permissionDeniedIsExpected && docSnapshot.metadata?.fromCache && !docSnapshot.directlyVerified) {
            let directSnapshot
            try {
                directSnapshot = await readDocumentDirectlyFromServer(`users/${userId}`)
            } catch (verifyError) {
                if (isPermissionDenied(verifyError)) {
                    return { user: null, missing: false, error: verifyError, verified: false }
                }
                throw verifyError
            }

            if (!directSnapshot.exists) {
                return { user: null, missing: true, error: null, verified: true }
            }
            const directlyVerifiedUser = directSnapshot.data
                ? mapUserData(userId, directSnapshot.data, isLoggedUser)
                : null
            return {
                user: directlyVerifiedUser,
                missing: !directlyVerifiedUser,
                error: null,
                verified: true,
            }
        }

        const user = docSnapshot.data()
        const mappedUser = user ? mapUserData(userId, user, isLoggedUser) : null
        return { user: mappedUser, missing: !mappedUser, error: null, verified: true }
    } catch (error) {
        if (permissionDeniedIsExpected && isPermissionDenied(error)) {
            return { user: null, missing: false, error, verified: false }
        }
        console.error(`Error fetching user data for ${userId}:`, error)
        return { user: null, missing: false, error, verified: false }
    }
}

export async function getUserData(userId, isLoggedUser, options) {
    const { user } = await fetchUserDataResult(userId, isLoggedUser, options)
    return user
}

const convertUserDocsInUsers = docs => {
    const users = []
    docs.forEach(doc => {
        users.push(mapUserData(doc.id, doc.data(), false))
    })
    return users
}

// Multiple active projects frequently contain the same people. Keep one Firestore document
// target per user and fan its snapshots out locally instead of opening the same users/{uid}
// listener again for every project section on Contacts.
const sharedProjectUserWatchers = new Map()

const subscribeToSharedProjectUser = (db, userId, onSnapshot, onError) => {
    let entry = sharedProjectUserWatchers.get(userId)
    if (!entry) {
        entry = {
            subscribers: new Set(),
            lastSnapshot: null,
            lastError: null,
            unsubscribe: () => {},
        }
        sharedProjectUserWatchers.set(userId, entry)
        entry.unsubscribe = db.doc(`users/${userId}`).onSnapshot(
            snapshot => {
                entry.lastSnapshot = snapshot
                entry.lastError = null
                entry.subscribers.forEach(subscriber => subscriber.onSnapshot(snapshot))
            },
            error => {
                entry.lastSnapshot = null
                entry.lastError = error
                entry.subscribers.forEach(subscriber => subscriber.onError(error))
            }
        )
    }

    const subscriber = { onSnapshot, onError }
    entry.subscribers.add(subscriber)
    if (entry.lastSnapshot) onSnapshot(entry.lastSnapshot)
    else if (entry.lastError) onError(entry.lastError)

    return () => {
        entry.subscribers.delete(subscriber)
        if (entry.subscribers.size > 0) return
        entry.unsubscribe()
        if (sharedProjectUserWatchers.get(userId) === entry) sharedProjectUserWatchers.delete(userId)
    }
}

export const resetSharedProjectUserWatchersForTests = () => {
    sharedProjectUserWatchers.forEach(entry => entry.unsubscribe())
    sharedProjectUserWatchers.clear()
}

export async function watchUserByEmail(email, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`users`)
        .where('email', '==', email)
        .limit(1)
        .onSnapshot(userDocs => {
            const user =
                userDocs.docs.length > 0 ? mapUserData(userDocs.docs[0].id, userDocs.docs[0].data(), false) : null
            callback(user)
        })
}

export async function watchProjectUsers(projectId, callback, watcherKey, { onError } = {}) {
    const db = getDb()
    const userWatchers = new Map()
    const usersById = new Map()
    const resolvedUserIds = new Set()
    let activeUserIds = []
    let stopped = false
    let projectUnsubscribe = () => {}

    const stop = () => {
        if (stopped) return
        stopped = true
        projectUnsubscribe()
        userWatchers.forEach(unsubscribe => unsubscribe())
        userWatchers.clear()
    }

    const emitWhenComplete = () => {
        if (stopped || activeUserIds.some(userId => !resolvedUserIds.has(userId))) return
        callback(activeUserIds.map(userId => usersById.get(userId)).filter(Boolean))
    }

    const syncUserWatchers = userIds => {
        const nextUserIds = Array.from(
            new Set((Array.isArray(userIds) ? userIds : []).filter(userId => typeof userId === 'string' && userId))
        )
        const nextUserIdSet = new Set(nextUserIds)

        userWatchers.forEach((unsubscribe, userId) => {
            if (nextUserIdSet.has(userId)) return
            unsubscribe()
            userWatchers.delete(userId)
            usersById.delete(userId)
            resolvedUserIds.delete(userId)
        })

        activeUserIds = nextUserIds
        nextUserIds.forEach(userId => {
            if (userWatchers.has(userId)) return
            userWatchers.set(userId, () => {})
            const unsubscribe = subscribeToSharedProjectUser(
                db,
                userId,
                snapshot => {
                    if (stopped || !activeUserIds.includes(userId)) return
                    resolvedUserIds.add(userId)
                    if (snapshot.exists) usersById.set(userId, mapUserData(userId, snapshot.data(), false))
                    else usersById.delete(userId)
                    emitWhenComplete()
                },
                error => {
                    if (stopped || !activeUserIds.includes(userId)) return
                    // A stale project.userIds entry can point at a user document
                    // whose own membership no longer grants access. The previous
                    // collection query simply omitted that profile, so preserve
                    // that behavior without weakening the user-document rule or
                    // holding the entire project user list open forever.
                    resolvedUserIds.add(userId)
                    usersById.delete(userId)
                    if (error?.code !== 'permission-denied') {
                        console.warn(`Unable to watch project member ${userId} in ${projectId}:`, error)
                    }
                    emitWhenComplete()
                }
            )
            userWatchers.set(userId, unsubscribe)
        })
        emitWhenComplete()
    }

    projectUnsubscribe = db.doc(`projects/${projectId}`).onSnapshot(
        snapshot => syncUserWatchers(snapshot.exists ? snapshot.data()?.userIds : []),
        error => {
            stop()
            if (onError) onError(error)
            else console.error(`Error watching project members for ${projectId}:`, error)
        }
    )

    // InitialLoad already has the project document in redux. Use its member ids
    // immediately instead of adding a whole extra project-listener round trip
    // before the individual, rule-safe user listeners can start. The project
    // listener above remains authoritative for later membership changes.
    const project = store.getState().loggedUserProjectsMap?.[projectId]
    if (Array.isArray(project?.userIds)) syncUserWatchers(project.userIds)

    globalWatcherUnsub[watcherKey] = stop
}

export const GOLD_TRANSACTIONS_PAGE_SIZE = 50

const mapGoldTransaction = doc => ({
    id: doc.id,
    ...doc.data(),
})

export function watchGoldTransactions(userId, callback, limitCount = GOLD_TRANSACTIONS_PAGE_SIZE) {
    return getDb()
        .collection(`users/${userId}/goldTransactions`)
        .orderBy('createdAt', 'desc')
        .limit(limitCount)
        .onSnapshot(snapshot => {
            callback({
                transactions: snapshot.docs.map(mapGoldTransaction),
                lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
                hasMore: snapshot.docs.length === limitCount,
            })
        })
}

export async function loadMoreGoldTransactions(userId, lastDoc, limitCount = GOLD_TRANSACTIONS_PAGE_SIZE) {
    if (!lastDoc) return { transactions: [], lastDoc: null, hasMore: false }

    const snapshot = await getDb()
        .collection(`users/${userId}/goldTransactions`)
        .orderBy('createdAt', 'desc')
        .startAfter(lastDoc)
        .limit(limitCount)
        .get()

    return {
        transactions: snapshot.docs.map(mapGoldTransaction),
        lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
        hasMore: snapshot.docs.length === limitCount,
    }
}

export const getUsers = async getOnlyDocs => {
    const docs = (await getDb().collection(`users`).get()).docs
    return getOnlyDocs ? docs : convertUserDocsInUsers(docs)
}

export const getUsersByEmail = async (email, getOnlyDocs) => {
    const docs = (await getDb().collection(`users`).where('email', '==', email).get()).docs
    return getOnlyDocs ? docs : convertUserDocsInUsers(docs)
}

export const getUsersInvitedToProject = async (projectId, getOnlyDocs) => {
    const docs = (await getDb().collection(`users`).where('invitedProjectIds', 'array-contains-any', [projectId]).get())
        .docs
    return getOnlyDocs ? docs : convertUserDocsInUsers(docs)
}

export async function getProjectUsers(projectId, getOnlyDocs) {
    const docs = (await getDb().collection(`users`).where('projectIds', 'array-contains', projectId).get()).docs
    return getOnlyDocs ? docs : convertUserDocsInUsers(docs)
}

//EDTION AND ADITION FUNCTIONS

export const updateUserEditionData = async (projectId, userId, editorId) => {
    await getDb().runTransaction(async transaction => {
        const ref = getDb().doc(`users/${userId}`)
        const doc = await transaction.get(ref)
        if (doc.exists) {
            const data = { lastEditionDate: Date.now(), lastEditorId: editorId }
            addProjectMutationProof(userId, data, projectId)
            transaction.update(ref, data)
        }
    })
}

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

function addProjectMutationProof(userId, data, projectId) {
    // Most personal user writes do not change project-scoped data. Bail out before reading the
    // store: some of those writes are scheduled by the My Day reducer, and Redux deliberately
    // rejects getState() calls while a reducer is executing.
    if (!projectId || data.projectMembershipMutation) return
    const { loggedUser } = store.getState()
    if (!loggedUser?.uid) return
    data.projectMembershipMutation = {
        projectId,
        action: userId === loggedUser.uid ? 'self-sync' : 'project-update',
        actorId: loggedUser.uid,
        updatedAt: Date.now(),
    }
}

export async function updateUserData(userId, data, batch, projectId) {
    addProjectMutationProof(userId, data, projectId)
    updateEditionData(data)
    const ref = getDb().doc(`users/${userId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

export async function updateUserDataDirectly(userId, data, batch, projectId) {
    addProjectMutationProof(userId, data, projectId)
    const ref = getDb().doc(`users/${userId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

export async function uploadNewUser(uid, user, project, task, workstream, assistant) {
    const userToStore = { ...user }
    if (userToStore.assistantEmailEnabled === undefined) userToStore.assistantEmailEnabled = true
    delete userToStore.uid

    const projectToStore = { ...project }
    delete projectToStore.id
    delete projectToStore.index

    const taskToStore = { ...task }
    delete taskToStore.id
    taskToStore.projectId = project.id

    const workstreamToStore = { ...workstream }
    delete workstreamToStore.uid

    const batch = new BatchWrapper(getDb())
    batch.set(getDb().doc(`projects/${project.id}`), projectToStore)
    batch.set(getDb().doc(`items/${project.id}/tasks/${task.id}`), taskToStore)
    batch.set(getDb().doc(`users/${uid}`), userToStore)
    batch.set(getDb().doc(`projectsWorkstreams/${project.id}/workstreams/${workstream.uid}`), workstreamToStore)

    // Add assistant if provided
    if (assistant) {
        const assistantToStore = { ...assistant }
        delete assistantToStore.uid
        batch.set(getDb().doc(`assistants/${project.id}/items/${assistant.uid}`), assistantToStore)
    }

    await batch.commit()
}

export const addNewUserToAlldoneTemplate = async userId => {
    const alldoneTemplateId = inProductionEnvironment() ? 'DK8eqfrVViztt7HiwoID' : 'KlUVBlKKMbVmtyHIIB9U'
    const alldoneTemplate = await getProjectData(alldoneTemplateId)
    if (alldoneTemplate) {
        await addUserToTemplate(userId, alldoneTemplate, true)
        if (!store.getState().newUserNeedToJoinToProject) store.dispatch(setUserInfoModalWhenUserJoinsToGuide(true))
    }
}

export async function deleteUser(user) {
    const userId = user.uid
    const { loggedUser } = store.getState()
    const userToDeleteIsTheLoggedUser = loggedUser.uid === user.uid

    // Firestore cleanup now runs with Admin permissions inside the callable. It finishes project
    // and personal-data cleanup before deleting Firebase Auth, so stricter client rules cannot
    // strand a half-deleted account and a failed cleanup remains retryable.
    logEvent('delete_user', { userId }).catch(error => {
        console.warn('[Account deletion] Could not record analytics event', error)
    })
    await runHttpsCallableFunction('deleteUserSecondGen', { userId }, { timeout: 540000 })

    if (userToDeleteIsTheLoggedUser) {
        Backend.logout(SettingsHelper.onLogOut)
    } else {
        setTimeout(() => {
            window.location.reload()
        })
    }
}

export const setUserAssistant = async (projectId, userId, assistantId, needGenerateUpdate) => {
    const batch = new BatchWrapper(getDb())
    updateUserData(userId, { assistantId }, batch, projectId)
    await updateChatAssistantWithoutFeeds(projectId, userId, assistantId, batch)
    await batch.commit()
    if (needGenerateUpdate) await createUserAssistantChangedFeed(projectId, assistantId, userId, null, null)
}

export const setUserNote = async (projectId, userId, noteId) => {
    await updateUserData(userId, { [`noteIdsByProject.${projectId}`]: noteId }, null, projectId)
}

export function updateUserLastVisitedBoardDate(projectId, userId, lastVisitBoardProperty) {
    const { loggedUser } = store.getState()
    // Update directly so "board visit" does not affect user edition metadata.
    updateUserDataDirectly(
        userId,
        { [`${lastVisitBoardProperty}.${projectId}.${loggedUser.uid}`]: Date.now() },
        null,
        projectId
    )
}

export async function addUserWorkflowStep(projectId, uid, newStepData) {
    const newStepId = getId()

    updateUserData(uid, { [`workflow.${projectId}.${newStepId}`]: newStepData }, null, projectId)

    const { reviewerUid, description } = newStepData
    addWorkflowStepFeedChain(projectId, reviewerUid, uid, description)

    return newStepId
}

export async function reorderUserWorkflowSteps(projectId, uid, orderedStepIds) {
    await updateUserData(uid, getWorkflowSortIndexUpdates(projectId, orderedStepIds), null, projectId)
}

export async function modifyUserWorkflowStep(projectId, uid, stepId, newStepData, oldReviewerUid, externalBatch) {
    let batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const newStep = { ...newStepData }
    delete newStep.id

    updateUserData(uid, { [`workflow.${projectId}.${stepId}`]: newStep }, batch, projectId)

    const { reviewerUid } = newStep
    if (reviewerUid !== oldReviewerUid) {
        const parentTasksIndices = {}
        const tasks = await getDb()
            .collection(`items/${projectId}/tasks`)
            .where('userId', '==', uid)
            .where('done', '==', false)
            .where('userIds', 'array-contains', oldReviewerUid)
            .where('parentId', '==', null)
            .get()

        batch = updateEditedWorkflowStepTaks(projectId, tasks, stepId, reviewerUid, parentTasksIndices, batch)

        const subtasks = await getDb()
            .collection(`items/${projectId}/tasks`)
            .where('userId', '==', uid)
            .where('parentDone', '==', false)
            .where('userIds', 'array-contains', oldReviewerUid)
            .where('parentId', '>', '')
            .get()

        batch = updateEditedWorkflowStepTaks(projectId, subtasks, stepId, reviewerUid, parentTasksIndices, batch)
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export const updateEditedWorkflowStepTaks = (projectId, tasks, stepId, reviewerUid, parentTasksIndices, batch) => {
    tasks.forEach(taskData => {
        const task = taskData.data()

        if (task.userIds.length > 1) {
            const index = task.parentId
                ? parentTasksIndices[task.parentId]
                : task.stepHistory.findIndex(id => id === stepId)

            if (index !== null && index !== undefined && index > -1) {
                task.projectId = projectId
                task.userIds[index] = reviewerUid
                if (index === task.stepHistory.length - 1) task.currentReviewerId = reviewerUid
                if (task.subtaskIds && task.subtaskIds.length > 0) {
                    parentTasksIndices[taskData.id] = index
                }

                batch.set(getDb().doc(`items/${projectId}/tasks/${taskData.id}`), task)
            }
        }
    })
    return batch
}

export async function removeUserWorkflowStep(project, uid, stepId, steps, reviewerUid) {
    let batch = new BatchWrapper(getDb())

    updateUserData(
        uid,
        { [`workflow.${project.id}.${stepId}`]: firebase.firestore.FieldValue.delete() },
        batch,
        project.id
    )

    const tasks = (
        await getDb()
            .collection(`items/${project.id}/tasks`)
            .where('userId', '==', uid)
            .where('done', '==', false)
            .where('userIds', 'array-contains', reviewerUid)
            .where('parentId', '==', null)
            .get()
    ).docs

    const subtasks = (
        await getDb()
            .collection(`items/${project.id}/tasks`)
            .where('userId', '==', uid)
            .where('parentDone', '==', false)
            .where('userIds', 'array-contains', reviewerUid)
            .where('parentId', '>', '')
            .get()
    ).docs

    const parentTasksIndices = {}
    batch = updateRemovedWorkflowStepTaks(project.id, tasks, steps, stepId, parentTasksIndices, batch)
    batch = updateRemovedWorkflowStepSubtaks(project.id, subtasks, steps, stepId, parentTasksIndices, batch)

    batch.commit()

    removeWorkflowStepFeedChain(project.id, steps, uid, stepId)
}

export async function addUserToProject(
    uidOrEmail,
    project,
    projectId,
    removeInvitation,
    projectUsersIdsForSpecialFeeds,
    specialUserIds
) {
    const user = await getUserDataByUidOrEmail(uidOrEmail)
    await tryAddUserToProject(user.uid, projectId, project, removeInvitation)

    const { loggedUserProjectsMap } = store.getState()
    if (loggedUserProjectsMap[projectId]) {
        watchProjectDataThatIsOnlyForProjectMembers(projectId, true)
    } else {
        const { project, users, workstreams, contacts, assistants } = await getInitialProjectData(projectId)
        store.dispatch(setProjectInitialData(project, users, workstreams, contacts, assistants))
        watchProjectData(projectId, true, true)
    }

    const batch = new BatchWrapper(getDb())

    if (projectUsersIdsForSpecialFeeds)
        batch.projectUsersIdsForSpecialFeeds = { [user.uid]: projectUsersIdsForSpecialFeeds }

    const userIds = specialUserIds ? specialUserIds : project.userIds
    batch.feedChainFollowersIds = { [user.uid]: [...userIds, user.uid] }

    await createUserJoinedFeed(
        projectId,
        batch,
        user,
        projectUsersIdsForSpecialFeeds ? { ...project, userIds: projectUsersIdsForSpecialFeeds } : project
    )

    const followProjectData = {
        followObjectsType: FOLLOWER_PROJECTS_TYPE,
        followObjectId: projectId,
        followObject: project,
        feedCreator: user,
    }
    await addFollower(projectId, followProjectData, batch)
    await createUserFollowingAllMembersFeed(projectId, user.uid, batch, user, userIds)
    await createUserAllMembersFollowingFeed(projectId, user.uid, batch, user, userIds)
    addFollowerWithoutFeeds(projectId, user.uid, 'users', user.uid, null, batch)
    userIds.forEach(userId => {
        addFollowerWithoutFeeds(projectId, user.uid, 'users', userId, null, batch)
        addFollowerWithoutFeeds(projectId, userId, 'users', user.uid, null, batch)
    })

    batch.commit()
}

async function tryAddUserToProject(uid, projectId, project, removeInvitation) {
    const batch = new BatchWrapper(getDb())
    const { loggedUser } = store.getState()

    batch.update(getDb().doc(`projects/${projectId}`), {
        userIds: firebase.firestore.FieldValue.arrayUnion(uid),
    })

    if (!project.parentTemplateId) addWorkstreamMember(projectId, DEFAULT_WORKSTREAM_ID, uid, batch)

    const isTemplate = project.isTemplate
    const isGuide = !!project.parentTemplateId

    const membershipUpdate = isTemplate
        ? {
              projectIds: firebase.firestore.FieldValue.arrayUnion(projectId),
              templateProjectIds: firebase.firestore.FieldValue.arrayUnion(projectId),
          }
        : isGuide
          ? {
                projectIds: firebase.firestore.FieldValue.arrayUnion(projectId),
                guideProjectIds: firebase.firestore.FieldValue.arrayUnion(projectId),
            }
          : {
                projectIds: firebase.firestore.FieldValue.arrayUnion(projectId),
            }
    membershipUpdate.projectMembershipMutation = {
        projectId,
        action: 'add',
        actorId: loggedUser.uid,
        updatedAt: Date.now(),
    }
    updateUserData(uid, membershipUpdate, batch)

    await batch.commit()

    if (removeInvitation) {
        firebase
            .firestore()
            .doc(`users/${uid}`)
            .get()
            .then(snap => {
                const user = mapUserData(uid, snap.data())
                removeInvitedUserFromProject(user, projectId)
            })
    }
}

export async function setUserDescription(userId, extDescription) {
    updateUserData(
        userId,
        { description: TasksHelper.getTaskNameWithoutMeta(extDescription), extendedDescription: extDescription },
        null
    )
}

export async function setDefaultProjectId(userId, projectId) {
    const { loggedUser, loggedUserProjectsMap, projectAssistants } = store.getState()
    if (loggedUser?.uid !== userId) throw new Error('The default project can only be changed for the logged user')

    await validateDefaultProjectSelection(userId, projectId, getProjectData)

    const previousDefaultProjectId = loggedUser?.defaultProjectId
    const hasDefaultProjectChanged = !!previousDefaultProjectId && previousDefaultProjectId !== projectId

    if (hasDefaultProjectChanged) {
        const previousDefaultProject = loggedUserProjectsMap?.[previousDefaultProjectId]
        const previousDefaultProjectAssistants = projectAssistants?.[previousDefaultProjectId] || []

        const assistantFromPreviousDefaultProject =
            previousDefaultProject?.assistantId ||
            previousDefaultProjectAssistants.find(assistant => assistant.isDefault)?.uid ||
            previousDefaultProjectAssistants[0]?.uid ||
            ''

        if (assistantFromPreviousDefaultProject) {
            if (isGlobalAssistant(assistantFromPreviousDefaultProject)) {
                const globalAssistant = store
                    .getState()
                    .globalAssistants.find(assistant => assistant.uid === assistantFromPreviousDefaultProject)

                if (globalAssistant) {
                    const assistantPayload = {
                        ...globalAssistant,
                        noteIdsByProject: {},
                        lastVisitBoard: {},
                        commentsData: null,
                        fromTemplate: false,
                        isDefault: false,
                        copiedFromTemplateAssistantId: globalAssistant.uid,
                        copiedFromTemplateAssistantDate: Date.now(),
                        templateSyncSnapshot: getAssistantTemplateSnapshot(globalAssistant),
                        templateSyncConflicts: [],
                        templateSyncStatus: 'synced',
                        templateSyncedAt: Date.now(),
                    }

                    const newAssistant = await uploadNewAssistant(projectId, assistantPayload, null)
                    await copyPreConfigTasksToNewAssistant(
                        GLOBAL_PROJECT_ID,
                        globalAssistant.uid,
                        projectId,
                        newAssistant.uid
                    )
                    await setAssistantLikeDefault(projectId, newAssistant.uid)

                    if (previousDefaultProject?.assistantId === assistantFromPreviousDefaultProject) {
                        await getDb().doc(`projects/${previousDefaultProjectId}`).update({ assistantId: '' })
                    }
                }
            } else {
                await moveAssistantToProject(previousDefaultProjectId, projectId, assistantFromPreviousDefaultProject)
            }
        }
    }

    await runHttpsCallableFunction('setDefaultProjectSecondGen', { projectId })

    if (hasDefaultProjectChanged) {
        store.dispatch(showConfirmPopup({ trigger: 'CONFIRM POPUP MANDATORY NOTIFICATION', object: {} }))
    }
}

async function spendGoldForGoalUnlock(userId, projectId, goalId) {
    return await runHttpsCallableFunction('deductGoldSecondGen', {
        gold: UNLOCK_GOAL_COST,
        source: 'goal_unlock',
        projectId,
        goalId,
        objectId: goalId,
        channel: 'guides',
    })
}

async function refundGoldForGoalUnlock(projectId, goalId) {
    return await runHttpsCallableFunction('refundGoldSecondGen', {
        gold: UNLOCK_GOAL_COST,
        source: 'goal_unlock',
        projectId,
        goalId,
        objectId: goalId,
        channel: 'guides',
        note: 'Goal unlock rollback',
    })
}

export async function addLockKeyToLoggedUser(userId, projectId, lockKey, goalId) {
    const goldResult = await spendGoldForGoalUnlock(userId, projectId, goalId)
    if (!goldResult?.success) return goldResult

    try {
        await updateUserData(
            userId,
            { [`unlockedKeysByGuides.${projectId}`]: firebase.firestore.FieldValue.arrayUnion(lockKey) },
            null,
            projectId
        )
    } catch (error) {
        await refundGoldForGoalUnlock(projectId, goalId)
        console.error('Failed unlocking goal after gold deduction', { userId, projectId, goalId, error: error.message })
        return { success: false, message: error.message || 'Failed to unlock goal' }
    }

    logEvent('UnlockGoal', {
        userId,
        goalId,
    })
    runHttpsCallableFunction('proccessAlgoliaRecordsWhenUnlockGoalSecondGen', {
        projectId,
        goalId,
    })

    return goldResult
}

export const updateUserLastCommentData = async (projectId, userId, lastComment, commentType) => {
    await updateUserDataDirectly(
        userId,
        {
            [`commentsData.${projectId}.lastComment`]: lastComment,
            [`commentsData.${projectId}.lastCommentType`]: commentType,
            [`commentsData.${projectId}.amount`]: firebase.firestore.FieldValue.increment(1),
        },
        null,
        projectId
    )
}

export const resetUserLastCommentData = async (projectId, userId) => {
    const ref = getDb().doc(`users/${userId}`)
    const doc = await ref.get()
    if (doc.exists) {
        const data = doc.data()
        if (data.commentsData && data.commentsData[projectId] && data.commentsData[projectId].amount > 0) {
            await updateUserDataDirectly(
                userId,
                {
                    [`commentsData.${projectId}.lastComment`]: null,
                    [`commentsData.${projectId}.lastCommentType`]: null,
                    [`commentsData.${projectId}.amount`]: 0,
                },
                null,
                projectId
            )
        }
    }
}

export async function addLockKeyToGoalOwner(userUnlockingId, projectId, lockKey, goalId, goalOwnerId) {
    const goldResult = await spendGoldForGoalUnlock(userUnlockingId, projectId, goalId)
    if (!goldResult?.success) return goldResult

    try {
        await updateUserData(
            goalOwnerId,
            {
                [`unlockedKeysByGuides.${projectId}`]: firebase.firestore.FieldValue.arrayUnion(lockKey),
            },
            null,
            projectId
        )
    } catch (error) {
        await refundGoldForGoalUnlock(projectId, goalId)
        console.error('Failed unlocking goal owner after gold deduction', {
            userUnlockingId,
            projectId,
            goalId,
            goalOwnerId,
            error: error.message,
        })
        return { success: false, message: error.message || 'Failed to unlock goal' }
    }

    logEvent('UnlockGoal', {
        userUnlockingId,
        goalId,
    })
    runHttpsCallableFunction('proccessAlgoliaRecordsWhenUnlockGoalSecondGen', {
        projectId,
        goalId,
    })

    const { projectUsers } = store.getState()

    // AT-2386: `projectUsers[projectId]` is filled on demand now, so guard the read-modify-write.
    // The unlocked-keys update below is purely an optimistic local mirror of a server write, so
    // skipping it when the slice is not loaded costs nothing - the live watcher brings it back.
    const usersInProject = Array.isArray(projectUsers[projectId]) ? [...projectUsers[projectId]] : []

    const index = usersInProject.findIndex(user => user.uid === goalOwnerId)
    const user = usersInProject[index]

    if (user) {
        const unlockedKeysByGuides = cloneDeep(user.unlockedKeysByGuides)
        if (unlockedKeysByGuides[projectId]) {
            unlockedKeysByGuides[projectId].push(lockKey)
        } else {
            unlockedKeysByGuides[projectId] = [lockKey]
        }

        usersInProject[index] = { ...user, unlockedKeysByGuides }
        store.dispatch(setUsersInProject(projectId, usersInProject))
    }

    return goldResult
}

export async function setUserRoleInProject(project, user, newRole, oldRole) {
    const batch = new BatchWrapper(getDb())

    batch.update(getDb().doc(`/projects/${project.id}`), {
        [`usersData.${user.uid}.role`]: newRole,
    })

    await createUserRoleChangedFeed(project.id, user, user.uid, newRole, oldRole, batch)
    const followUserData = {
        followObjectsType: FOLLOWER_USERS_TYPE,
        followObjectId: user.uid,
        followObject: user,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(project.id, followUserData, batch)
    batch.commit()
}

export async function setUserCompanyInProject(project, user, newCompany, oldCompany) {
    const batch = new BatchWrapper(getDb())

    batch.update(getDb().doc(`/projects/${project.id}`), {
        [`usersData.${user.uid}.company`]: newCompany,
    })

    await createUserCompanyChangedFeed(project.id, user, user.uid, newCompany, oldCompany, batch)
    const followUserData = {
        followObjectsType: FOLLOWER_USERS_TYPE,
        followObjectId: user.uid,
        followObject: user,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(project.id, followUserData, batch)
    batch.commit()
}

export async function setUserDescriptionInProject(project, user, newDescription, oldDescription) {
    const batch = new BatchWrapper(getDb())

    const plainDescription = newDescription != null ? TasksHelper.getTaskNameWithoutMeta(newDescription) : null

    batch.update(getDb().doc(`/projects/${project.id}`), {
        [`usersData.${user.uid}.description`]: plainDescription,
        [`usersData.${user.uid}.extendedDescription`]: newDescription,
    })

    await createUserDescriptionChangedFeed(project.id, user, user.uid, newDescription, oldDescription, batch)
    const followUserData = {
        followObjectsType: FOLLOWER_USERS_TYPE,
        followObjectId: user.uid,
        followObject: user,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(project.id, followUserData, batch)
    batch.commit()
}

export async function setUserHighlightInProject(project, user, highlightColor) {
    getDb()
        .doc(`projects/${project.id}`)
        .update({
            [`usersData.${user.uid}.hasStar`]: highlightColor,
        })

    const batch = new BatchWrapper(getDb())
    await createUserHighlightChangedFeed(project.id, user, user.uid, highlightColor, batch)

    const followUserData = {
        followObjectsType: FOLLOWER_USERS_TYPE,
        followObjectId: user.uid,
        followObject: user,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(project.id, followUserData, batch)
    batch.commit()
}

export async function setUserPrivacyInProject(project, user, isPrivate, isPublicFor) {
    const batch = new BatchWrapper(getDb())

    batch.update(getDb().doc(`/projects/${project.id}`), {
        [`usersData.${user.uid}.isPrivate`]: isPrivate,
        [`usersData.${user.uid}.isPublicFor`]: isPublicFor,
    })

    updateChatPrivacy(project.id, user.uid, 'contacts', isPublicFor)

    await createUserPrivacyChangedFeed(project.id, user, user.uid, isPrivate, isPublicFor, batch)
    const followUserData = {
        followObjectsType: FOLLOWER_USERS_TYPE,
        followObjectId: user.uid,
        followObject: user,
        feedCreator: store.getState().loggedUser,
    }
    if (user.noteId) {
        const followersIds = await getObjectFollowersIds(project.id, 'users', user.uid)
        updateNotePrivacy(project.id, user.noteId, isPrivate, isPublicFor, followersIds, false, null)
    }
    await tryAddFollower(project.id, followUserData, batch)
    batch.commit()
}

export async function setUserCompany(userId, company) {
    updateUserData(userId, { company }, null)
}

export async function setUserRole(userId, role) {
    updateUserData(userId, { role }, null)
}

export async function setUserPhone(userId, phone) {
    updateUserData(userId, { phone }, null)
}

export async function setUserNotificationEmail(userId, email) {
    getDb().doc(`users/${userId}`).update({ notificationEmail: email })
}

export async function setUserDateFormat(userId, dateFormat) {
    getDb().doc(`users/${userId}`).update({ dateFormat })
}

export async function setUserFirstDayInCalendar(userId, mondayFirst) {
    getDb().doc(`users/${userId}`).update({ mondayFirstInCalendar: mondayFirst })
}

export async function setUserShowSkillPointsNotification(userId, showSkillPointsNotification) {
    getDb().doc(`users/${userId}`).update({ showSkillPointsNotification })
}

export async function resetUserNewEarnedSkillPoints(userId) {
    getDb().doc(`users/${userId}`).update({ newEarnedSkillPoints: 0 })
}

export async function setUserAutomaticSkillPointDistributionEnabled(userId, automaticSkillPointDistributionEnabled) {
    getDb().doc(`users/${userId}`).update({ automaticSkillPointDistributionEnabled })
}

export async function distributeManualSkillPoints() {
    return await runHttpsCallableFunction('distributeManualSkillPointsSecondGen', {}, { timeout: 540000 })
}

export function addProjectInvitationToUser(projectId, userId) {
    const batch = new BatchWrapper(getDb())
    updateUserDataDirectly(
        userId,
        {
            invitedProjectIds: firebase.firestore.FieldValue.arrayUnion(projectId),
            projectMembershipMutation: {
                projectId,
                action: 'invitation-add',
                actorId: store.getState().loggedUser.uid,
                updatedAt: Date.now(),
            },
        },
        batch,
        projectId
    )
    batch.commit()
}

export async function removeProjectInvitationFromUser(projectId, userId, externalBatch) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    updateUserDataDirectly(
        userId,
        {
            invitedProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
            projectMembershipMutation: {
                projectId,
                action: 'invitation-remove',
                actorId: store.getState().loggedUser.uid,
                updatedAt: Date.now(),
            },
        },
        batch,
        projectId
    )
    if (!externalBatch) batch.commit()
}

export function setUserDailyTopicDate(dailyTopicDate) {
    const { loggedUser } = store.getState()
    firebase
        .firestore()
        .doc(`users/${loggedUser.uid}`)
        .update({ dailyTopicDate: Date.now(), previousDailyTopicDate: dailyTopicDate })
}

export function setUserStatisticsModalDate(statisticsModalDate, newStatisticsModalDate = Date.now()) {
    const { loggedUser } = store.getState()
    return firebase
        .firestore()
        .doc(`users/${loggedUser.uid}`)
        .update({ statisticsModalDate: newStatisticsModalDate, previousStatisticsModalDate: statisticsModalDate })
}

export function updateUserStatisticsFilter(userId, statisticsData) {
    getDb().doc(`users/${userId}`).update({ statisticsData })
}

export function updateUserTimezone(userId, timezone) {
    getDb().doc(`users/${userId}`).update({ timezone })
}

export async function setSomedayTaskTriggerPercent(userId, somedayTaskTriggerPercent) {
    getDb().doc(`users/${userId}`).update({ somedayTaskTriggerPercent })
}

export async function setNumberGoalsAllTeams(userId, goalsAmount) {
    getDb().doc(`users/${userId}`).update({ numberGoalsAllTeams: goalsAmount })
}

export async function setNumberChatsAllTeams(userId, chatsAmount) {
    getDb().doc(`users/${userId}`).update({ numberChatsAllTeams: chatsAmount })
}

export async function setNumberUsersSidebar(userId, usersSidebar) {
    getDb().doc(`users/${userId}`).update({ numberUsersSidebar: usersSidebar })
}

export async function setNumberTodayTasks(userId, todayTasks) {
    getDb().doc(`users/${userId}`).update({ numberTodayTasks: todayTasks })
}

export async function setUserGold(userId, gold, currentGold, note = '') {
    const delta = Number(gold) - (Number(currentGold) || 0)

    if (!Number.isFinite(delta)) {
        throw new Error('Invalid gold value')
    }

    if (delta === 0) {
        return { success: true, newBalance: Number(currentGold) || 0 }
    }

    return await runHttpsCallableFunction('adjustUserGoldSecondGen', {
        targetUserId: userId,
        delta,
        note,
    })
}

export async function setUserLanguage(userId, language) {
    getDb().doc(`users/${userId}`).update({ language })
}

export async function setUserThemeName(userId, themeName) {
    getDb().doc(`users/${userId}`).update({ themeName })
}

// Per-user MCP access config, read server-side by functions/MCP/mcpServerSimple.js.
// mcpEnabled is the master on/off switch (default on); mcpDisabledTools lists the
// tool names the user turned off (default none, so new tools are available by default).
export async function setUserMCPSettings(userId, mcpEnabled, mcpDisabledTools) {
    return getDb()
        .doc(`users/${userId}`)
        .update({
            mcpEnabled: mcpEnabled !== false,
            mcpDisabledTools: Array.isArray(mcpDisabledTools) ? mcpDisabledTools : [],
        })
}

// Per-user model choice for the one-shot AI features (rambler dictation, email draft reply,
// email task summary, task-goal routing) — see functions/Assistant/featureModelPreferences.js.
// Dotted field path so saving one feature cannot clobber the others (the vmAgentSettings lesson).
export async function setUserFeatureModelPreference(userId, featureKey, modelKey) {
    return getDb()
        .doc(`users/${userId}`)
        .update({ [`featureModelPreferences.${featureKey}`]: modelKey || null })
}

export async function setUserAutoPostponeAfterDaysOverdue(userId, autoPostponeAfterDaysOverdue) {
    getDb().doc(`users/${userId}`).update({ autoPostponeAfterDaysOverdue })
}

export async function setUserAutoArchiveProjectsAfterDays(userId, autoArchiveProjectsAfterDays) {
    getDb().doc(`users/${userId}`).update({ autoArchiveProjectsAfterDays })
}

export async function setUserSidebarNavigationMode(userId, sidebarNavigationMode) {
    getDb().doc(`users/${userId}`).update({ sidebarNavigationMode })
}

export async function setUserSidebarExpanded(userId, expanded) {
    getDb().doc(`users/${userId}`).update({ sidebarExpanded: expanded })
}

export async function setUserOKRPrivacyMode(userId, okrPrivacyMode) {
    updateUserData(userId, { okrPrivacyMode }, null)
}

export async function setUserOKRHiddenInAllProjectsToday(userId, projectId, okrId, todayKey) {
    if (!userId || !projectId || !okrId || !todayKey) return
    updateUserData(userId, { [`okrsHiddenInAllProjectsTodayByProjectAndOkr.${projectId}.${okrId}`]: todayKey }, null)
}

export async function clearUserOKRHiddenInAllProjectsToday(userId, projectId, okrId) {
    if (!userId || !projectId || !okrId) return
    updateUserData(
        userId,
        {
            [`okrsHiddenInAllProjectsTodayByProjectAndOkr.${projectId}.${okrId}`]:
                firebase.firestore.FieldValue.delete(),
        },
        null
    )
}

export async function clearUserOKRsHiddenInAllProjectsToday(userId, projectId, okrIds) {
    if (!userId || !projectId || !okrIds?.length) return
    const updates = okrIds.reduce((updates, okrId) => {
        updates[`okrsHiddenInAllProjectsTodayByProjectAndOkr.${projectId}.${okrId}`] =
            firebase.firestore.FieldValue.delete()
        return updates
    }, {})
    updateUserData(userId, updates, null)
}

export async function setUserEmailLineHiddenToday(userId, projectId, todayKey) {
    if (!userId || !projectId || !todayKey) return
    updateUserData(userId, { [`emailLineHiddenTodayByProject.${projectId}`]: todayKey }, null)
}

export async function clearUserEmailLineHiddenToday(userId, projectId) {
    if (!userId || !projectId) return
    updateUserData(
        userId,
        {
            [`emailLineHiddenTodayByProject.${projectId}`]: firebase.firestore.FieldValue.delete(),
        },
        null
    )
}

// Account-level email line: hide/show all listed connections in one write.
export async function setUserEmailLineHiddenTodayForConnections(userId, connectionIds = [], todayKey) {
    if (!userId || !connectionIds.length || !todayKey) return
    const updates = {}
    connectionIds.forEach(connectionId => {
        updates[`emailLineHiddenTodayByConnection.${connectionId}`] = todayKey
    })
    updateUserData(userId, updates, null)
}

export async function clearUserEmailLineHiddenTodayForConnections(userId, connectionIds = []) {
    if (!userId || !connectionIds.length) return
    const updates = {}
    connectionIds.forEach(connectionId => {
        updates[`emailLineHiddenTodayByConnection.${connectionId}`] = firebase.firestore.FieldValue.delete()
    })
    updateUserData(userId, updates, null)
}

export async function updateUserDefaultCurrency(userId, defaultCurrency) {
    getDb().doc(`users/${userId}`).update({ defaultCurrency })
}

export async function setUserReceiveEmails(userId, receiveEmails) {
    updateUserData(userId, { receiveEmails }, null)
}

export async function setUserReceivePushNotifications(userId, pushNotificationsStatus) {
    getDb().doc(`users/${userId}`).update({ pushNotificationsStatus })
}

export async function setUserReceiveWhatsApp(userId, receiveWhatsApp) {
    getDb().doc(`users/${userId}`).update({ receiveWhatsApp })
}

export async function setUserAssistantEmailEnabled(userId, assistantEmailEnabled) {
    getDb().doc(`users/${userId}`).update({ assistantEmailEnabled })
}

export async function setUserLastDayEmptyInbox(userId, date, legacyDate) {
    const emptyInboxDays = [legacyDate, date]
        .filter(value => value != null)
        .map(value => moment(value).format('YYYY-MM-DD'))

    getDb()
        .doc(`users/${userId}`)
        .update({
            lastDayEmptyInbox: date,
            emptyInboxDays: firebase.firestore.FieldValue.arrayUnion(...emptyInboxDays),
        })
}

//////////////////////

export async function removeCopyProjectIdFromUser(userId, projectId) {
    return await getDb()
        .doc(`users/${userId}`)
        .update({ copyProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId) })
}

export function updateStatisticsSelectedUsersIds(projectId, statisticsSelectedUsersIds) {
    const { loggedUser } = store.getState()
    getDb()
        .doc(`users/${loggedUser.uid}`)
        .update({
            [`statisticsSelectedUsersIds.${projectId}`]:
                statisticsSelectedUsersIds.length > 0 ? statisticsSelectedUsersIds : [loggedUser.uid],
        })
}

export function setThatTheUserWasNotifiedAboutTheBotBehavior() {
    const { loggedUser } = store.getState()
    getDb().doc(`users/${loggedUser.uid}`).update({ noticeAboutTheBotBehavior: true })
}

export const addWorkstreamToUser = (projectId, userId, workstreamId, batch) => {
    updateUserDataDirectly(
        userId,
        { [`workstreams.${projectId}`]: firebase.firestore.FieldValue.arrayUnion(workstreamId) },
        batch,
        projectId
    )
}

export const removeWorkstreamFromUser = (projectId, userId, workstreamId, batch) => {
    updateUserDataDirectly(
        userId,
        { [`workstreams.${projectId}`]: firebase.firestore.FieldValue.arrayRemove(workstreamId) },
        batch,
        projectId
    )
}

export const removeUserInvitationToProject = (projectId, userId, batch) => {
    updateUserDataDirectly(
        userId,
        {
            invitedProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
            projectMembershipMutation: {
                projectId,
                action: 'invitation-remove',
                actorId: store.getState().loggedUser.uid,
                updatedAt: Date.now(),
            },
        },
        batch,
        projectId
    )
}

export const updateShowAllProjectsByTime = (userId, showAllProjectsByTime) => {
    getDb().doc(`users/${userId}`).update({ showAllProjectsByTime })
}

//OTHERS FUNCTIONS

function updateProjectDataWhenKickUserFromProject(userId, project, batch) {
    const { administratorUser } = store.getState()
    const { templateCreatorId } = project
    const projectUpdate = {
        userIds: firebase.firestore.FieldValue.arrayRemove(userId),
        [`usersData.${userId}`]: firebase.firestore.FieldValue.delete(),
    }
    if (templateCreatorId === userId) projectUpdate.templateCreatorId = administratorUser.uid
    batch.update(getDb().doc(`projects/${project.id}`), projectUpdate)
}

function updateWorkstreamsDataWhenKickUserFromProject(projectId, userId, workstreams, batch) {
    workstreams.forEach(ws => {
        removeWorkstreamMember(projectId, ws.uid, userId, batch)
    })
}

function updateKickedUserDataWhenKickUserFromProject(projectId, userId, batch) {
    const { loggedUser } = store.getState()
    batch.update(getDb().doc(`users/${userId}`), {
        projectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
        archivedProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
        templateProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
        guideProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
        copyProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
        [`lastVisitBoard.${projectId}`]: firebase.firestore.FieldValue.delete(),
        [`lastVisitBoardInGoals.${projectId}`]: firebase.firestore.FieldValue.delete(),
        [`workstreams.${projectId}`]: firebase.firestore.FieldValue.delete(),
        [`quotaWarnings.${projectId}`]: firebase.firestore.FieldValue.delete(),
        [`apisConnected.${projectId}`]: firebase.firestore.FieldValue.delete(),
        [`statisticsSelectedUsersIds.${projectId}`]: firebase.firestore.FieldValue.delete(),
        [`workflow.${projectId}`]: firebase.firestore.FieldValue.delete(),
        [`unlockedKeysByGuides.${projectId}`]: firebase.firestore.FieldValue.delete(),
        [`commentsData.${projectId}`]: firebase.firestore.FieldValue.delete(),
        projectMembershipMutation: {
            projectId,
            action: 'remove',
            actorId: loggedUser.uid,
            updatedAt: Date.now(),
        },
    })
}

function updateUsersDataWhenKickUserFromProject(projectId, userId, users, batch) {
    users.forEach(user => {
        const { workflow, uid } = user
        if (uid !== userId && workflow && workflow[projectId]) {
            const projectWorkflow = { ...workflow[projectId] }

            const stepIds = Object.keys(projectWorkflow).filter(stepId => {
                return projectWorkflow[stepId].reviewerUid === userId
            })
            stepIds.forEach(stepId => {
                delete projectWorkflow[stepId]
            })

            if (Object.keys(projectWorkflow).length === 0) {
                updateUserDataDirectly(
                    uid,
                    { [`workflow.${projectId}`]: firebase.firestore.FieldValue.delete() },
                    batch,
                    projectId
                )
            } else {
                stepIds.forEach(stepId => {
                    updateUserDataDirectly(
                        uid,
                        { [`workflow.${projectId}.${stepId}`]: firebase.firestore.FieldValue.delete() },
                        batch,
                        projectId
                    )
                })
            }

            const stepIdsToUpdateAddedProperty = Object.keys(projectWorkflow).filter(stepId => {
                return projectWorkflow[stepId].addedById === userId
            })

            stepIdsToUpdateAddedProperty.forEach(stepId => {
                updateUserDataDirectly(uid, { [`workflow.${projectId}.${stepId}.addedById`]: '' }, batch, projectId)
            })
        }
    })
}

export async function updateDefaultProjectIfNeeded(projectId, user) {
    promises = []
    const isLastActiveProject = ProjectHelper.checkIfProjectIsLastActiveProjectOfUser(projectId, user)
    if (isLastActiveProject) {
        promises.push(createDefaultProject(user))
    } else if (user.defaultProjectId === projectId) {
        promises.push(selectAndSetNewDefaultProject(user))
    }
    await Promise.all(promises)
}

export async function kickUserFromProject(projectId, userId) {
    let promises = []
    promises.push(getProjectData(projectId))
    promises.push(getUserData(userId, false))
    promises.push(getUserWorkstreams(projectId, userId))
    promises.push(getProjectUsers(projectId, false))
    const [project, user, workstreams, users] = await Promise.all(promises)

    const batch = new BatchWrapper(getDb())

    updateProjectDataWhenKickUserFromProject(userId, project, batch)
    updateWorkstreamsDataWhenKickUserFromProject(projectId, userId, workstreams, batch)
    updateKickedUserDataWhenKickUserFromProject(projectId, userId, batch)
    updateUsersDataWhenKickUserFromProject(projectId, userId, users, batch)

    await updateDefaultProjectIfNeeded(projectId, user)

    forceUsersToReloadApp(project.userIds, batch, projectId)

    await batch.commit()
}
