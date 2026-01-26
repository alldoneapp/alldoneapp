const admin = require('firebase-admin')

//ACCESS FUNCTIONS

const getUserData = async userId => {
    const user = (await admin.firestore().doc(`users/${userId}`).get()).data()
    if (user) user.uid = userId
    return user
}

const convertUserDocsInUsers = docs => {
    const users = []
    docs.forEach(doc => {
        users.push({ ...doc.data(), uid: doc.id })
    })
    return users
}

const getUsers = async getOnlyDocs => {
    const docs = (await admin.firestore().collection(`users`).get()).docs
    return getOnlyDocs ? docs : convertUserDocsInUsers(docs)
}

const getUsersByIds = async userIds => {
    const promises = []
    userIds.forEach(id => {
        promises.push(getUserData(id))
    })
    return await Promise.all(promises)
}

const getProjectUsers = async (projectId, getOnlyDocs) => {
    const docs = (
        await admin.firestore().collection(`users`).where('projectIds', 'array-contains-any', [projectId]).get()
    ).docs
    return getOnlyDocs ? docs : convertUserDocsInUsers(docs)
}

const getLastActiveUsers = async usersAmount => {
    const docs = (await admin.firestore().collection(`users`).orderBy('lastLogin', 'desc').limit(usersAmount).get())
        .docs
    return convertUserDocsInUsers(docs)
}

const getUsersByPremiumStatus = async (status, getOnlyDocs) => {
    const docs = (await admin.firestore().collection(`users`).where('premium.status', '==', status).get()).docs
    if (getOnlyDocs) return docs
    return getOnlyDocs ? docs : convertUserDocsInUsers(docs)
}

const getUsersThatEarnedSomeGoldToday = async getOnlyDocs => {
    const DAILY_GOLD_LIMIT = 100
    const docs = (await admin.firestore().collection(`users`).where('dailyGold', '!=', DAILY_GOLD_LIMIT).get()).docs
    if (getOnlyDocs) return docs
    return getOnlyDocs ? docs : convertUserDocsInUsers(docs)
}

const getUserWithTaskActive = async taskId => {
    const docs = (await admin.firestore().collection(`users`).where('activeTaskId', '==', taskId).get()).docs
    return convertUserDocsInUsers(docs)
}

//EDTION AND ADITION FUNCTIONS

const updateUserEditionData = async (userId, editorId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`users/${userId}`)
            const userDoc = await transaction.get(ref)
            if (userDoc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const updateUserDailyGold = async (userId, dailyGold) => {
    await admin.firestore().doc(`users/${userId}`).update({ dailyGold })
}

async function clearUserTaskInFocusIfMatch(userId, taskId) {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`users/${userId}`)
            const userDoc = await transaction.get(ref)
            if (userDoc.exists) {
                const { inFocusTaskId } = userDoc.data()
                if (taskId === inFocusTaskId) {
                    transaction.update(ref, {
                        inFocusTaskId: '',
                        inFocusTaskProjectId: '',
                    })
                }
            }
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const resetActiveTaskDates = async (userId, date, endDate) => {
    await admin
        .firestore()
        .doc(`users/${userId}`)
        .update({ activeTaskStartingDate: date, activeTaskInitialEndingDate: endDate })
}

const adGoldToUser = async (userId, gold) => {
    await admin
        .firestore()
        .doc(`users/${userId}`)
        .update({ gold: admin.firestore.FieldValue.increment(gold) })
}

const removeUserFcmTokens = async (userId, tokens, batch) => {
    batch.update(admin.firestore().doc(`users/${userId}`), {
        fcmToken: admin.firestore.FieldValue.arrayRemove(...tokens),
    })
}

const updateUserLastCommentData = async (projectId, userId, lastComment, lastCommentType) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`users/${userId}`)
            const userDoc = await transaction.get(ref)
            if (userDoc.exists)
                transaction.update(ref, {
                    [`commentsData.${projectId}.lastComment`]: lastComment,
                    [`commentsData.${projectId}.lastCommentType`]: lastCommentType,
                    [`commentsData.${projectId}.amount`]: admin.firestore.FieldValue.increment(1),
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const resetUserLastCommentData = async (projectId, userId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`users/${userId}`)
            const userDoc = await transaction.get(ref)
            if (userDoc.exists)
                transaction.update(ref, {
                    [`commentsData.${projectId}.lastComment`]: null,
                    [`commentsData.${projectId}.lastCommentType`]: null,
                    [`commentsData.${projectId}.amount`]: 0,
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

module.exports = {
    updateUserDailyGold,
    getUserData,
    getProjectUsers,
    adGoldToUser,
    getUsersByPremiumStatus,
    getUsers,
    getUsersThatEarnedSomeGoldToday,
    getUsersByIds,
    updateUserEditionData,
    updateUserLastCommentData,
    resetUserLastCommentData,
    getLastActiveUsers,
    removeUserFcmTokens,
    getUserWithTaskActive,
    resetActiveTaskDates,
    clearUserTaskInFocusIfMatch,
}
