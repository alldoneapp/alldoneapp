const admin = require('firebase-admin')

const GOLD_CONTEXT_FIELDS = ['projectId', 'goalId', 'objectId', 'channel', 'note']

function sanitizeContext(context = {}) {
    const sanitized = {}

    GOLD_CONTEXT_FIELDS.forEach(field => {
        const value = context[field]

        if (typeof value === 'string' && value.trim()) {
            sanitized[field] = value.trim()
        }
    })

    return sanitized
}

function buildGoldTransaction({ amount, direction, source, balanceBefore, balanceAfter, context = {} }) {
    return {
        amount,
        direction,
        source,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        balanceBefore,
        balanceAfter,
        ...sanitizeContext(context),
    }
}

function applyGoldChangeInTransaction({
    transaction,
    userRef,
    userData = {},
    delta,
    direction,
    source,
    context = {},
    requireSufficientBalance = false,
    additionalUserFields = {},
}) {
    const normalizedDelta = Number(delta)
    const currentGold = Number(userData.gold) || 0

    if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
        return { success: false, message: 'Invalid gold amount', currentGold }
    }

    const amount = Math.abs(normalizedDelta)
    const newBalance = currentGold + normalizedDelta

    if (requireSufficientBalance && currentGold < amount) {
        return { success: false, message: 'Insufficient gold', currentGold }
    }

    if (newBalance < 0) {
        return { success: false, message: 'Insufficient gold', currentGold }
    }

    const goldTransactionsRef = userRef.collection('goldTransactions').doc()

    transaction.set(
        userRef,
        {
            gold: newBalance,
            ...additionalUserFields,
        },
        { merge: true }
    )
    transaction.set(
        goldTransactionsRef,
        buildGoldTransaction({
            amount,
            direction,
            source,
            balanceBefore: currentGold,
            balanceAfter: newBalance,
            context,
        })
    )

    return {
        success: true,
        previousBalance: currentGold,
        newBalance,
        amount,
        entryId: goldTransactionsRef.id,
    }
}

async function applyGoldChange({
    userId,
    delta,
    direction,
    source,
    context = {},
    requireSufficientBalance = false,
    additionalUserFields = {},
    onTransaction,
}) {
    const userRef = admin.firestore().doc(`users/${userId}`)
    let result = { success: false, message: 'User not found' }

    await admin.firestore().runTransaction(async transaction => {
        const userDoc = await transaction.get(userRef)

        if (!userDoc.exists) {
            result = { success: false, message: 'User not found' }
            return
        }

        const userData = userDoc.data() || {}

        result = applyGoldChangeInTransaction({
            transaction,
            userRef,
            userData,
            delta,
            direction,
            source,
            context,
            requireSufficientBalance,
            additionalUserFields,
        })

        if (result.success && onTransaction) {
            await onTransaction({
                transaction,
                userRef,
                userData,
                previousBalance: result.previousBalance,
                newBalance: result.newBalance,
                amount: result.amount,
                entryId: result.entryId,
            })
        }
    })

    return result
}

module.exports = {
    applyGoldChange,
    applyGoldChangeInTransaction,
}
