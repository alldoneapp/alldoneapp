import { firebase } from '@firebase/app'
import { cloneDeep, uniq } from 'lodash'

import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import store from '../../../redux/store'
import {
    addFollower,
    addFollowerWithoutFeeds,
    addWorkflowStepFeedChain,
    createDefaultProject,
    forceUsersToReloadApp,
    getAllUserProjects,
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
    runHttpsCallableFunction,
    selectAndSetNewDefaultProject,
    spentGold,
    tryAddFollower,
    unlinkDeletedProjectFromInvitedUsers,
    unlinkDeletedProjectFromMembers,
    updateRemovedWorkflowStepSubtaks,
    updateRemovedWorkflowStepTaks,
} from '../firestore'
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
import { setProjectInitialData, setUserInfoModalWhenUserJoinsToGuide, setUsersInProject } from '../../../redux/actions'
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

//ACCESS FUNCTIONS

export async function getUserData(userId, isLoggedUser) {
    try {
        const docSnapshot = await getDb().doc(`/users/${userId}`).get()
        if (!docSnapshot.exists) {
            console.error(`User document not found in Firestore: /users/${userId}`)
            return null
        }
        const user = docSnapshot.data()
        return user ? mapUserData(userId, user, isLoggedUser) : null
    } catch (error) {
        console.error(`Error fetching user data for ${userId}:`, error)
        return null
    }
}

