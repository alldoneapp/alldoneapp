'use strict'

const admin = require('firebase-admin')

const { normalizeEmailAddress } = require('./emailChannelHelpers')

async function findVerifiedUserByEmailIdentity(email) {
    const normalizedEmail = normalizeEmailAddress(email)
    if (!normalizedEmail) return null

    const candidateUsersById = new Map()

    const primaryMatches = await findVerifiedUsersByPrimaryEmail(normalizedEmail)
    primaryMatches.forEach(user => candidateUsersById.set(user.uid, user))

    const connectedMatches = await findUsersByConnectedGmailEmail(normalizedEmail)
    connectedMatches.forEach(user => {
        if (!candidateUsersById.has(user.uid)) candidateUsersById.set(user.uid, user)
    })

    if (candidateUsersById.size !== 1) {
        return null
    }

    return Array.from(candidateUsersById.values())[0]
}

async function findVerifiedUsersByPrimaryEmail(normalizedEmail) {
    const snapshot = await admin.firestore().collection('users').where('email', '==', normalizedEmail).limit(5).get()
    if (snapshot.empty) return []

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

    return verifiedMatches
}

async function findUsersByConnectedGmailEmail(normalizedEmail) {
    const snapshot = await admin
        .firestore()
        .collectionGroup('private')
        .where('email', '==', normalizedEmail)
        .limit(20)
        .get()

    if (snapshot.empty) return []

    const usersById = new Map()

    for (const doc of snapshot.docs) {
        const data = doc.data() || {}
        if (String(data.service || '').trim() !== 'gmail') continue

        const userRef = doc.ref?.parent?.parent
        const userId = String(userRef?.id || '').trim()
        if (!userId || usersById.has(userId)) continue

        try {
            const userDoc = await userRef.get()
            if (!userDoc.exists) continue

            const userData = userDoc.data() || {}
            if (!hasActiveConnectedGmailEmail(userData, normalizedEmail)) continue

            usersById.set(userId, {
                uid: userId,
                ...userData,
            })
        } catch (error) {
            console.warn('Email Channel: Failed resolving connected Gmail user for sender routing', {
                userId,
                error: error.message,
            })
        }
    }

    return Array.from(usersById.values())
}

function hasActiveConnectedGmailEmail(userData = {}, normalizedEmail = '') {
    const apisConnected = userData?.apisConnected || {}
    return Object.values(apisConnected).some(connection => {
        if (!connection?.gmail) return false
        return normalizeEmailAddress(connection.gmailEmail || '') === normalizedEmail
    })
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
    findVerifiedUserByEmailIdentity,
    getDefaultAssistantIdForUser,
    hasActiveConnectedGmailEmail,
}
