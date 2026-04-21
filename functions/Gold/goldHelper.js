const admin = require('firebase-admin')
const moment = require('moment')
const SendInBlueManager = require('../SendInBlueManager')

const { logEvent } = require('../GAnalytics/GAnalytics')
const { PLAN_STATUS_FREE, PLAN_STATUS_PREMIUM } = require('../Payment/premiumHelper')
const { applyGoldChange, applyGoldChangeInTransaction } = require('./goldTransactions')
const {
    getUsersByPremiumStatus,
    getLastActiveUsers,
    getUsersThatEarnedSomeGoldToday,
    updateUserDailyGold,
} = require('../Users/usersFirestore')
const { inProductionEnvironment } = require('../Utils/HelperFunctionsCloud')

function logGoldAnalytics(userId, eventName, amount, source, context = {}) {
    return logEvent(userId, eventName, {
        amount,
        userId,
        source,
        ...context,
    })
}

function getProjectIdsFromUserData(userData = {}) {
    const projectIds = new Set()

    ;['projectIds', 'guideProjectIds', 'templateProjectIds', 'archivedProjectIds'].forEach(key => {
        const ids = userData?.[key]
        if (!Array.isArray(ids)) return

        ids.forEach(id => {
            if (typeof id === 'string' && id.trim()) projectIds.add(id.trim())
        })
    })

    return projectIds
}

const addMonthlyPrmiumGoldToUsers = async () => {
    const users = await getUsersByPremiumStatus(PLAN_STATUS_PREMIUM, false)

    const promises = []
    users.forEach(user => {
        promises.push(addMonthlyGoldToUser(user, true))
    })
    await Promise.all(promises)
}

const addMonthlyGoldToFreeUsers = async () => {
    const users = await getUsersByPremiumStatus(PLAN_STATUS_FREE, false)

    let promises = []
    for (let i = 0; i < users.length; i++) {
        if (promises.length > 500) {
            await Promise.all(promises)
            promises = []
        }
        const user = users[i]
        promises.push(addMonthlyGoldToUser(user, false))
    }
    await Promise.all(promises)
}

const addMonthlyGoldToAllUsers = async () => {
    const maxAmountOfUser = 150
    const users = await getLastActiveUsers(maxAmountOfUser)

    let promises = []
    for (let i = 0; i < users.length; i++) {
        if (promises.length > 500) {
            await Promise.all(promises)
            promises = []
        }
        const user = users[i]
        promises.push(addMonthlyGoldToUser(user, user.premium ? user.premium.status === PLAN_STATUS_PREMIUM : false))
    }
    await Promise.all(promises)
}

const addMonthlyGoldToUser = async (user, premiumUser) => {
    const { email: userEmail, displayName, photoURL, notificationEmail, receiveEmails } = user
    const email = notificationEmail ? notificationEmail : userEmail

    const PREMIUM_GOLD_AMOUNT = premiumUser ? 1000 : 100
    const source = 'monthly_gold'

    const promises = []
    promises.push(
        applyGoldChange({
            userId: user.uid,
            delta: PREMIUM_GOLD_AMOUNT,
            direction: 'earn',
            source,
        })
    )
    promises.push(logGoldAnalytics(user.uid, 'earn_gold', PREMIUM_GOLD_AMOUNT, source))

    if (receiveEmails && email && email !== 'alldoneapp@exdream.com') {
        const mailData = {
            userEmail: email,
            userName: displayName.split(' ')[0],
            userPhotoURL: photoURL,
            date: moment().format('DD.MM.YYYY HH:mm'),
        }

        if (inProductionEnvironment())
            promises.push(
                premiumUser
                    ? SendInBlueManager.sendMonthlyPremiumGoldNotification(mailData)
                    : SendInBlueManager.sendMonthlyFreeGoldNotification(mailData)
            )
    }

    await Promise.all(promises)
}

