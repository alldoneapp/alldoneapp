const admin = require('firebase-admin')

const updateSkillEditionData = async (projectId, skillId, editorId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`skills/${projectId}/items/${skillId}`)
            const skillDoc = await transaction.get(ref)
            if (skillDoc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const updateSkillLastCommentData = async (projectId, skillId, lastComment, lastCommentType) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`skills/${projectId}/items/${skillId}`)
            const skillDoc = await transaction.get(ref)
            if (skillDoc.exists)
                transaction.update(ref, {
                    [`commentsData.lastComment`]: lastComment,
                    [`commentsData.lastCommentType`]: lastCommentType,
                    [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const resetSkillLastCommentData = async (projectId, skillId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`skills/${projectId}/items/${skillId}`)
            const skillDoc = await transaction.get(ref)
            if (skillDoc.exists)
                transaction.update(ref, {
                    [`commentsData.lastComment`]: null,
                    [`commentsData.lastCommentType`]: null,
                    [`commentsData.amount`]: 0,
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

module.exports = {
    updateSkillEditionData,
    updateSkillLastCommentData,
    resetSkillLastCommentData,
}
