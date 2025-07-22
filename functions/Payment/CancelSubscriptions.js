'use strict'
const moment = require('moment')
const { difference } = require('lodash')
const admin = require('firebase-admin')
const { PLAN_STATUS_FREE } = require('./premiumHelper')
const {
    SUBSCRIPTION_STATUS_INACTIVE,
    SUBSCRIPTION_STATUS_CANCELED,
    SUBSCRIPTION_STATUS_ACTIVATION_PENDING,
    cancelMollieSubscription,
    revokeMandate,
} = require('./Mollie')
const { getUserData } = require('../Users/usersFirestore')

const processCanceledSubscription = async (userPayingId, subscription, alreadyCanceledInMollie) => {
    const { subscriptionIdInMollie, customerId, paidUsersIds, mandateId } = subscription

    const userPaying = await getUserData(userPayingId)

    const promises = []
    if (!alreadyCanceledInMollie) promises.push(cancelMollieSubscription(subscriptionIdInMollie, customerId))
    promises.push(revokeMandate(mandateId, customerId))
    if (userPaying) {
        promises.push(
            admin.firestore().doc(`subscriptions/${userPayingId}`).set(
                {
                    status: SUBSCRIPTION_STATUS_INACTIVE,
                    paidUsersIds: [],
                    activePaidUsersIds: [],
                    selectedUserIds: [],
                    nextPaymentDate: admin.firestore.FieldValue.delete(),
                    paymentLink: admin.firestore.FieldValue.delete(),
                    paymentId: admin.firestore.FieldValue.delete(),
                    subscriptionIdInMollie: admin.firestore.FieldValue.delete(),
                    mandateId: admin.firestore.FieldValue.delete(),
                    cardNumber: admin.firestore.FieldValue.delete(),
                },
                { merge: true }
            )
        )
    } else {
        promises.push(admin.firestore().doc(`subscriptions/${userPayingId}`).delete())
    }

    paidUsersIds.forEach(userId => {
        if (userId !== userPayingId)
            promises.push(admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).delete())
        if (userId !== userPayingId || userPaying) {
            promises.push(
                admin
                    .firestore()
                    .doc(`users/${userId}`)
                    .update({ premium: { status: PLAN_STATUS_FREE } })
            )
        }
    })
    await Promise.all(promises)
}

const processCanceledUsers = async (userPayingId, subscription) => {
    const { activePaidUsersIds, paidUsersIds } = subscription
    const promises = []
    promises.push(
        admin
            .firestore()
            .doc(`subscriptions/${userPayingId}`)
            .set({ paidUsersIds: activePaidUsersIds }, { merge: true })
    )
    const removedUserIds = difference(paidUsersIds, activePaidUsersIds)
    removedUserIds.forEach(userId => {
        if (userId !== userPayingId)
            promises.push(admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).delete())
        promises.push(
            admin
                .firestore()
                .doc(`users/${userId}`)
                .update({ premium: { status: PLAN_STATUS_FREE } })
        )
    })
    await Promise.all(promises)
}

const autoCancelSubscription = async () => {
    const todayDate = moment().format('YYYY-MM-DD')
    const subscriptionsDocs = (
        await admin.firestore().collection('subscriptions').where('nextPaymentDate', '==', todayDate).get()
    ).docs

    const subscriptions = []
    subscriptionsDocs.forEach(doc => {
        subscriptions.push({ ...doc.data(), userPayingId: doc.id })
    })

    const promisesBatchMax = 2
    let promises = []

    for (let i = 0; i < subscriptions.length; i++) {
        const subscription = subscriptions[i]
        const { status, userPayingId } = subscription

        if (status === SUBSCRIPTION_STATUS_CANCELED || status === SUBSCRIPTION_STATUS_ACTIVATION_PENDING) {
            promises.push(processCanceledSubscription(userPayingId, subscription, true))
        }

        if (promises.length >= promisesBatchMax) {
            await Promise.all(promises)
            promises = []
        }
    }

    await Promise.all(promises)
}

const cancelSubscription = async userPayingId => {
    const subscription = (await admin.firestore().doc(`subscriptions/${userPayingId}`).get()).data()
    const { activePaidUsersIds, nextPaymentDate, subscriptionIdInMollie, customerId, selectedUserIds } = subscription

    const promises = []
    promises.push(cancelMollieSubscription(subscriptionIdInMollie, customerId))
    promises.push(
        admin.firestore().doc(`subscriptions/${userPayingId}`).update({
            status: SUBSCRIPTION_STATUS_CANCELED,
            activePaidUsersIds: [],
            subscriptionIdInMollie: admin.firestore.FieldValue.delete(),
            selectedUserIds: [],
        })
    )
    activePaidUsersIds.forEach(userId => {
        if (userPayingId !== userId)
            promises.push(
                admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).update({
                    canceled: true,
                    subscriptionEndDate: nextPaymentDate,
                })
            )
    })
    await Promise.all(promises)
}

module.exports = { autoCancelSubscription, processCanceledSubscription, cancelSubscription, processCanceledUsers }
