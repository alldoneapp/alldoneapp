const admin = require('firebase-admin')

const updateProjectLastUserInteractionDate = async (projectId, date) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`projects/${projectId}`)
            const doc = await transaction.get(ref)
            if (doc.exists)
                transaction.update(ref, {
                    lastUserInteractionDate: date,
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const setProjectAssistant = async (projectId, assistantId) => {
    admin.firestore().doc(`projects/${projectId}`).update({ assistantId })
}

module.exports = { updateProjectLastUserInteractionDate, setProjectAssistant }