const earnGold = async (projectId, userId, gold, slimDate, timestamp, dayDate, context = {}) => {
    const userRef = admin.firestore().doc(`users/${userId}`)
    const statisticsRef = admin.firestore().doc(`statistics/${projectId}/${userId}/${slimDate}`)
    const rewardKey = typeof context.rewardKey === 'string' && context.rewardKey.trim() ? context.rewardKey.trim() : ''
    const rewardRef = rewardKey ? userRef.collection('goldRewardClaims').doc(rewardKey) : null
    let result = { success: false, message: 'User not found' }

    console.log('[gold][server] earnGold requested', {
        projectId,
        userId,
        requestedGold: Number(gold) || 0,
        slimDate,
        timestamp,
        dayDate,
        rewardKey,
        objectId: context.objectId || '',
        objectType: context.objectType || '',
    })

    await admin.firestore().runTransaction(async transaction => {
        const userDoc = await transaction.get(userRef)

        if (!userDoc.exists) {
            console.warn('[gold][server] earnGold aborted because user was not found', {
                projectId,
                userId,
                rewardKey,
            })
            result = { success: false, message: 'User not found' }
            return
        }

        const userData = userDoc.data() || {}
        const accessibleProjectIds = getProjectIdsFromUserData(userData)

        console.log('[gold][server] Loaded user gold state', {
            projectId,
            userId,
            currentGold: Number(userData.gold) || 0,
            dailyGold: Number(userData.dailyGold) || 0,
            rewardKey,
            projectAccessCount: accessibleProjectIds.size,
        })

        if (projectId && accessibleProjectIds.size > 0 && !accessibleProjectIds.has(projectId)) {
            console.warn('[gold][server] earnGold aborted because user has no access to project', {
                projectId,
                userId,
                rewardKey,
            })
            result = {
                success: false,
                message: 'User has no access to project',
                currentGold: Number(userData.gold) || 0,
            }
            return
        }

        if (rewardRef) {
            const rewardDoc = await transaction.get(rewardRef)
            if (rewardDoc.exists) {
                console.log('[gold][server] Duplicate reward key detected, returning previous result', {
                    projectId,
                    userId,
                    rewardKey,
                    previousAmount: rewardDoc.data()?.amount || 0,
                    previousStatus: rewardDoc.data()?.status || '',
                })
                result = { success: true, alreadyProcessed: true, amount: rewardDoc.data()?.amount || 0 }
                return
            }
        }

        const dailyGold = Number(userData.dailyGold) || 0
        const goldToIncrease = Math.min(Number(gold) || 0, dailyGold)

        console.log('[gold][server] Computed earnGold amount', {
            projectId,
            userId,
            rewardKey,
            requestedGold: Number(gold) || 0,
            dailyGold,
            goldToIncrease,
        })

        if (goldToIncrease <= 0) {
            if (rewardRef) {
                transaction.set(rewardRef, {
                    amount: 0,
                    projectId,
                    objectId: context.objectId || '',
                    objectType: context.objectType || '',
                    status: 'skipped_no_daily_gold',
                    timestamp,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                })
            }
            console.log('[gold][server] earnGold skipped because no daily gold remained', {
                projectId,
                userId,
                rewardKey,
                currentGold: Number(userData.gold) || 0,
            })
            result = { success: false, message: 'No daily gold left', currentGold: Number(userData.gold) || 0 }
            return
        }

        result = applyGoldChangeInTransaction({
            transaction,
            userRef,
            userData,
            delta: goldToIncrease,
            direction: 'earn',
            source: 'task_completion',
            context: {
                projectId,
                objectId: context.objectId || '',
                objectType: context.objectType || '',
            },
            additionalUserFields: { dailyGold: dailyGold - goldToIncrease },
        })

        if (!result.success) {
            console.warn('[gold][server] applyGoldChangeInTransaction failed', {
                projectId,
                userId,
                rewardKey,
                message: result.message || '',
                currentGold: result.currentGold,
            })
            return
        }

        if (rewardRef) {
            transaction.set(rewardRef, {
                amount: goldToIncrease,
                entryId: result.entryId,
                projectId,
                objectId: context.objectId || '',
                objectType: context.objectType || '',
                status: 'processed',
                timestamp,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })
        }

        console.log('[gold][server] Applied task reward transaction', {
            projectId,
            userId,
            rewardKey,
            amount: goldToIncrease,
            previousBalance: result.previousBalance,
            newBalance: result.newBalance,
            remainingDailyGold: dailyGold - goldToIncrease,
            entryId: result.entryId,
        })

        transaction.set(
            statisticsRef,
            {
                gold: admin.firestore.FieldValue.increment(goldToIncrease),
                timestamp,
                day: dayDate,
            },
            { merge: true }
        )
    })

    if (result.success && !result.alreadyProcessed && result.amount > 0) {
        console.log('[gold][server] Logging analytics for successful task reward', {
            projectId,
            userId,
            rewardKey,
            amount: result.amount,
        })
        await logGoldAnalytics(userId, 'earn_gold', result.amount, 'task_completion', { projectId })
    }

    console.log('[gold][server] earnGold completed', {
        projectId,
        userId,
        rewardKey,
        success: !!result.success,
        alreadyProcessed: !!result.alreadyProcessed,
        amount: result.amount || 0,
        message: result.message || '',
        currentGold: result.currentGold,
        newBalance: result.newBalance,
    })

    return result
}

const resetDailyGoldLimit = async () => {
    const DAILY_GOLD_LIMIT = 100
    const userDocs = await getUsersThatEarnedSomeGoldToday(true)

    const promises = []
    userDocs.forEach(doc => {
        promises.push(updateUserDailyGold(doc.id, DAILY_GOLD_LIMIT))
    })
    await Promise.all(promises)
}

const deductGold = async (userId, gold, context = {}) => {
    const source = context.source || 'unknown_spend'
    const result = await applyGoldChange({
        userId,
        delta: -gold,
        direction: 'spend',
        source,
        context,
        requireSufficientBalance: true,
    })

    if (result.success) {
        await logGoldAnalytics(userId, 'spend_gold', result.amount, source, context)
    }

    return result
}

const refundGold = async (userId, gold, context = {}) => {
    console.log('refundGold: starting refund', { userId, gold, source: context.source || 'manual_refund' })

    const source = context.source || 'manual_refund'
    const result = await applyGoldChange({
        userId,
        delta: gold,
        direction: 'refund',
        source,
        context,
    })

    if (result.success) {
        await logGoldAnalytics(userId, 'refund_gold', result.amount, source, context)
    }

    return result
}

const adjustGold = async (userId, delta, context = {}) => {
    const source = context.source || 'admin_adjustment'
    const result = await applyGoldChange({
        userId,
        delta,
        direction: 'adjustment',
        source,
        context,
        requireSufficientBalance: delta < 0,
    })

    if (result.success) {
        await logGoldAnalytics(userId, 'adjust_gold', result.amount, source, context)
    }

    return result
}

module.exports = {
    addMonthlyGoldToUser,
    addMonthlyGoldToAllUsers,
    adjustGold,
    applyGoldChange,
    applyGoldChangeInTransaction,
    earnGold,
    resetDailyGoldLimit,
    deductGold,
    refundGold,
}
