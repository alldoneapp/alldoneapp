const { getProjectUsers } = require('../Users/usersFirestore')
const { mapProjectData } = require('../Utils/MapDataFuncions')

let lastPushTime = 0

async function getProject(projectId, appAdmin) {
    const project = (await appAdmin.firestore().doc(`projects/${projectId}`).get()).data()
    return project ? mapProjectData(projectId, project) : null
}

async function getUserProjects(userId, appAdmin) {
    const projectDocs = (
        await appAdmin.firestore().collection(`projects`).where('userIds', 'array-contains', userId).get()
    ).docs

    const projects = []
    projectDocs.forEach(doc => {
        projects.push(mapProjectData(doc.id, doc.data(), {}))
    })

    return projects
}

async function updateFullSearchInProject(projectId, activeFullSearch, db, batch) {
    batch
        ? batch.update(db.doc(`projects/${projectId}`), { activeFullSearch })
        : await db.doc(`projects/${projectId}`).update({ activeFullSearch })
}

async function getTemplateGuideIds(templateId, appAdmin) {
    const projectDocs = (
        await appAdmin.firestore().collection(`projects`).where('parentTemplateId', '==', templateId).get()
    ).docs

    const projectIds = []
    projectDocs.forEach(doc => {
        projectIds.push(doc.id)
    })

    return projectIds
}

async function mapUsersInProject(projectId, db, usersMap) {
    const userDocs = await getProjectUsers(projectId, true)

    for (let doc of userDocs) {
        if (!usersMap[doc.id]) {
            usersMap[doc.id] = doc.data()
            usersMap[doc.id].uid = doc.id
        }
    }
}

async function getServerCurrentTime(appAdmin) {
    const currentTime = (await appAdmin.firestore().doc('/info/currentTime/').get()).data()
    if (currentTime.time) {
        return currentTime.time.seconds * 1000
    } else {
        return await getServerCurrentTime(appAdmin)
    }
}

async function getFirebaseTimestampDirectly(admin, appAdmin) {
    await appAdmin.firestore().doc('/info/currentTime/').set({ time: admin.firestore.FieldValue.serverTimestamp() })
    const currentTime = await getServerCurrentTime(appAdmin)
    return currentTime
}

function getId() {
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

module.exports = {
    getFirebaseTimestampDirectly,
    getId,
    getProject,
    mapUsersInProject,
    getTemplateGuideIds,
    updateFullSearchInProject,
    getUserProjects,
}
