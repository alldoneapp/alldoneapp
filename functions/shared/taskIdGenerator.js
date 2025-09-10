/**
 * Task ID Generator - Cloud Functions compatible utility for generating human readable task IDs
 *
 * This is a simplified version of the getNextTaskId function from utils/backends/Projects/projectsFirestore.js
 * that works in Cloud Functions without React Native dependencies.
 */

const admin = require('firebase-admin')

/**
 * Generate project prefix from project name
 * @param {string} projectName - Name of the project
 * @returns {string} Two-letter uppercase prefix
 */
function generateProjectPrefix(projectName) {
    if (!projectName || projectName.length === 0) {
        return 'TA' // Default fallback
    }

    // Remove non-alphabetic characters and get first 2 letters
    const cleanName = projectName.replace(/[^a-zA-Z]/g, '')

    if (cleanName.length === 0) {
        return 'TA' // Fallback if no letters found
    }

    // Get first 2 letters, convert to uppercase
    const prefix = cleanName.substring(0, 2).toUpperCase()
    return prefix.length === 1 ? prefix + 'A' : prefix
}

/**
 * Initialize task ID counter for a project if it doesn't exist
 * @param {string} projectId - Project ID
 */
async function initializeProjectTaskCounter(projectId) {
    const db = admin.firestore()
    const projectRef = db.doc(`projects/${projectId}`)

    try {
        await db.runTransaction(async transaction => {
            const projectDoc = await transaction.get(projectRef)

            if (projectDoc.exists && !projectDoc.data().hasOwnProperty('taskIdCounter')) {
                transaction.update(projectRef, { taskIdCounter: 0 })
            }
        })
    } catch (error) {
        console.error('Error initializing task counter for project:', projectId, error)
    }
}

/**
 * Generate next task ID for a project and increment counter
 * @param {string} projectId - Project ID
 * @returns {Promise<string>} Human readable task ID (e.g., "TA-1", "PR-42")
 */
async function getNextTaskId(projectId) {
    const db = admin.firestore()
    const projectRef = db.doc(`projects/${projectId}`)

    try {
        return await db.runTransaction(async transaction => {
            const projectDoc = await transaction.get(projectRef)

            if (!projectDoc.exists) {
                throw new Error(`Project ${projectId} not found`)
            }

            const projectData = projectDoc.data()
            const currentCounter = projectData.taskIdCounter || 0
            const nextCounter = currentCounter + 1

            // Update the counter
            transaction.update(projectRef, { taskIdCounter: nextCounter })

            // Generate the human-readable ID
            const prefix = generateProjectPrefix(projectData.name)
            const humanReadableId = `${prefix}-${nextCounter}`

            return humanReadableId
        })
    } catch (error) {
        console.error('Error generating task ID for project:', projectId, error)

        // Fallback strategy: try to get project data for prefix, use timestamp for number
        try {
            const projectDoc = await db.doc(`projects/${projectId}`).get()
            if (projectDoc.exists) {
                const prefix = generateProjectPrefix(projectDoc.data().name)
                const timestamp = Date.now().toString().slice(-4)
                return `${prefix}-${timestamp}`
            }
        } catch (fallbackError) {
            console.error('Error in fallback ID generation:', fallbackError)
        }

        // Ultimate fallback
        const timestamp = Date.now().toString().slice(-4)
        return `TA-${timestamp}`
    }
}

module.exports = {
    getNextTaskId,
    generateProjectPrefix,
    initializeProjectTaskCounter,
}
