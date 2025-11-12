// Optimized Firestore operations with connection reuse
const admin = require('firebase-admin')

// Cache Firestore instance
let firestoreInstance = null
function getFirestore() {
    if (!firestoreInstance) {
        firestoreInstance = admin.firestore()
    }
    return firestoreInstance
}

// Optimized user data fetching with field selection
async function getUserDataOptimized(userId) {
    const startTime = Date.now()
    const db = getFirestore()

    const userDoc = await db.doc(`users/${userId}`).get()
    const data = userDoc.exists ? userDoc.data() : null

    const result = {
        gold: data?.gold,
        timezone: data?.timezone,
        timezoneOffset: data?.timezoneOffset,
        timezoneMinutes: data?.timezoneMinutes,
        preferredTimezone: data?.preferredTimezone,
    }

    console.log(`[FIRESTORE] getUserData: ${Date.now() - startTime}ms`)
    return result
}

// Optimized assistant fetching with caching
const assistantCache = new Map()
async function getAssistantForChatOptimized(assistantId) {
    const startTime = Date.now()

    // Check cache first (cache for 5 minutes)
    const cacheKey = `${assistantId}_${Math.floor(Date.now() / 300000)}`
    if (assistantCache.has(cacheKey)) {
        console.log(`[FIRESTORE] getAssistant (CACHED): 0ms`)
        return assistantCache.get(cacheKey)
    }

    const db = getFirestore()
    const assistantDoc = await db.doc(`assistants/${assistantId}`).get()

    const assistant = assistantDoc.data()

    // Cache the result
    assistantCache.set(cacheKey, assistant)
    // Clean old cache entries
    if (assistantCache.size > 100) {
        const firstKey = assistantCache.keys().next().value
        assistantCache.delete(firstKey)
    }

    console.log(`[FIRESTORE] getAssistant: ${Date.now() - startTime}ms`)
    return assistant
}

// Batch fetch for better performance
async function batchFetchDocuments(docPaths) {
    const startTime = Date.now()
    const db = getFirestore()

    const refs = docPaths.map(path => db.doc(path))
    const docs = await db.getAll(...refs)

    console.log(`[FIRESTORE] batchFetch (${docPaths.length} docs): ${Date.now() - startTime}ms`)
    return docs.map(doc => ({ id: doc.id, ...doc.data() }))
}

module.exports = {
    getFirestore,
    getUserDataOptimized,
    getAssistantForChatOptimized,
    batchFetchDocuments,
}
