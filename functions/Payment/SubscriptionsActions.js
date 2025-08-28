const functions = require('firebase-functions')
const admin = require('firebase-admin')
const moment = require('moment')

const { PLAN_STATUS_PREMIUM } = require('./premiumHelper')
const {
    createCustomer,
    createPayment,
    updatePaymentMetaData,
    updateMollieSubscriptionAmount,
    PRICE,
    PAYMENT_TYPE_CREATE_SUBSCRIPTION,
    SUBSCRIPTION_STATUS_ACTIVE,
    PAYMENT_TYPE_ADD_USERS_WHEN_EDIT_SUBSCRIPTION,
    SUBSCRIPTION_STATUS_EDITING_USERS_PENDING,
    SUBSCRIPTION_STATUS_ACTIVATION_PENDING,
    PAYMENT_TYPE_ADD_USERS_WHEN_ACTIVATE_SUBSCRIPTION,
    createMollieSubscription,
    SUBSCRIPTION_STATUS_UPDATE_CREDIT_CARD_PENDING,
    PAYMENT_TYPE_UPDATE_CREDIT_CARD,
} = require('./Mollie')
const {
    createUserSubscription,
    createTemporaryPremiumStates,
    getUserSubscription,
    getDaysLeftUntilNextPaymentPercent,
    createTemporaryPendingStates,
    generateUsersStatusList,
} = require('./SubscriptionsHelper')
const { cancelSubscription } = require('./CancelSubscriptions')

const createCompanySubscription = async (
    currentCustomerId,
    userId,
    userName,
    userEmail,
    selectedUserIds,
    companyData,
    paymentMethod,
    urlOrigin
) => {
    try {
        const customerId = currentCustomerId ? currentCustomerId : (await createCustomer(userName, userEmail)).id

        if (!companyData.name) companyData.name = userName

        const amountToPay = selectedUserIds.length * PRICE
        const paymentData = await createPayment(customerId, amountToPay, urlOrigin, 'Monthly subscription', 'first', {})

        const paymentLink = paymentData._links.checkout.href

        const promises = []
        promises.push(
            updatePaymentMetaData(paymentData.id, {
                userPayingId: userId,
                customerId,
                type: PAYMENT_TYPE_CREATE_SUBSCRIPTION,
                userName,
            })
        )
        promises.push(
            createUserSubscription(
                userId,
                companyData,
                selectedUserIds,
                paymentMethod,
                customerId,
                paymentLink,
                paymentData.id
            )
        )
        promises.push(admin.firestore().doc(`users/${userId}`).update({ customerId }))
        createTemporaryPremiumStates(userId, selectedUserIds, companyData, promises)
        await Promise.all(promises)

        return { checkout: paymentLink }
    } catch (e) {
        functions.logger.error('Mollie fail, check this =>', e)
    }
}

const updateCreditCardNumber = async (userPayingId, urlOrigin) => {
    const subscription = await getUserSubscription(userPayingId)
    const { customerId, status, activePaidUsersIds } = subscription

    const paymentData = await createPayment(customerId, 0, urlOrigin, 'Update credit card', 'first', {
        userPayingId,
        customerId,
        type: PAYMENT_TYPE_UPDATE_CREDIT_CARD,
    })
    const promises = []
    promises.push(
        admin.firestore().doc(`subscriptions/${userPayingId}`).set(
            {
                previusStatus: status,
                status: SUBSCRIPTION_STATUS_UPDATE_CREDIT_CARD_PENDING,
                paymentLink: paymentData._links.checkout.href,
            },
            { merge: true }
        )
    )
    createTemporaryPendingStates(userPayingId, activePaidUsersIds, promises)
    await Promise.all(promises)
    return { checkout: paymentData._links.checkout.href }
}

