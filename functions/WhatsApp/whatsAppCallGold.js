const crypto = require('crypto')
const admin = require('firebase-admin')
const { applyGoldChangeInTransaction } = require('../Gold/goldTransactions')

const TOKENS_PER_GOLD = 100

function calculateCallGold(totalTokens) {
    const normalizedTokens = Math.max(0, Number(totalTokens) || 0)
    return normalizedTokens > 0 ? Math.max(1, Math.round(normalizedTokens / TOKENS_PER_GOLD)) : 0
}

function getUsageMarkerId(eventId) {
    return crypto
        .createHash('sha256')
        .update(String(eventId || ''))
        .digest('hex')
        .slice(0, 40)
}

async function reconcileCallUsage({ sessionId, eventId, totalTokens }) {
    const normalizedTokens = Math.max(0, Math.round(Number(totalTokens) || 0))
    if (!eventId || normalizedTokens <= 0) return { success: true, skipped: true, chargedGold: 0 }

    const db = admin.firestore()
    const sessionRef = db.doc(`whatsAppCallSessions/${sessionId}`)
    const markerRef = sessionRef.collection('usageEvents').doc(getUsageMarkerId(eventId))
    let result = { success: false, reason: 'session_not_found' }

    await db.runTransaction(async transaction => {
        const sessionDoc = await transaction.get(sessionRef)
        if (!sessionDoc.exists) return
        const session = sessionDoc.data() || {}
        const userRef = db.doc(`users/${session.userId}`)
        const [markerDoc, userDoc] = await Promise.all([transaction.get(markerRef), transaction.get(userRef)])

        if (markerDoc.exists) {
            result = {
                success: true,
                duplicate: true,
                chargedGold: 0,
                insufficientBalance: false,
                totalTokens: Number(session.totalTokens) || 0,
                billedGold: Number(session.billedGold) || 0,
            }
            return
        }
        if (!userDoc.exists) {
            result = { success: false, reason: 'user_not_found' }
            return
        }

        const previousTotalTokens = Number(session.totalTokens) || 0
        const previousBilledGold = Number(session.billedGold) || 0
        const nextTotalTokens = previousTotalTokens + normalizedTokens
        const targetGold = calculateCallGold(nextTotalTokens)
        const dueGold = Math.max(0, targetGold - previousBilledGold)
        const currentGold = Math.max(0, Number(userDoc.data()?.gold) || 0)
        const chargedGold = Math.min(dueGold, currentGold)
        const insufficientBalance = chargedGold < dueGold

        if (chargedGold > 0) {
            const goldResult = applyGoldChangeInTransaction({
                transaction,
                userRef,
                userData: userDoc.data() || {},
                delta: -chargedGold,
                direction: 'spend',
                source: 'whatsapp_call',
                context: {
                    channel: 'whatsapp',
                    projectId: session.projectId,
                    objectId: session.chatId,
                    objectType: 'topics',
                    callSessionId: sessionId,
                    note: 'WhatsApp assistant call',
                },
            })
            if (!goldResult.success) {
                result = { success: false, reason: goldResult.message || 'gold_charge_failed' }
                return
            }
        }

        transaction.set(markerRef, {
            eventIdHash: getUsageMarkerId(eventId),
            tokens: normalizedTokens,
            chargedGold,
            createdAt: Date.now(),
        })
        transaction.update(sessionRef, {
            totalTokens: nextTotalTokens,
            billedGold: previousBilledGold + chargedGold,
            updatedAt: Date.now(),
        })
        result = {
            success: true,
            duplicate: false,
            chargedGold,
            insufficientBalance,
            totalTokens: nextTotalTokens,
            billedGold: previousBilledGold + chargedGold,
            currentGold: currentGold - chargedGold,
        }
    })

    return result
}

module.exports = {
    TOKENS_PER_GOLD,
    calculateCallGold,
    reconcileCallUsage,
}
