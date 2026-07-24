const admin = require('firebase-admin')
const { difference, intersection } = require('lodash')
const moment = require('moment')

const { PLAN_STATUS_PREMIUM } = require('./premiumHelper')
const { SUBSCRIPTION_STATUS_PENDING } = require('./Mollie')

const createUserSubscription = async (
    userPayingId,
    companyData,
    selectedUserIds,
    paymentMethod,
    customerId,
    paymentLink,
    paymentId
) => {
    await admin.firestore().doc(`subscriptions/${userPayingId}`).set({
        companyData,
        selectedUserIds,
        paidUsersIds: [],
        activePaidUsersIds: [],
        customerId,
        status: SUBSCRIPTION_STATUS_PENDING,
        paymentMethod,
        paymentLink,
        paymentId,
    })
}

const createTemporaryPremiumStates = (userPayingId, userIds, companyData, promises) => {
    for (let userId of userIds) {
        promises.push(
            admin
                .firestore()
                .doc(`users/${userId}`)
                .update({
                    premium: { status: PLAN_STATUS_PREMIUM, userPayingId },
                })
        )
        if (userId !== userPayingId)
            promises.push(
                admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).set({
                    userPayingId,
                    name: companyData.name,
                    pending: true,
                })
            )
    }
}

const createTemporaryPendingStates = (userPayingId, activePaidUsersIds, promises) => {
    for (let userId of activePaidUsersIds) {
        if (userId !== userPayingId)
            promises.push(
                admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).update({
                    pending: true,
                })
            )
    }
}

const removeTemporaryPendingStates = (userPayingId, activePaidUsersIds, promises) => {
    for (let userId of activePaidUsersIds) {
        if (userId !== userPayingId)
            promises.push(
                admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).update({
                    pending: admin.firestore.FieldValue.delete(),
                })
            )
    }
}

const getUserSubscription = async userPayingId => {
    const subscription = (await admin.firestore().doc(`subscriptions/${userPayingId}`).get()).data()
    return subscription
}

const getDaysLeftUntilNextPaymentPercent = nextPaymentDate => {
    const DAYS_IN_ONE_SUBSCRIPTION = 30
    const MINIMUM_PAYMENT_PERCENT = 0.03
    const today = moment()
    const nextPayment = moment(nextPaymentDate, 'YYYY-MM-DD')
    const daysLeftUntilNextPayment = nextPayment.diff(today, 'days')
    let daysLeftUntilNextPaymentPercent = daysLeftUntilNextPayment / DAYS_IN_ONE_SUBSCRIPTION
    daysLeftUntilNextPaymentPercent =
        daysLeftUntilNextPaymentPercent > 0 ? daysLeftUntilNextPaymentPercent : MINIMUM_PAYMENT_PERCENT
    return daysLeftUntilNextPaymentPercent
}

const generateUsersStatusList = (selectedUserIds, activePaidUsersIds, paidUsersIds) => {
    const addedUserIds = difference(selectedUserIds, activePaidUsersIds)
    const newAddedUserIds = difference(addedUserIds, paidUsersIds)
    const paidAddedUserIds = intersection(paidUsersIds, addedUserIds)
    const removedUserIds = difference(activePaidUsersIds, selectedUserIds)
    return { addedUserIds, newAddedUserIds, paidAddedUserIds, removedUserIds }
}

module.exports = {
    getUserSubscription,
    createUserSubscription,
    createTemporaryPremiumStates,
    createTemporaryPendingStates,
    removeTemporaryPendingStates,
    getDaysLeftUntilNextPaymentPercent,
    generateUsersStatusList,
}