const addedUsersToSubscription = async (userPayingId, newAddedUserIds, urlOrigin, newSelectedUserIds) => {
    const subscription = await getUserSubscription(userPayingId)
    const {
        nextPaymentDate,
        companyData,
        subscriptionIdInMollie,
        customerId,
        activePaidUsersIds,
        paidUsersIds,
    } = subscription
    const paymentInitialDate = moment().format('YYYY-MM-DD')
    const paymentExpiredDate = moment().add(15, 'm').format('YYYY-MM-DD')
    if (paymentInitialDate === nextPaymentDate || paymentExpiredDate === nextPaymentDate) {
        const promises = []
        promises.push(
            admin
                .firestore()
                .doc(`subscriptions/${userPayingId}`)
                .set(
                    {
                        selectedUserIds: admin.firestore.FieldValue.arrayUnion(...newAddedUserIds),
                        paidUsersIds: admin.firestore.FieldValue.arrayUnion(...newAddedUserIds),
                        activePaidUsersIds: admin.firestore.FieldValue.arrayUnion(...newAddedUserIds),
                    },
                    { merge: true }
                )
        )
        for (let userId of newAddedUserIds) {
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
                    admin
                        .firestore()
                        .doc(`subscriptionsPaidByOtherUser/${userId}`)
                        .set({
                            userPayingId,
                            name: companyData.name,
                            firstPaymentDate: moment().format('DD.MM.YYYY').toString(),
                        })
                )
        }
        const finalActiveUsersAmount = activePaidUsersIds.length + newAddedUserIds.length
        promises.push(updateMollieSubscriptionAmount(subscriptionIdInMollie, customerId, finalActiveUsersAmount))
        await Promise.all(promises)

        const { paidAddedUserIds, removedUserIds } = generateUsersStatusList(
            newSelectedUserIds,
            activePaidUsersIds,
            paidUsersIds
        )
        if (paidAddedUserIds.length > 0) await addedPaidUsersToSubscription(userPayingId, paidAddedUserIds)
        if (removedUserIds.length > 0) await removePaidUsersFromSubscription(userPayingId, removedUserIds)
    } else {
        return await createSubscriptionPendingState(
            userPayingId,
            newAddedUserIds,
            urlOrigin,
            PAYMENT_TYPE_ADD_USERS_WHEN_EDIT_SUBSCRIPTION,
            SUBSCRIPTION_STATUS_EDITING_USERS_PENDING,
            newSelectedUserIds,
            subscription
        )
    }
}

const addedUsersWhenActivateSubscription = async (userPayingId, newAddedUserIds, urlOrigin, newSelectedUserIds) => {
    const subscription = await getUserSubscription(userPayingId)
    const { nextPaymentDate, companyData, customerId, activePaidUsersIds, paidUsersIds } = subscription
    const paymentInitialDate = moment().format('YYYY-MM-DD')
    const paymentExpiredDate = moment().add(15, 'm').format('YYYY-MM-DD')
    if (paymentInitialDate === nextPaymentDate || paymentExpiredDate === nextPaymentDate) {
        const userPaying = await admin.firestore().doc(`users/${userPayingId}`).get()
        const { displayName } = userPaying
        const companyName = companyData.name ? companyData.name : displayName

        const mollieSubscription = await createMollieSubscription(
            customerId,
            newSelectedUserIds.length,
            companyName,
            userPayingId,
            null
        )

        const promises = []
        promises.push(
            admin
                .firestore()
                .doc(`subscriptions/${userPayingId}`)
                .set(
                    {
                        status: SUBSCRIPTION_STATUS_ACTIVE,
                        selectedUserIds: newSelectedUserIds,
                        paidUsersIds: admin.firestore.FieldValue.arrayUnion(...newAddedUserIds),
                        activePaidUsersIds: newSelectedUserIds,
                        subscriptionIdInMollie: mollieSubscription.id,
                    },
                    { merge: true }
                )
        )
        const { paidAddedUserIds } = generateUsersStatusList(newSelectedUserIds, activePaidUsersIds, paidUsersIds)
        paidAddedUserIds.forEach(userId => {
            if (userId !== userPayingId)
                promises.push(
                    admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).update({
                        canceled: admin.firestore.FieldValue.delete(),
                        subscriptionEndDate: admin.firestore.FieldValue.delete(),
                    })
                )
        })
        for (let userId of newAddedUserIds) {
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
                    admin
                        .firestore()
                        .doc(`subscriptionsPaidByOtherUser/${userId}`)
                        .set({
                            userPayingId,
                            name: companyData.name,
                            firstPaymentDate: moment().format('DD.MM.YYYY').toString(),
                        })
                )
        }
        await Promise.all(promises)
    } else {
        return await createSubscriptionPendingState(
            userPayingId,
            newAddedUserIds,
            urlOrigin,
            PAYMENT_TYPE_ADD_USERS_WHEN_ACTIVATE_SUBSCRIPTION,
            SUBSCRIPTION_STATUS_ACTIVATION_PENDING,
            newSelectedUserIds,
            subscription
        )
    }
}

const createSubscriptionPendingState = async (
    userPayingId,
    newAddedUserIds,
    urlOrigin,
    paymentType,
    pendingStatus,
    newSelectedUserIds,
    subscription
) => {
    const { nextPaymentDate, companyData, customerId, activePaidUsersIds } = subscription

    const daysLeftUntilNextPaymentPercent = getDaysLeftUntilNextPaymentPercent(nextPaymentDate)
    const amountToPay = newAddedUserIds.length * PRICE * daysLeftUntilNextPaymentPercent

    const paymentData = await createPayment(customerId, amountToPay, urlOrigin, 'New users added', 'oneoff', {
        userPayingId,
        customerId,
        type: paymentType,
    })

    const promises = []
    promises.push(
        admin.firestore().doc(`subscriptions/${userPayingId}`).set(
            {
                selectedUserIds: newSelectedUserIds,
                status: pendingStatus,
                paymentLink: paymentData._links.checkout.href,
                paymentId: paymentData.id,
            },
            { merge: true }
        )
    )
    createTemporaryPendingStates(userPayingId, activePaidUsersIds, promises)
    createTemporaryPremiumStates(userPayingId, newAddedUserIds, companyData, promises)
    await Promise.all(promises)
    return { checkout: paymentData._links.checkout.href }
}

