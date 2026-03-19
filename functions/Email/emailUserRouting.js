'use strict'

const admin = require('firebase-admin')

const { normalizeEmailAddress } = require('./emailChannelHelpers')

async function findVerifiedUserByPrimaryEmail(email) {
    const normalizedEmail = normalizeEmailAddress(email)
    if (!normalizedEmail) return null

    const snapshot = await admin.firestore().collection('users').where('email', '==', normalizedEmail).limit(5).get()
    if (snapshot.empty) return null

    const verifiedMatches = []
    for (const doc of snapshot.docs) {
        try {
            const userRecord = await admin.auth().getUser(doc.id)
            const authEmail = normalizeEmailAddress(userRecord.email)
            if (userRecord.emailVerified === true && authEmail === normalizedEmail) {
                verifiedMatches.push({
                    uid: doc.id,
                    ...doc.data(),
                })
            }
        } catch (error) {
            console.warn('Email Channel: Failed verifying auth user for sender routing', {
                userId: doc.id,
                error: error.message,
            })
        }
    }

    if (verifiedMatches.length !== 1) {
        return null
    }

    return verifiedMatches[0]
}

async function getDefaultAssistantIdForUser(user, projectId) {
    const db = admin.firestore()
    const normalizedProjectId = String(projectId || '').trim()
    const userDefaultAssistantId = typeof user?.defaultAssistantId === 'string' ? user.defaultAssistantId.trim() : ''

    if (!normalizedProjectId) return null

    const assistantExistsInProjectOrGlobal = async assistantId => {
        if (!assistantId) return false
        const [projectAssistantDoc, globalAssistantDoc] = await db.getAll(
            db.doc(`assistants/${normalizedProjectId}/items/${assistantId}`),
            db.doc(`assistants/globalProject/items/${assistantId}`)
        )
        return projectAssistantDoc.exists || globalAssistantDoc.exists
    }

    try {
        const projectDoc = await db.doc(`projects/${normalizedProjectId}`).get()
        const projectAssistantId = projectDoc.exists ? String(projectDoc.data()?.assistantId || '').trim() : ''
        if (projectAssistantId && (await assistantExistsInProjectOrGlobal(projectAssistantId))) {
            return projectAssistantId
        }
    } catch (error) {
        console.warn('Email Channel: Could not resolve project assistant', { error: error.message })
    }

    if (userDefaultAssistantId) {
        try {
            if (await assistantExistsInProjectOrGlobal(userDefaultAssistantId)) {
                return userDefaultAssistantId
            }
        } catch (error) {
            console.warn('Email Channel: Could not validate user default assistant', { error: error.message })
        }
    }

    try {
        const snapshot = await db.collection(`assistants/${normalizedProjectId}/items`).limit(1).get()
        if (!snapshot.empty) return snapshot.docs[0].id
    } catch (error) {
        console.warn('Email Channel: Could not find assistant in project', { error: error.message })
    }

    try {
        const globalDefaultAssistant = await db.doc('assistants/globalProject').get()
        const defaultAssistant = globalDefaultAssistant.exists ? globalDefaultAssistant.data() : null
        return defaultAssistant?.uid || null
    } catch (error) {
        console.warn('Email Channel: Could not fetch global default assistant', { error: error.message })
    }

    return null
}

module.exports = {
    findVerifiedUserByPrimaryEmail,
    getDefaultAssistantIdForUser,
}