const convertUserDocsInUsers = docs => {
    const users = []
    docs.forEach(doc => {
        users.push(mapUserData(doc.id, doc.data(), false))
    })
    return users
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

export async function watchProjectUsers(projectId, callback, watcherKey) {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`users`)
        .where('projectIds', 'array-contains-any', [projectId])
        .onSnapshot(snapshot => {
            const users = convertUserDocsInUsers(snapshot)
            callback(users)
        })
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

export const updateUserEditionData = async (userId, editorId) => {
    await getDb().runTransaction(async transaction => {
        const ref = getDb().doc(`users/${userId}`)
        const doc = await transaction.get(ref)
        if (doc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
    })
}

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

export async function updateUserData(userId, data, batch) {
    updateEditionData(data)
    const ref = getDb().doc(`users/${userId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

export async function updateUserDataDirectly(userId, data, batch) {
    const ref = getDb().doc(`users/${userId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

export async function uploadNewUser(uid, user, project, task, workstream, assistant) {
    const userToStore = { ...user }
    delete userToStore.uid

    const projectToStore = { ...project }
    delete projectToStore.id
    delete projectToStore.index

    const taskToStore = { ...task }
    delete taskToStore.id

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
    const projects = await getAllUserProjects(userId)

    const batch = new BatchWrapper(getDb())

    let userToForceReloadIds = []
    let promises = []
    projects.forEach(project => {
        promises.push(processProjectWhenDeleteUser(project, userId, userToForceReloadIds, batch))
    })
    await Promise.all(promises)

    batch.delete(getDb().doc(`invoiceNumbers/customInvoiceNumber/users/${userId}`))
    batch.delete(getDb().doc(`karmaPoints/${userId}`))
    batch.delete(getDb().doc(`users/${userId}`))

    const { loggedUser } = store.getState()
    const userToDeleteIsTheLoggedUser = loggedUser.uid === user.uid

    if (!userToDeleteIsTheLoggedUser) {
        userToForceReloadIds = userToForceReloadIds.filter(uid => uid !== loggedUser.uid)
        userToForceReloadIds.push(user.uid)
    }
    forceUsersToReloadApp(uniq(userToForceReloadIds), batch)

    promises = []
    promises.push(logEvent('delete_user', { userId }))
    promises.push(runHttpsCallableFunction('deleteUserSecondGen', { userId }))
    await Promise.all(promises)

    await batch.commit()

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
    updateUserData(userId, { assistantId }, batch)
    await updateChatAssistantWithoutFeeds(projectId, userId, assistantId, batch)
    batch.commit()
    if (needGenerateUpdate) createUserAssistantChangedFeed(projectId, assistantId, userId, null, null)
}

export const setUserNote = async (projectId, userId, noteId) => {
    await updateUserData(userId, { [`noteIdsByProject.${projectId}`]: noteId }, null)
}

export function updateUserLastVisitedBoardDate(projectId, userId, lastVisitBoardProperty) {
    const { loggedUser } = store.getState()
    updateUserData(userId, { [`${lastVisitBoardProperty}.${projectId}.${loggedUser.uid}`]: Date.now() }, null)
}

export async function addUserWorkflowStep(projectId, uid, newStepData) {
    const newStepId = getId()

    updateUserData(uid, { [`workflow.${projectId}.${newStepId}`]: newStepData }, null)

    const { reviewerUid, description } = newStepData
    addWorkflowStepFeedChain(projectId, reviewerUid, uid, description)

    return newStepId
}

export async function modifyUserWorkflowStep(projectId, uid, stepId, newStepData, oldReviewerUid, externalBatch) {
    let batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const newStep = { ...newStepData }
    delete newStep.id

    updateUserData(uid, { [`workflow.${projectId}.${stepId}`]: newStep }, batch)

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

    updateUserData(uid, { [`workflow.${project.id}.${stepId}`]: firebase.firestore.FieldValue.delete() }, batch)

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

    batch.update(getDb().doc(`projects/${projectId}`), {
        userIds: firebase.firestore.FieldValue.arrayUnion(uid),
    })

    if (!project.parentTemplateId) addWorkstreamMember(projectId, DEFAULT_WORKSTREAM_ID, uid, batch)

    const isTemplate = project.isTemplate
    const isGuide = !!project.parentTemplateId

    updateUserData(
        uid,
        isTemplate
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
              },
        batch
    )

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
    await getDb().doc(`users/${userId}`).update({ defaultProjectId: projectId })
}

export function addLockKeyToLoggedUser(userId, projectId, lockKey, goalId) {
    updateUserData(
        userId,
        { [`unlockedKeysByGuides.${projectId}`]: firebase.firestore.FieldValue.arrayUnion(lockKey) },
        null
    )
    logEvent('UnlockGoal', {
        userId,
        goalId,
    })
    runHttpsCallableFunction('proccessAlgoliaRecordsWhenUnlockGoalSecondGen', {
        projectId,
        goalId,
    })
    spentGold(userId, UNLOCK_GOAL_COST)
}

export const updateUserLastCommentData = async (projectId, userId, lastComment, commentType) => {
    getDb()
        .doc(`users/${userId}`)
        .update({
            [`commentsData.${projectId}.lastComment`]: lastComment,
            [`commentsData.${projectId}.lastCommentType`]: commentType,
            [`commentsData.${projectId}.amount`]: firebase.firestore.FieldValue.increment(1),
        })
}

export function addLockKeyToGoalOwner(userUnlockingId, projectId, lockKey, goalId, goalOwnerId) {
    updateUserData(
        goalOwnerId,
        {
            [`unlockedKeysByGuides.${projectId}`]: firebase.firestore.FieldValue.arrayUnion(lockKey),
        },
        null
    )
    logEvent('UnlockGoal', {
        userUnlockingId,
        goalId,
    })
    runHttpsCallableFunction('proccessAlgoliaRecordsWhenUnlockGoalSecondGen', {
        projectId,
        goalId,
    })
    spentGold(userUnlockingId, UNLOCK_GOAL_COST)

    const { projectUsers } = store.getState()

    const usersInProject = [...projectUsers[projectId]]

    const index = usersInProject.findIndex(user => user.uid === goalOwnerId)
    const user = usersInProject[index]

    const unlockedKeysByGuides = cloneDeep(user.unlockedKeysByGuides)
    if (unlockedKeysByGuides[projectId]) {
        unlockedKeysByGuides[projectId].push(lockKey)
    } else {
        unlockedKeysByGuides[projectId] = [lockKey]
    }

    usersInProject[index] = { ...user, unlockedKeysByGuides }
    store.dispatch(setUsersInProject(projectId, usersInProject))
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

export function addProjectInvitationToUser(projectId, userId) {
    const batch = new BatchWrapper(getDb())
    batch.update(getDb().doc(`users/${userId}`), {
        invitedProjectIds: firebase.firestore.FieldValue.arrayUnion(projectId),
    })
    batch.commit()
}

export async function removeProjectInvitationFromUser(projectId, userId, externalBatch) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    batch.update(getDb().doc(`users/${userId}`), {
        invitedProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
    })
    if (!externalBatch) batch.commit()
}

export function setUserDailyTopicDate(dailyTopicDate) {
    const { loggedUser } = store.getState()
    firebase
        .firestore()
        .doc(`users/${loggedUser.uid}`)
        .update({ dailyTopicDate: Date.now(), previousDailyTopicDate: dailyTopicDate })
}

export function setUserStatisticsModalDate(statisticsModalDate) {
    const { loggedUser } = store.getState()
    firebase
        .firestore()
        .doc(`users/${loggedUser.uid}`)
        .update({ statisticsModalDate: Date.now(), previousStatisticsModalDate: statisticsModalDate })
}

export function updateUserStatisticsFilter(userId, statisticsData) {
    getDb().doc(`users/${userId}`).update({ statisticsData })
}

export function updateUserTimezone(userId, timezone) {
    getDb().doc(`users/${userId}`).update({ timezone })
}

export async function setBotAdvaiceTriggerPercent(userId, botAdvaiceTriggerPercent) {
    getDb().doc(`users/${userId}`).update({ botAdvaiceTriggerPercent })
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

export function setUserGold(userId, gold) {
    getDb().doc(`users/${userId}`).update({ gold })
}

export async function setUserLanguage(userId, language) {
    getDb().doc(`users/${userId}`).update({ language })
}

export async function setUserThemeName(userId, themeName) {
    getDb().doc(`users/${userId}`).update({ themeName })
}

export async function setUserSidebarExpanded(userId, expanded) {
    getDb().doc(`users/${userId}`).update({ sidebarExpanded: expanded })
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

export async function setUserLastDayEmptyInbox(userId, date) {
    getDb().doc(`users/${userId}`).update({ lastDayEmptyInbox: date })
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
    batch.update(getDb().doc(`users/${userId}`), {
        [`workstreams.${projectId}`]: firebase.firestore.FieldValue.arrayUnion(workstreamId),
    })
}

export const removeWorkstreamFromUser = (projectId, userId, workstreamId, batch) => {
    batch.update(getDb().doc(`users/${userId}`), {
        [`workstreams.${projectId}`]: firebase.firestore.FieldValue.arrayRemove(workstreamId),
    })
}

export const removeUserInvitationToProject = (projectId, userId, batch) => {
    batch.update(getDb().doc(`users/${userId}`), {
        invitedProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
    })
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
                batch.update(getDb().doc(`users/${uid}`), {
                    [`workflow.${projectId}`]: firebase.firestore.FieldValue.delete(),
                })
            } else {
                stepIds.forEach(stepId => {
                    batch.update(getDb().doc(`users/${uid}`), {
                        [`workflow.${projectId}.${stepId}`]: firebase.firestore.FieldValue.delete(),
                    })
                })
            }

            const stepIdsToUpdateAddedProperty = Object.keys(projectWorkflow).filter(stepId => {
                return projectWorkflow[stepId].addedById === userId
            })

            stepIdsToUpdateAddedProperty.forEach(stepId => {
                batch.update(getDb().doc(`users/${uid}`), {
                    [`workflow.${projectId}.${stepId}.addedById`]: '',
                })
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

    forceUsersToReloadApp(project.userIds, batch)

    await batch.commit()
}

const checkIfUserIsLastUser = (userId, projectUserIds, templateCreatorId) => {
    if (templateCreatorId) {
        const { administratorUser } = store.getState()
        return (
            projectUserIds.filter(uid => uid !== userId && uid !== templateCreatorId && uid !== administratorUser.uid)
                .length === 0
        )
    } else {
        return projectUserIds.filter(uid => uid !== userId).length === 0
    }
}

async function kickUserFromProjectWhenDeleteUser(project, userId, userToForceReloadIds, batch) {
    let promises = []
    promises.push(getUserWorkstreams(project.id, userId))
    promises.push(getProjectUsers(project.id, false))
    const [workstreams, users] = await Promise.all(promises)

    userToForceReloadIds.push(...users.map(user => user.uid).filter(uid => uid !== userId))

    updateProjectDataWhenKickUserFromProject(userId, project, batch)
    updateWorkstreamsDataWhenKickUserFromProject(project.id, userId, workstreams, batch)
    updateUsersDataWhenKickUserFromProject(project.id, userId, users, batch)
}

async function removeProjectWhenDeleteUser(project, userId, userToForceReloadIds, batch) {
    const { id: projectId, userIds, parentTemplateId } = project

    const userToUpdateIds = userIds.filter(uid => uid !== userId)
    if (userIds) unlinkDeletedProjectFromMembers(projectId, batch, userToUpdateIds)
    await unlinkDeletedProjectFromInvitedUsers(projectId, batch)
    if (parentTemplateId) {
        batch.update(getDb().doc(`projects/${parentTemplateId}`), {
            guideProjectIds: firebase.firestore.FieldValue.arrayRemove(projectId),
        })
    }

    batch.delete(getDb().doc(`projects/${projectId}`))
    userToForceReloadIds.push(...userToUpdateIds)
}

async function processProjectWhenDeleteUser(project, userId, userToForceReloadIds, batch) {
    const { parentTemplateId, userIds } = project

    let templateCreatorId = ''
    if (parentTemplateId) {
        const template = await getProjectData(parentTemplateId)
        if (template && template.templateCreatorId) templateCreatorId = template.templateCreatorId
    }
    const isLastUser = !userIds || checkIfUserIsLastUser(userId, userIds, templateCreatorId)

    if (isLastUser) {
        await removeProjectWhenDeleteUser(project, userId, userToForceReloadIds, batch)
    } else {
        await kickUserFromProjectWhenDeleteUser(project, userId, userToForceReloadIds, batch)
    }
}
