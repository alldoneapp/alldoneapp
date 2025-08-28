const moment = require('moment')
const { logEvent } = require('../GAnalytics/GAnalytics')
const { addFollower, FOLLOW_TYPE_PROJECTS } = require('./FollowObjectHelper')

const copyProject = async (firebase, projectId, user) => {
    const db = firebase.firestore()
    const originProject = (await db.doc(`/projects/${projectId}`).get()).data()

    delete originProject.id // delete old ID if it is in DB
    const copyProject = {
        ...originProject,
        created: Date.now(),
        creatorId: user.uid,
        projectStartDate: Date.now(),
        userIds: [user.uid],
        isPrivate: false,
        isShared: 0, // PROJECT_PUBLIC
        usersData: {},
        lastActionDate: moment().valueOf(),
        activeFullSearch: null,
        lastChatActionDate: moment().subtract(30, 'year').valueOf(),
        monthlyXp: 0,
        monthlyTraffic: 0,
    }

    const projectRef = db.collection('/projects').doc()
    const copyProjectId = projectRef.id

    await projectRef.set(copyProject)
    await db
        .doc(`users/${user.uid}`)
        .update({ copyProjectIds: firebase.firestore.FieldValue.arrayUnion(copyProjectId) })
    await addFollower(firebase, copyProjectId, user.uid, FOLLOW_TYPE_PROJECTS, copyProjectId)

    await logEvent(user.uid, 'duplicate_project', {
        oldProjectId: projectId,
        newProjectId: copyProjectId,
        name: copyProject.name,
    })

    return { ...copyProject, id: copyProjectId }
}

module.exports = {
    copyProject,
}
