const admin = require('firebase-admin')

const setProjectAssistant = async (projectId, assistantId) => {
    console.log(`[setProjectAssistant] Updating project ${projectId} assistantId to: "${assistantId}"`)
    await admin.firestore().doc(`projects/${projectId}`).update({ assistantId })
    console.log(`[setProjectAssistant] Successfully updated project ${projectId}`)
}

module.exports = { setProjectAssistant }
