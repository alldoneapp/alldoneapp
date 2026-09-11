const crypto = require('crypto')
const admin = require('firebase-admin')
const { applyGoldChangeInTransaction } = require('../Gold/goldTransactions')
const { calculateLiveVoiceGold } = require('./assistantLivePricing')

// Voice updates are cumulative snapshots. Backend rounds are independent usage
// records. Both settle atomically with the Gold ledger and their deduplication state.
async function reconcileLiveUsage({ sessionId, seconds, final = false, backend = null }) {
    const db = admin.firestore()
    const ref = db.doc(`whatsAppCallSessions/${sessionId}`)
    return db.runTransaction(async transaction => {
        const doc = await transaction.get(ref)
        if (!doc.exists || doc.data().voiceProvider !== 'gpt-live') throw new Error('Live session not found')
        const session = doc.data()
        const userRef = db.doc(`users/${session.userId}`)
        const userDoc = await transaction.get(userRef)
        if (!userDoc.exists) throw new Error('Call user not found')
        const user = userDoc.data()
        let markerRef
        let charge
        let fields
        if (backend) {
            if (
                !backend.id ||
                !backend.model ||
                !Number.isFinite(backend.tokens) ||
                backend.tokens < 0 ||
                !(backend.tokensPerGold > 0)
            ) {
                throw new Error('Invalid assistant usage')
            }
            markerRef = ref.collection('usageEvents').doc(crypto.createHash('sha256').update(backend.id).digest('hex'))
            const marker = await transaction.get(markerRef)
            if (marker.exists) return { duplicate: true, chargedGold: 0, currentGold: user.gold }
            charge = Math.round(backend.tokens / backend.tokensPerGold)
            fields = {
                backendBilledGold: Number(session.backendBilledGold || 0),
                backendTokens: Number(session.backendTokens || 0) + backend.tokens,
            }
        } else {
            if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid voice duration')
            const nextSeconds = Math.max(Number(session.voiceSeconds || 0), seconds)
            charge = Math.max(
                0,
                calculateLiveVoiceGold(nextSeconds, session.voiceGoldPerMinute) - Number(session.voiceBilledGold || 0)
            )
            fields = {
                voiceSeconds: nextSeconds,
                voiceBilledGold: Number(session.voiceBilledGold || 0),
                voiceUsageFinal: final || session.voiceUsageFinal === true,
            }
        }
        const currentGold = Math.max(0, Number(user.gold) || 0)
        const chargedGold = Math.min(charge, currentGold)
        if (chargedGold > 0) {
            const result = applyGoldChangeInTransaction({
                transaction,
                userRef,
                userData: user,
                delta: -chargedGold,
                direction: 'spend',
                source: backend ? 'assistant_usage' : 'assistant_voice_duration',
                context: {
                    projectId: session.projectId,
                    objectId: session.chatId,
                    objectType: 'topics',
                    channel: 'browser_call',
                    callSessionId: sessionId,
                    model: backend ? backend.model : session.voiceModel,
                    note: backend ? 'Assistant reasoning during voice call' : 'GPT-Live connected voice duration',
                },
            })
            if (!result.success) throw new Error(result.message || 'Gold charge failed')
        }
        const billingField = backend ? 'backendBilledGold' : 'voiceBilledGold'
        fields[billingField] += chargedGold
        transaction.update(ref, {
            ...fields,
            billedGold: Number(session.billedGold || 0) + chargedGold,
            updatedAt: Date.now(),
        })
        if (markerRef) transaction.set(markerRef, { ...backend, chargedGold, createdAt: Date.now() })
        return {
            chargedGold,
            insufficientBalance: chargedGold < charge,
            currentGold: currentGold - chargedGold,
            billedGold: Number(session.billedGold || 0) + chargedGold,
        }
    })
}

module.exports = { reconcileLiveUsage }
