const { copyProject } = require('./ProjectObject')
const { copyContacts } = require('./ContactObject')
const { copyGoals } = require('./GoalObject')
const { copyWorkstream } = require('./WorkstreamObject')
const { copyTasks } = require('./TaskObject')
const { copyNotes, copyObjectNotes } = require('./NoteObject')
const {
    COPY_PROJECT_TASKS,
    COPY_PROJECT_GOALS,
    COPY_PROJECT_NOTES,
    COPY_PROJECT_CONTACTS,
    COPY_PROJECT_WORKSTREAMS,
    FEED_PUBLIC_FOR_ALL,
} = require('./HelperFunctions')

const SendInBlueManager = require('../SendInBlueManager')
const moment = require('moment')
const { addFollower, FOLLOW_TYPE_USERS } = require('./FollowObjectHelper')
const { inProductionEnvironment } = require('../Utils/HelperFunctionsCloud')

const onCopyProject = async (admin, projectId, user, options) => {
    const db = admin.firestore()

    const newProject = await copyProject(admin, projectId, user)
    const newProjectId = newProject.id
    const objectsToDuplicate = await getListOfObjects(admin, projectId, user, options)

    const objectNoteIdList = []

    // Copy he Workstreams
    await copyWorkstream(admin, projectId, newProjectId, user, objectsToDuplicate[COPY_PROJECT_WORKSTREAMS])

    let copyTasksResult = null
    let amountsByGoals = null
    if (options.includes(COPY_PROJECT_TASKS)) {
        // Copy the tasks
        copyTasksResult = await copyTasks(
            admin,
            projectId,
            newProjectId,
            user,
            objectsToDuplicate[COPY_PROJECT_TASKS],
            options.includes(COPY_PROJECT_GOALS),
            options.includes(COPY_PROJECT_NOTES)
        )

        amountsByGoals = copyTasksResult.taskAmountsByGoals
        objectNoteIdList.push(...copyTasksResult.objectNotes)
    }

    if (options.includes(COPY_PROJECT_GOALS)) {
        // Copy the goals
        const taskAmountsByGoals = options.includes(COPY_PROJECT_TASKS) ? amountsByGoals : null
        objectNoteIdList.push(
            ...(await copyGoals(
                admin,
                projectId,
                newProjectId,
                user,
                objectsToDuplicate[COPY_PROJECT_GOALS],
                taskAmountsByGoals
            ))
        )
    }

    if (options.includes(COPY_PROJECT_NOTES)) {
        // Copy the notes
        await copyNotes(admin, projectId, newProjectId, user, objectsToDuplicate[COPY_PROJECT_NOTES])
    }

    if (options.includes(COPY_PROJECT_CONTACTS)) {
        // Copy the contacts
        objectNoteIdList.push(
            ...(await copyContacts(admin, projectId, newProjectId, user, objectsToDuplicate[COPY_PROJECT_CONTACTS]))
        )
    }

    // Copy all object notes
    await copyObjectNotes(admin, projectId, newProjectId, user, objectNoteIdList)

    // Update reference of project in user at the end of the process
    await db.doc(`users/${user.uid}`).update({
        projectIds: admin.firestore.FieldValue.arrayUnion(newProjectId),
    })
    await addFollower(admin, newProjectId, user.uid, FOLLOW_TYPE_USERS, user.uid)

    // send email at the end of duplication process
    let data = {
        userEmail: user.notificationEmail ? user.notificationEmail : user.email,
        projectName: newProject.name,
        projectColor: newProject.color,
        projectDetailsURL: `project/${newProjectId}/properties`,
        date: moment().format('DD.MM.YYYY HH:mm'),
    }

    return inProductionEnvironment() ? SendInBlueManager.sendEmailAfterProjectDuplication(data) : null
}

const getListOfObjects = async (firebase, projectId, user, options) => {
    const db = firebase.firestore()
    const promises = {}

    // Copy the workstreams
    promises[COPY_PROJECT_WORKSTREAMS] = (
        await db.collection(`/projectsWorkstreams/${projectId}/workstreams`).get()
    ).docs

    if (options.includes(COPY_PROJECT_TASKS)) {
        // Copy the tasks
        promises[COPY_PROJECT_TASKS] = (
            await db
                .collection(`items/${projectId}/tasks`)
                .where('isPublicFor', 'array-contains', FEED_PUBLIC_FOR_ALL)
                .where('genericData', '==', null)
                .where('parentDone', '==', false)
                .where('done', '==', false)
                .get()
        ).docs
    }

    if (options.includes(COPY_PROJECT_GOALS)) {
        // Copy the goals
        promises[COPY_PROJECT_GOALS] = (
            await db
                .collection(`/goals/${projectId}/items`)
                .where('isPublicFor', 'array-contains', FEED_PUBLIC_FOR_ALL)
                .get()
        ).docs
    }

    if (options.includes(COPY_PROJECT_NOTES)) {
        // Copy the notes
        promises[COPY_PROJECT_NOTES] = (
            await db
                .collection(`/noteItems/${projectId}/notes`)
                .where('isPublicFor', 'array-contains', FEED_PUBLIC_FOR_ALL)
                .get()
        ).docs
    }

    if (options.includes(COPY_PROJECT_CONTACTS)) {
        // Get all CONTACTS
        promises[COPY_PROJECT_CONTACTS] = (
            await db
                .collection(`/projectsContacts/${projectId}/contacts`)
                .where('isPublicFor', 'array-contains', FEED_PUBLIC_FOR_ALL)
                .get()
        ).docs
    }

    return promises
}

module.exports = {
    onCopyProject,
    getListOfObjects,
}
