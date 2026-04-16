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

const earnGold = async (projectId, userId, gold, slimDate, timestamp, dayDate) => {
    const userRef = admin.firestore().doc(`users/${userId}`)
    const statisticsRef = admin.firestore().doc(`statistics/${projectId}/${userId}/${slimDate}`)
    let result = { success: false, message: 'User not found' }

    await admin.firestore().runTransaction(async transaction => {
        const userDoc = await transaction.get(userRef)

        if (!userDoc.exists) {
            result = { success: false, message: 'User not found' }
            return
        }

        const userData = userDoc.data() || {}
        const dailyGold = Number(userData.dailyGold) || 0
        const goldToIncrease = Math.min(Number(gold) || 0, dailyGold)

        if (goldToIncrease <= 0) {
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
            context: { projectId },
            additionalUserFields: { dailyGold: dailyGold - goldToIncrease },
        })

        if (!result.success) return

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

    if (result.success) {
        await logGoldAnalytics(userId, 'earn_gold', result.amount, 'task_completion', { projectId })
    }

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
