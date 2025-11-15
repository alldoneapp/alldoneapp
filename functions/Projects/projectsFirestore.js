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
    console.log(`[setProjectAssistant] Updating project ${projectId} assistantId to: "${assistantId}"`)
    await admin.firestore().doc(`projects/${projectId}`).update({ assistantId })
    console.log(`[setProjectAssistant] Successfully updated project ${projectId}`)
}

module.exports = { updateProjectLastUserInteractionDate, setProjectAssistant }
