const admin = require('firebase-admin')
const { hashRoutingToken } = require('./whatsAppCallSecurity')

const FINAL_STATUSES = new Set(['completed', 'failed', 'rejected', 'stale', 'cancelled'])

function getSessionRef(sessionId) {
    return admin.firestore().doc(`whatsAppCallSessions/${sessionId}`)
}

function getLockRef(userId) {
    return admin.firestore().doc(`whatsAppCallLocks/${userId}`)
}

function getRouteRef(routeId) {
    return admin.firestore().doc(`whatsAppCallRoutes/${routeId}`)
}

async function createCallSessionWithLease({
    sessionId,
    routingToken,
    routingSecret,
    routeExpiresAt,
    leaseExpiresAt,
    sessionExpiresAt = leaseExpiresAt,
    userId,
    projectId,
    assistantId,
    chatId,
    twilioCallSid,
}) {
    const now = Date.now()
    const routeId = hashRoutingToken(routingToken, routingSecret)
    const sessionRef = getSessionRef(sessionId)
    const lockRef = getLockRef(userId)
    const routeRef = getRouteRef(routeId)
    let result = { success: false, reason: 'active_call' }

    await admin.firestore().runTransaction(async transaction => {
        const [lockDoc, sessionDoc] = await Promise.all([transaction.get(lockRef), transaction.get(sessionRef)])
        const lockData = lockDoc.exists ? lockDoc.data() || {} : {}
        if (lockDoc.exists && Number(lockData.expiresAt || 0) > now && lockData.sessionId !== sessionId) return

        if (sessionDoc.exists) {
            const session = sessionDoc.data() || {}
            result =
                session.status === 'routing' && lockData.sessionId === sessionId
                    ? { success: true, duplicate: true, routeId }
                    : { success: false, reason: 'active_call' }
            return
        }

        transaction.set(lockRef, { userId, sessionId, createdAt: now, updatedAt: now, expiresAt: leaseExpiresAt })
        transaction.set(routeRef, {
            routeId,
            sessionId,
            createdAt: now,
            expiresAt: routeExpiresAt,
            consumedAt: null,
        })
        transaction.set(sessionRef, {
            id: sessionId,
            userId,
            projectId,
            assistantId,
            chatId,
            twilioCallSid,
            routingId: routeId,
            openAiCallId: null,
            status: 'routing',
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            endedAt: null,
            expiresAt: sessionExpiresAt,
            totalTokens: 0,
            billedGold: 0,
            transcriptTurnCount: 0,
            completionReason: null,
            recapStatus: 'pending',
        })
        result = { success: true, duplicate: false, routeId }
    })

    return result
}

async function consumeRoutingToken({ routingToken, routingSecret, openAiCallId }) {
    const routeId = hashRoutingToken(routingToken, routingSecret)
    const routeRef = getRouteRef(routeId)
    const now = Date.now()
    let result = { success: false, reason: 'invalid_route' }

    await admin.firestore().runTransaction(async transaction => {
        const routeDoc = await transaction.get(routeRef)
        if (!routeDoc.exists) return
        const route = routeDoc.data() || {}
        if (route.consumedAt) {
            if (route.openAiCallId === openAiCallId) {
                const sessionDoc = await transaction.get(getSessionRef(route.sessionId))
                if (sessionDoc.exists) {
                    result = {
                        success: true,
                        duplicate: true,
                        sessionId: route.sessionId,
                        session: sessionDoc.data() || {},
                    }
                    return
                }
            }
            result = { success: false, reason: 'replayed_route' }
            return
        }
        if (Number(route.expiresAt || 0) <= now) {
            result = { success: false, reason: 'expired_route' }
            return
        }

        const sessionRef = getSessionRef(route.sessionId)
        const sessionDoc = await transaction.get(sessionRef)
        if (!sessionDoc.exists) return

        transaction.update(routeRef, { consumedAt: now, openAiCallId })
        transaction.update(sessionRef, {
            openAiCallId,
            status: 'accepted',
            startedAt: now,
            updatedAt: now,
        })
        result = { success: true, sessionId: route.sessionId, session: sessionDoc.data() || {} }
    })

    return result
}

