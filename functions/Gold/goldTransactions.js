const admin = require('firebase-admin')
const crypto = require('crypto')
const { FieldValue } = require('firebase-admin/firestore')

const GOLD_CONTEXT_FIELDS = [
    'projectId',
    'goalId',
    'objectId',
    'objectType',
    'channel',
    'note',
    'callSessionId',
    // Billing dimensions (AT-2487). `model` is the pricing key the charge was computed
    // with, stored verbatim so the exact value survives even though the rollup slugs it.
    // `correlationId` is the VM run id: the ledger previously carried nothing that could
    // be joined back to `vmJobs`, which is why answering "was this spend token-billed?"
    // needed a manual, approximate match on projectId + objectId + timestamp.
    'model',
    'correlationId',
]

// Booleans need their own list because the string sanitizer below drops everything that is
// not a non-empty string. `billingExempt` is a tristate — true / false / absent — and the
// absent case is load-bearing (see goldDimensions.js), so it is persisted only when the
// caller passes an actual boolean. An `undefined` from a charge site that has no concept of
// billing exemption must never be written as `false`.
const GOLD_CONTEXT_BOOLEAN_FIELDS = ['billingExempt']

function sanitizeContext(context = {}) {
    const sanitized = {}

    GOLD_CONTEXT_FIELDS.forEach(field => {
        const value = context[field]

        if (typeof value === 'string' && value.trim()) {
            sanitized[field] = value.trim()
        }
    })

    GOLD_CONTEXT_BOOLEAN_FIELDS.forEach(field => {
        const value = context[field]

        if (typeof value === 'boolean') {
            sanitized[field] = value
        }
    })

    return sanitized
}

function buildGoldTransaction({ amount, direction, source, balanceBefore, balanceAfter, context = {} }) {
    return {
        amount,
        direction,
        source,
        createdAt: FieldValue.serverTimestamp(),
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
    idempotencyKey = '',
}) {
    const userRef = admin.firestore().doc(`users/${userId}`)
    const normalizedIdempotencyKey =
        typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim() : ''
    const claimRef = normalizedIdempotencyKey
        ? userRef
              .collection('goldChangeClaims')
              .doc(crypto.createHash('sha256').update(normalizedIdempotencyKey).digest('hex'))
        : null
    let result = { success: false, message: 'User not found' }

    await admin.firestore().runTransaction(async transaction => {
        const [userDoc, claimDoc] = await Promise.all([
            transaction.get(userRef),
            claimRef ? transaction.get(claimRef) : Promise.resolve(null),
        ])

        if (!userDoc.exists) {
            result = { success: false, message: 'User not found' }
            return
        }

        if (claimDoc?.exists) {
            const claim = claimDoc.data() || {}
            result = {
                success: true,
                alreadyProcessed: true,
                previousBalance: claim.previousBalance,
                newBalance: claim.newBalance,
                amount: claim.amount,
                entryId: claim.entryId,
            }
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

        if (result.success && claimRef) {
            transaction.set(claimRef, {
                idempotencyKey: normalizedIdempotencyKey,
                amount: result.amount,
                direction,
                source,
                previousBalance: result.previousBalance,
                newBalance: result.newBalance,
                entryId: result.entryId,
                createdAt: FieldValue.serverTimestamp(),
            })
        }
    })

    return result
}

module.exports = {
    GOLD_CONTEXT_FIELDS,
    GOLD_CONTEXT_BOOLEAN_FIELDS,
    sanitizeContext,
    applyGoldChange,
    applyGoldChangeInTransaction,
}
