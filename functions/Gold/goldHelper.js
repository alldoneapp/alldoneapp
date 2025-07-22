const moment = require('moment')
const SendInBlueManager = require('../SendInBlueManager')

const { logEvent } = require('../GAnalytics/GAnalytics')
const { PLAN_STATUS_FREE, PLAN_STATUS_PREMIUM } = require('../Payment/premiumHelper')
const {
    adGoldToUser,
    getUsersByPremiumStatus,
    getLastActiveUsers,
    getUserData,
    getUsersThatEarnedSomeGoldToday,
    updateUserDailyGold,
} = require('../Users/usersFirestore')
const { inProductionEnvironment } = require('../Utils/HelperFunctionsCloud')

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

    const promises = []
    promises.push(adGoldToUser(user.uid, PREMIUM_GOLD_AMOUNT))
    promises.push(
        logEvent(user.uid, 'earn_gold', {
            amount: PREMIUM_GOLD_AMOUNT,
            userId: user.uid,
        })
    )

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

const earnGold = async (projectId, userId, gold, slimDate, timestamp, dayDate, admin) => {
    const user = await getUserData(userId)
    if (user) {
        const { dailyGold } = user

        const goldToIncrease = gold > dailyGold ? dailyGold : gold

        if (goldToIncrease > 0) {
            const promises = []
            promises.push(
                admin
                    .firestore()
                    .doc(`users/${userId}`)
                    .set(
                        {
                            gold: admin.firestore.FieldValue.increment(goldToIncrease),
                            dailyGold: admin.firestore.FieldValue.increment(-goldToIncrease),
                        },
                        { merge: true }
                    )
            )
            promises.push(
                admin
                    .firestore()
                    .doc(`statistics/${projectId}/${userId}/${slimDate}`)
                    .set(
                        {
                            gold: admin.firestore.FieldValue.increment(goldToIncrease),
                            timestamp,
                            day: dayDate,
                        },
                        { merge: true }
                    )
            )
            promises.push(
                logEvent(userId, 'earn_gold', {
                    amount: goldToIncrease,
                    userId: userId,
                })
            )
            await Promise.all(promises)
        }
    }
}

const resetDailyGoldLimit = async () => {
    const DAILY_GOLD_LIMIT = 150
    const userDocs = await getUsersThatEarnedSomeGoldToday(true)

    const promises = []
    userDocs.forEach(doc => {
        promises.push(updateUserDailyGold(doc.id, DAILY_GOLD_LIMIT))
    })
    await Promise.all(promises)
}

module.exports = {
    addMonthlyGoldToUser,
    addMonthlyGoldToAllUsers,
    earnGold,
    resetDailyGoldLimit,
}
