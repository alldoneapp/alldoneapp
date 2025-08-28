const admin = require('firebase-admin')
const { deleteUserRecord } = require('../AlgoliaGlobalSearchHelper')
const { cancelSubscription } = require('../Payment/CancelSubscriptions')
const { SUBSCRIPTION_STATUS_CANCELED } = require('../Payment/Mollie')
const { removePaidUsersFromSubscription } = require('../Payment/SubscriptionsActions')

const processPremiumStatusPaidByOtherUser = async (userId, admin, superAdmin) => {
    const userSubscription = (await admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).get()).data()
    if (userSubscription) {
        const { userPayingId } = userSubscription
        if (userSubscription.canceled) await removePaidUsersFromSubscription(userPayingId, [userId])
        const mainSubscription = (await admin.firestore().doc(`subscriptions/${userPayingId}`).get()).data()
        if (mainSubscription) {
            const promises = []
            promises.push(
                admin
                    .firestore()
                    .doc(`subscriptions/${userPayingId}`)
                    .update({
                        activePaidUsersIds: superAdmin.firestore.FieldValue.arrayRemove(userId),
                        paidUsersIds: superAdmin.firestore.FieldValue.arrayRemove(userId),
                        selectedUserIds: superAdmin.firestore.FieldValue.arrayRemove(userId),
                    })
            )
            promises.push(admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).delete())
            await Promise.all(promises)
        }
    }
}

const processPremiumStatusPaidByTheUser = async (userId, admin) => {
    const subscription = (await admin.firestore().doc(`subscriptions/${userId}`).get()).data()
    if (subscription && subscription.status !== SUBSCRIPTION_STATUS_CANCELED) {
        await cancelSubscription(userId)
    }
}

const deleteUserDataFromAlldone = async (userId, admin, superAdmin) => {
    const promises = []
    promises.push(processPremiumStatusPaidByOtherUser(userId, admin, superAdmin))
    promises.push(processPremiumStatusPaidByTheUser(userId, admin))
    await Promise.all(promises)
}

const onDeleteUser = async user => {
    const promises = []
    promises.push(deleteUserDataFromAlldone(user.uid, admin, admin))
    promises.push(deleteUserRecord(user.uid, user))
    await Promise.all(promises)
}

module.exports = { onDeleteUser }
