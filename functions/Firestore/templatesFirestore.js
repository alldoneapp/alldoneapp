const { mapMilestoneData, mapNoteData, mapTaskData } = require('../Utils/MapDataFuncions')
const { trackStickyNote } = require('./tasksFirestoreCloud')
const { logEvent } = require('../GAnalytics/GAnalytics')

const { createNoteFeedsChain, updateNoteFeedsChain } = require('../Feeds/notesFeedsChains')
const { loadFeedsGlobalState, getGlobalState } = require('../GlobalState/globalState')
const { getUserData, getProjectUsers } = require('../Users/usersFirestore')

async function getMainOpenTasks(appAdmin, projectId, userId) {
    const tasksDocs = await appAdmin
        .firestore()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', userId)
        .where('currentReviewerId', '==', userId)
        .where('done', '==', false)
        .where('parentDone', '==', false)
        .where('completed', '==', null)
        .where('genericData', '==', null)
        .where('suggestedBy', '==', null)
        .where('calendarData', '==', null)
        .where('gmailData', '==', null)
        .orderBy('dueDate', 'asc')
        .orderBy('sortIndex', 'desc')
        .get()
    const tasks = []

    tasksDocs.forEach(doc => {
        tasks.push(mapTaskData(doc.id, doc.data()))
    })
    return tasks
}

async function getOpenMilestones(appAdmin, projectId) {
    const milestonesDocs = (
        await appAdmin
            .firestore()
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('done', '==', false)
            .orderBy('date', 'asc')
            .get()
    ).docs

    const milestonesByDate = {}
    milestonesDocs.forEach(doc => {
        const milestone = mapMilestoneData(doc.id, doc.data())
        milestonesByDate[milestone.date] = milestone
    })
    return milestonesByDate
}

async function getAllNotes(appAdmin, projectId) {
    const notesDocs = (await appAdmin.firestore().collection(`noteItems/${projectId}/notes`).get()).docs

    const notes = []
    notesDocs.forEach(doc => {
        notes.push(mapNoteData(doc.id, doc.data()))
    })
    return notes
}

async function getNotesLinkedToTemplate(appAdmin, projectId) {
    const notesDocs = (
        await appAdmin
            .firestore()
            .collection(`noteItems/${projectId}/notes`)
            .where('linkedToTemplate', '==', true)
            .get()
    ).docs

    const notes = {}
    notesDocs.forEach(doc => {
        notes[doc.id] = mapNoteData(doc.id, doc.data())
    })
    return notes
}

async function getAssistantTasks(appAdmin, projectId, assistantId) {
    const taskDocs = (await appAdmin.firestore().collection(`/assistantTasks/${projectId}/${assistantId}`).get()).docs
    const tasks = []
    taskDocs.forEach(doc => {
        tasks.push({ id: doc.id, ...doc.data() })
    })
    return tasks
}

async function getListFollowedContacts(appAdmin, projectId, userId) {
    const data = (await appAdmin.firestore().doc(`usersFollowing/${projectId}/entries/${userId}`).get()).data()
    const followedContacts = data && data.contacts ? data.contacts : {}
    return followedContacts
}

async function copyHashtags(appAdmin, templateId, guideId) {
    const hashtagsDocs = await appAdmin.firestore().collection(`tagsColors/${templateId}/hashtags`).get()
    const promises = []
    hashtagsDocs.forEach(doc => {
        const hashtag = doc.data()
        promises.push(appAdmin.firestore().doc(`tagsColors/${guideId}/hashtags/${doc.id}`).set(hashtag))
    })
    await Promise.all(promises)
}

async function loadGlobalData(admin, appAdmin, projectId, userId, creatorId) {
    const promises = []
    promises.push(getUserData(userId))
    promises.push(appAdmin.firestore().doc(`projects/${projectId}`).get())
    promises.push(getProjectUsers(projectId))
    promises.push(getUserData(creatorId))
    const results = await Promise.all(promises)

    const feedCreator = results[0]
    const project = results[1].data()
    const users = results[2]
    const templateCreator = results[3]

    loadFeedsGlobalState(
        admin,
        appAdmin,
        { ...feedCreator, uid: userId },
        { ...project, id: projectId },
        users,
        templateCreator
    )
}

async function addUnlockedKeyToCreator(appAdmin, projectId, userId, lockKey) {
    await appAdmin
        .firestore()
        .doc(`users/${userId}`)
        .update({ [`unlockedKeysByGuides.${projectId}`]: [lockKey] })
}

async function uploadMilestone(appAdmin, projectId, milestone) {
    const milestoneCopy = { ...milestone }
    delete milestoneCopy.id
    delete milestoneCopy.oldId

    await appAdmin.firestore().doc(`goalsMilestones/${projectId}/milestonesItems/${milestone.id}`).set(milestoneCopy)
}

async function uploadAssistantTask(appAdmin, projectId, assistantId, assistantTask) {
    const assistantTaskCopy = { ...assistantTask }
    delete assistantTaskCopy.id
    delete assistantTaskCopy.oldId

    await appAdmin
        .firestore()
        .doc(`assistantTasks/${projectId}/${assistantId}/${assistantTask.id}`)
        .set(assistantTaskCopy)
}

async function uploadNote(projectId, note, oldNote) {
    const { appAdmin, project } = getGlobalState()

    const noteCopy = { ...note }
    delete noteCopy.id
    delete noteCopy.oldId

    let promises = []
    const { stickyEndDate } = noteCopy.stickyData
    if (stickyEndDate > 0) promises.push(trackStickyNote(appAdmin, projectId, note.id, stickyEndDate))
    promises.push(appAdmin.firestore().collection(`noteItems/${projectId}/notes`).doc(note.id).set(noteCopy))
    await Promise.all(promises)

    promises = []
    promises.push(
        oldNote
            ? updateNoteFeedsChain(
                  projectId,
                  note.id,
                  note,
                  oldNote,
                  false,
                  note.linkedToTemplate ? project.userIds : [],
                  false
              )
            : createNoteFeedsChain(projectId, note.id, note, false, note.linkedToTemplate ? project.userIds : [], false)
    )
    promises.push(logEvent('', 'new_note', { id: note.id, uid: note.userId }))
    await Promise.all(promises)
}

module.exports = {
    uploadNote,
    uploadAssistantTask,
    uploadMilestone,
    getListFollowedContacts,
    getAllNotes,
    getNotesLinkedToTemplate,
    getOpenMilestones,
    getMainOpenTasks,
    loadGlobalData,
    copyHashtags,
    addUnlockedKeyToCreator,
    getAssistantTasks,
}