async function removePaidUsersFromSubscription(userPayingId, removedUserIds) {
    const subscription = await getUserSubscription(userPayingId)
    const { activePaidUsersIds, nextPaymentDate, customerId, subscriptionIdInMollie } = subscription
    const finalActiveUsersAmount = activePaidUsersIds.length - removedUserIds.length

    if (finalActiveUsersAmount === 0) {
        await cancelSubscription(userPayingId)
    } else {
        const promises = []
        promises.push(updateMollieSubscriptionAmount(subscriptionIdInMollie, customerId, finalActiveUsersAmount))
        promises.push(
            admin
                .firestore()
                .doc(`subscriptions/${userPayingId}`)
                .update({
                    selectedUserIds: admin.firestore.FieldValue.arrayRemove(...removedUserIds),
                    activePaidUsersIds: admin.firestore.FieldValue.arrayRemove(...removedUserIds),
                })
        )
        removedUserIds.forEach(userId => {
            if (userId !== userPayingId)
                promises.push(
                    admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).update({
                        canceled: true,
                        subscriptionEndDate: nextPaymentDate,
                    })
                )
        })
        await Promise.all(promises)
    }
}

async function addedPaidUsersToSubscription(userPayingId, paidAddedUserIds) {
    const subscription = await getUserSubscription(userPayingId)
    const { customerId, subscriptionIdInMollie, activePaidUsersIds } = subscription
    const finalActiveUsersAmount = activePaidUsersIds.length + paidAddedUserIds.length
    const promises = []
    promises.push(updateMollieSubscriptionAmount(subscriptionIdInMollie, customerId, finalActiveUsersAmount))
    promises.push(
        admin
            .firestore()
            .doc(`subscriptions/${userPayingId}`)
            .update({
                activePaidUsersIds: admin.firestore.FieldValue.arrayUnion(...paidAddedUserIds),
                selectedUserIds: admin.firestore.FieldValue.arrayUnion(...paidAddedUserIds),
            })
    )
    paidAddedUserIds.forEach(userId => {
        if (userId !== userPayingId)
            promises.push(
                admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).update({
                    canceled: admin.firestore.FieldValue.delete(),
                    subscriptionEndDate: admin.firestore.FieldValue.delete(),
                })
            )
    })
    await Promise.all(promises)
}

const addedPaidUsersWhenActivateSubscription = async (userPayingId, paidAddedUserIds) => {
    let promises = []
    promises.push(admin.firestore().doc(`users/${userPayingId}`).get())
    promises.push(getUserSubscription(userPayingId))
    const promisesResult = await Promise.all(promises)

    const userPaying = promisesResult[0].data()
    const subscription = promisesResult[1]

    const { displayName } = userPaying
    const { companyData, customerId, nextPaymentDate } = subscription
    const companyName = companyData.name ? companyData.name : displayName

    const mollieSubscription = await createMollieSubscription(
        customerId,
        paidAddedUserIds.length,
        companyName,
        userPayingId,
        nextPaymentDate
    )

    promises = []
    promises.push(
        admin
            .firestore()
            .doc(`subscriptions/${userPayingId}`)
            .update({
                status: SUBSCRIPTION_STATUS_ACTIVE,
                activePaidUsersIds: admin.firestore.FieldValue.arrayUnion(...paidAddedUserIds),
                selectedUserIds: admin.firestore.FieldValue.arrayUnion(...paidAddedUserIds),
                subscriptionIdInMollie: mollieSubscription.id,
            })
    )
    paidAddedUserIds.forEach(userId => {
        if (userId !== userPayingId)
            promises.push(
                admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).update({
                    canceled: admin.firestore.FieldValue.delete(),
                    subscriptionEndDate: admin.firestore.FieldValue.delete(),
                })
            )
    })
    await Promise.all(promises)
}

module.exports = {
    createCompanySubscription,
    removePaidUsersFromSubscription,
    addedPaidUsersToSubscription,
    addedPaidUsersWhenActivateSubscription,
    addedUsersToSubscription,
    addedUsersWhenActivateSubscription,
    updateCreditCardNumber,
}