async function getCallSession(sessionId) {
    const doc = await getSessionRef(sessionId).get()
    return doc.exists ? { ...doc.data(), id: doc.id } : null
}

async function updateCallSession(sessionId, patch) {
    await getSessionRef(sessionId).set({ ...patch, updatedAt: Date.now() }, { merge: true })
}

async function finalizeCallSession(sessionId, completionReason, status = 'completed') {
    const sessionRef = getSessionRef(sessionId)
    const now = Date.now()
    let result = { success: false, session: null, alreadyFinal: false }

    await admin.firestore().runTransaction(async transaction => {
        const sessionDoc = await transaction.get(sessionRef)
        if (!sessionDoc.exists) return
        const session = sessionDoc.data() || {}
        const alreadyFinal = FINAL_STATUSES.has(session.status)
        const lockRef = session.userId ? getLockRef(session.userId) : null
        const routeRef = session.routingId ? getRouteRef(session.routingId) : null
        const lockDoc = lockRef ? await transaction.get(lockRef) : null

        if (!alreadyFinal) {
            transaction.update(sessionRef, {
                status,
                completionReason: completionReason || status,
                endedAt: now,
                updatedAt: now,
                durationMs: session.startedAt ? Math.max(0, now - Number(session.startedAt)) : null,
                expiresAt: null,
            })
        }
        if (lockDoc?.exists && lockDoc.data()?.sessionId === sessionId) {
            transaction.delete(lockRef)
        }
        if (routeRef) transaction.delete(routeRef)

        result = {
            success: true,
            alreadyFinal,
            session: {
                ...session,
                status: alreadyFinal ? session.status : status,
                completionReason: alreadyFinal ? session.completionReason : completionReason || status,
                endedAt: session.endedAt || now,
                expiresAt: alreadyFinal ? session.expiresAt : null,
                durationMs:
                    session.durationMs ??
                    (session.startedAt ? Math.max(0, (session.endedAt || now) - Number(session.startedAt)) : null),
            },
        }
    })

    return result
}

async function claimRecap(sessionId) {
    const ref = getSessionRef(sessionId)
    let claimed = false
    await admin.firestore().runTransaction(async transaction => {
        const doc = await transaction.get(ref)
        if (!doc.exists) return
        const status = doc.data()?.recapStatus || 'pending'
        const recapStartedAt = Number(doc.data()?.recapStartedAt || 0)
        const staleGeneratingClaim = status === 'generating' && Date.now() - recapStartedAt > 10 * 60 * 1000
        if (status !== 'pending' && status !== 'failed' && !staleGeneratingClaim) return
        transaction.update(ref, { recapStatus: 'generating', recapStartedAt: Date.now(), updatedAt: Date.now() })
        claimed = true
    })
    return claimed
}

async function cleanupExpiredCallSessions(limit = 100) {
    const now = Date.now()
    const snapshot = await admin
        .firestore()
        .collection('whatsAppCallSessions')
        .where('expiresAt', '<=', now)
        .limit(limit)
        .get()
    const cleanedSessionIds = []

    for (const doc of snapshot.docs) {
        if (FINAL_STATUSES.has(doc.data()?.status)) continue
        const result = await finalizeCallSession(doc.id, 'stale_session', 'stale')
        if (result.success) cleanedSessionIds.push(doc.id)
    }
    return cleanedSessionIds
}

module.exports = {
    FINAL_STATUSES,
    claimRecap,
    cleanupExpiredCallSessions,
    consumeRoutingToken,
    createCallSessionWithLease,
    finalizeCallSession,
    getCallSession,
    getSessionRef,
    updateCallSession,
}
