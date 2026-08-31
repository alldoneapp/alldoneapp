const admin = require('firebase-admin')
const { deleteUserRecord } = require('../AlgoliaGlobalSearchHelper')
const {
    deleteHeartbeatSchedulesForUser,
    safelySyncHeartbeatSchedules,
} = require('../Assistant/assistantHeartbeatSchedule')
const { FieldValue } = require('firebase-admin/firestore')

const processPremiumStatusPaidByOtherUser = async (userId, admin) => {
    const userSubscription = (await admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).get()).data()
    if (userSubscription) {
        const { userPayingId } = userSubscription
        const mainSubscription = (await admin.firestore().doc(`subscriptions/${userPayingId}`).get()).data()
        const promises = [admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).delete()]
        if (mainSubscription) {
            promises.push(
                admin
                    .firestore()
                    .doc(`subscriptions/${userPayingId}`)
                    .update({
                        activePaidUsersIds: FieldValue.arrayRemove(userId),
                        paidUsersIds: FieldValue.arrayRemove(userId),
                        selectedUserIds: FieldValue.arrayRemove(userId),
                    })
            )
        }
        await Promise.all(promises)
    }
}

const deleteUserDataFromAlldone = async (userId, admin) => {
    // Current Stripe subscriptions are canceled synchronously by deleteUserSecondGen before the
    // Firestore user document is removed. Keep only the local legacy sponsorship cleanup here.
    await processPremiumStatusPaidByOtherUser(userId, admin)
}

const onDeleteUser = async user => {
    const promises = []
    promises.push(deleteUserDataFromAlldone(user.uid, admin))
    promises.push(deleteUserRecord(user.uid, user))
    promises.push(
        safelySyncHeartbeatSchedules(() => deleteHeartbeatSchedulesForUser(user.uid), {
            source: 'user_deleted',
            userId: user.uid,
        })
    )
    await Promise.all(promises)
}

module.exports = { onDeleteUser, processPremiumStatusPaidByOtherUser }
