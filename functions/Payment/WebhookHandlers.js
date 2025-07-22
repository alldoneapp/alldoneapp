const moment = require('moment')
const admin = require('firebase-admin')

const Invoices = require('./Invoices/Invoices')
const { purchaseEvent } = require('../GAnalytics/GAnalytics')
const { PLAN_STATUS_FREE } = require('./premiumHelper')
const {
    SUBSCRIPTION_STATUS_ACTIVE,
    SUBSCRIPTION_STATUS_INACTIVE,
    SUBSCRIPTION_STATUS_CANCELED,
    PAYMENT_TYPE_CREATE_SUBSCRIPTION,
    PAYMENT_TYPE_ADD_USERS_WHEN_EDIT_SUBSCRIPTION,
    PAYMENT_TYPE_ADD_USERS_WHEN_ACTIVATE_SUBSCRIPTION,
    PAYMENT_TYPE_UPDATE_CREDIT_CARD,
    updateMollieSubscriptionAmount,
    getPayment,
    getMollieSubscription,
    createMollieSubscription,
    revokeMandate,
} = require('./Mollie')
const { processCanceledSubscription, processCanceledUsers } = require('./CancelSubscriptions')
const { removePaidUsersFromSubscription, addedPaidUsersToSubscription } = require('./SubscriptionsActions')
const { removeTemporaryPendingStates, generateUsersStatusList } = require('./SubscriptionsHelper')
const { addMonthlyGoldToUser } = require('../Gold/goldHelper')
const { getUsersByIds } = require('../Users/usersFirestore')

const processPaymentStatus = async (paymentId, res) => {
    const { status, metadata, amount, details, mandateId } = await getPayment(paymentId)
    const { userPayingId, customerId, type: paymentType, userName } = metadata
    const cardNumber = details ? details.cardNumber : ''
    const subscription = (await admin.firestore().doc(`subscriptions/${userPayingId}`).get()).data()

    if (paymentType === PAYMENT_TYPE_CREATE_SUBSCRIPTION) {
        await processPaymentStatusWhenCreateSubscription(
            status,
            cardNumber,
            mandateId,
            userPayingId,
            customerId,
            userName,
            amount,
            subscription,
            res
        )
    } else if (paymentType === PAYMENT_TYPE_ADD_USERS_WHEN_EDIT_SUBSCRIPTION) {
        await processPaymentStatusWhenEditSubscription(status, userPayingId, customerId, amount, subscription, res)
    } else if (paymentType === PAYMENT_TYPE_ADD_USERS_WHEN_ACTIVATE_SUBSCRIPTION) {
        await processPaymentStatusWhenActivateSubscription(status, userPayingId, customerId, amount, subscription, res)
    } else if (paymentType === PAYMENT_TYPE_UPDATE_CREDIT_CARD) {
        await processPaymentStatusWhenUpdateCreditCard(
            status,
            cardNumber,
            mandateId,
            userPayingId,
            customerId,
            subscription,
            res
        )
    }
}

const processPaymentStatusWhenUpdateCreditCard = async (
    status,
    cardNumber,
    mandateId,
    userPayingId,
    customerId,
    subscription,
    res
) => {
    const { previusStatus, activePaidUsersIds } = subscription
    if (status === 'paid') {
        await processPaymentPaidStatusWhenUpdateCreditCard(
            cardNumber,
            mandateId,
            userPayingId,
            customerId,
            activePaidUsersIds,
            subscription,
            res
        )
    } else if (status === 'expired' || status === 'canceled' || status === 'failed') {
        await processPaymentUnpaidStatusWhenUpdateCreditCard(
            userPayingId,
            previusStatus,
            activePaidUsersIds,
            customerId,
            mandateId,
            res
        )
    }
}

const processPaymentPaidStatusWhenUpdateCreditCard = async (
    cardNumber,
    mandateId,
    userPayingId,
    customerId,
    activePaidUsersIds,
    subscription,
    res
) => {
    const { previusStatus, mandateId: oldMandateId } = subscription
    const promises = []
    promises.push(revokeMandate(oldMandateId, customerId))
    promises.push(
        admin.firestore().doc(`subscriptions/${userPayingId}`).update({
            previusStatus: admin.firestore.FieldValue.delete(),
            paymentLink: admin.firestore.FieldValue.delete(),
            status: previusStatus,
            cardNumber,
            mandateId,
        })
    )
    removeTemporaryPendingStates(userPayingId, activePaidUsersIds, promises)
    await Promise.all(promises)
    res.status(200).send('All good')
}

const processPaymentUnpaidStatusWhenUpdateCreditCard = async (
    userPayingId,
    previusStatus,
    activePaidUsersIds,
    customerId,
    mandateId,
    res
) => {
    const promises = []
    promises.push(revokeMandate(mandateId, customerId))
    promises.push(
        admin.firestore().doc(`subscriptions/${userPayingId}`).set(
            {
                previusStatus: admin.firestore.FieldValue.delete(),
                paymentLink: admin.firestore.FieldValue.delete(),
                status: previusStatus,
            },
            { merge: true }
        )
    )
    removeTemporaryPendingStates(userPayingId, activePaidUsersIds, promises)
    await Promise.all(promises)
    res.status(200).send('All good')
}

const processPaymentStatusWhenCreateSubscription = async (
    status,
    cardNumber,
    mandateId,
    userPayingId,
    customerId,
    userName,
    amount,
    subscription,
    res
) => {
    const { selectedUserIds, companyData } = subscription
    if (status === 'paid') {
        await processPaymentPaidStatusWhenCreateSubscription(
            selectedUserIds,
            cardNumber,
            mandateId,
            userPayingId,
            customerId,
            companyData,
            userName,
            amount,
            res
        )
    } else if (status === 'expired' || status === 'canceled' || status === 'failed') {
        await processPaymentUnpaidStatusWhenCreateSubscription(userPayingId, selectedUserIds, res)
    }
}

const processPaymentPaidStatusWhenCreateSubscription = async (
    selectedUserIds,
    cardNumber,
    mandateId,
    userPayingId,
    customerId,
    companyData,
    userName,
    amount,
    res
) => {
    const companyName = companyData.name ? companyData.name : userName

    let promises = []
    promises.push(
        createMollieSubscription(
            customerId,
            selectedUserIds.length,
            companyName,
            userPayingId,
            moment().add(1, 'M').format('YYYY-MM-DD')
        )
    )
    promises.push(admin.firestore().doc(`users/${userPayingId}`).get())
    promises.push(getUsersByIds(selectedUserIds))
    const promisesResult = await Promise.all(promises)

    const mollieSubscription = promisesResult[0]
    const userPaying = promisesResult[1].data()
    const usersToBePremium = promisesResult[2]
    const { displayName, email } = userPaying

    promises = []
    promises.push(
        admin.firestore().doc(`subscriptions/${userPayingId}`).update({
            status: SUBSCRIPTION_STATUS_ACTIVE,
            nextPaymentDate: mollieSubscription.nextPaymentDate,
            showSuccessfullyPayment: true,
            paymentLink: admin.firestore.FieldValue.delete(),
            paymentId: admin.firestore.FieldValue.delete(),
            paidUsersIds: selectedUserIds,
            activePaidUsersIds: selectedUserIds,
            subscriptionIdInMollie: mollieSubscription.id,
            cardNumber,
            mandateId,
        })
    )
    convertUserSubcriptionFromPendingToActive(selectedUserIds, userPayingId, promises)
    usersToBePremium.forEach(user => {
        if (user) promises.push(addMonthlyGoldToUser(user, true))
    })
    await Promise.all(promises)

    purchaseEvent(userPayingId, amount.value, mollieSubscription.id)
    Invoices.createPdf(
        selectedUserIds.length,
        userPayingId,
        amount.value,
        displayName,
        email,
        companyData,
        false,
        null,
        res
    )
}

const processPaymentUnpaidStatusWhenCreateSubscription = async (userPayingId, selectedUserIds, res) => {
    const promises = []
    promises.push(
        admin.firestore().doc(`subscriptions/${userPayingId}`).set(
            {
                selectedUserIds: [],
                subscriptionIdInMollie: admin.firestore.FieldValue.delete(),
                paymentLink: admin.firestore.FieldValue.delete(),
                paymentId: admin.firestore.FieldValue.delete(),
                status: SUBSCRIPTION_STATUS_INACTIVE,
            },
            { merge: true }
        )
    )
    removeUsersTemporaryPremiumStatus(userPayingId, selectedUserIds, promises)
    await Promise.all(promises)
    res.status(200).send('All good')
}

const processPaymentStatusWhenEditSubscription = async (
    status,
    userPayingId,
    customerId,
    amount,
    subscription,
    res
) => {
    const {
        selectedUserIds,
        companyData,
        subscriptionIdInMollie,
        paidUsersIds,
        activePaidUsersIds,
        nextPaymentDate,
    } = subscription
    if (status === 'paid') {
        await processPaymentPaidStatusWhenEditSubscription(
            userPayingId,
            selectedUserIds,
            activePaidUsersIds,
            paidUsersIds,
            subscriptionIdInMollie,
            customerId,
            nextPaymentDate,
            amount,
            companyData,
            res
        )
    } else if (status === 'expired' || status === 'canceled' || status === 'failed') {
        await processPaymentUnpaidStatusWhenEditSubscription(
            userPayingId,
            selectedUserIds,
            activePaidUsersIds,
            paidUsersIds,
            res
        )
    }
}

const processPaymentPaidStatusWhenEditSubscription = async (
    userPayingId,
    selectedUserIds,
    activePaidUsersIds,
    paidUsersIds,
    subscriptionIdInMollie,
    customerId,
    nextPaymentDate,
    amount,
    companyData,
    res
) => {
    const { newAddedUserIds, paidAddedUserIds, removedUserIds } = generateUsersStatusList(
        selectedUserIds,
        activePaidUsersIds,
        paidUsersIds
    )
    const finalActiveUsersAmount = activePaidUsersIds.length + newAddedUserIds.length
    let promises = []
    promises.push(getUsersByIds(newAddedUserIds))
    removeTemporaryPendingStates(userPayingId, activePaidUsersIds, promises)
    updateSubscriptionWhenAddingNewUsers(userPayingId, newAddedUserIds, promises)
    convertUserSubcriptionFromPendingToActive(newAddedUserIds, userPayingId, promises)
    promises.push(updateMollieSubscriptionAmount(subscriptionIdInMollie, customerId, finalActiveUsersAmount))
    const promisesResult = await Promise.all(promises)
    const newUsersToBePremium = promisesResult[0]

    if (paidAddedUserIds.length > 0) await addedPaidUsersToSubscription(userPayingId, paidAddedUserIds)
    if (removedUserIds.length > 0) await removePaidUsersFromSubscription(userPayingId, removedUserIds)

    purchaseEvent(userPayingId, amount.value, subscriptionIdInMollie)
    promises = []
    promises.push(
        generateInvoceWhenAddingNewUsers(userPayingId, newAddedUserIds, amount, companyData, nextPaymentDate, res)
    )
    newUsersToBePremium.forEach(user => {
        if (user) promises.push(addMonthlyGoldToUser(user, true))
    })
    await Promise.all(promises)
}

const processPaymentUnpaidStatusWhenEditSubscription = async (
    userPayingId,
    selectedUserIds,
    activePaidUsersIds,
    paidUsersIds,
    res
) => {
    const { newAddedUserIds } = generateUsersStatusList(selectedUserIds, activePaidUsersIds, paidUsersIds)
    const promises = []
    promises.push(
        admin.firestore().doc(`subscriptions/${userPayingId}`).set(
            {
                status: SUBSCRIPTION_STATUS_ACTIVE,
                paymentLink: admin.firestore.FieldValue.delete(),
                paymentId: admin.firestore.FieldValue.delete(),
                selectedUserIds: activePaidUsersIds,
            },
            { merge: true }
        )
    )
    removeTemporaryPendingStates(userPayingId, activePaidUsersIds, promises)
    removeUsersTemporaryPremiumStatus(userPayingId, newAddedUserIds, promises)
    await Promise.all(promises)
    res.status(200).send('All good')
}

const processPaymentStatusWhenActivateSubscription = async (
    status,
    userPayingId,
    customerId,
    amount,
    subscription,
    res
) => {
    const {
        selectedUserIds,
        companyData,
        subscriptionIdInMollie,
        paidUsersIds,
        activePaidUsersIds,
        nextPaymentDate,
    } = subscription
    if (status === 'paid') {
        await processPaymentPaidStatusWhenActivateSubscription(
            userPayingId,
            selectedUserIds,
            activePaidUsersIds,
            paidUsersIds,
            subscriptionIdInMollie,
            customerId,
            amount,
            companyData,
            nextPaymentDate,
            res
        )
    } else if (status === 'expired' || status === 'canceled' || status === 'failed') {
        await processPaymentUnpaidStatusWhenActivateSubscription(
            userPayingId,
            selectedUserIds,
            activePaidUsersIds,
            paidUsersIds,
            res
        )
    }
}

const processPaymentPaidStatusWhenActivateSubscription = async (
    userPayingId,
    selectedUserIds,
    activePaidUsersIds,
    paidUsersIds,
    subscriptionIdInMollie,
    customerId,
    amount,
    companyData,
    nextPaymentDate,
    res
) => {
    const { newAddedUserIds, paidAddedUserIds } = generateUsersStatusList(
        selectedUserIds,
        activePaidUsersIds,
        paidUsersIds
    )

    const userPaying = await admin.firestore().doc(`users/${userPayingId}`).get()
    const { displayName } = userPaying
    const companyName = companyData.name ? companyData.name : displayName

    const mollieSubscription = await createMollieSubscription(
        customerId,
        selectedUserIds.length,
        companyName,
        userPayingId,
        nextPaymentDate
    )

    let promises = []
    promises.push(getUsersByIds(newAddedUserIds))
    promises.push(
        admin
            .firestore()
            .doc(`subscriptions/${userPayingId}`)
            .update({
                status: SUBSCRIPTION_STATUS_ACTIVE,
                showSuccessfullyPayment: true,
                paymentLink: admin.firestore.FieldValue.delete(),
                paymentId: admin.firestore.FieldValue.delete(),
                paidUsersIds: admin.firestore.FieldValue.arrayUnion(...newAddedUserIds),
                activePaidUsersIds: selectedUserIds,
                subscriptionIdInMollie: mollieSubscription.id,
            })
    )
    convertUserSubcriptionFromPendingToActive(newAddedUserIds, userPayingId, promises)

    paidAddedUserIds.forEach(userId => {
        if (userId !== userPayingId)
            promises.push(
                admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).update({
                    canceled: admin.firestore.FieldValue.delete(),
                    subscriptionEndDate: admin.firestore.FieldValue.delete(),
                })
            )
    })

    const promisesResult = await Promise.all(promises)
    const newUsersToBePremium = promisesResult[0]

    purchaseEvent(userPayingId, amount.value, subscriptionIdInMollie)

    promises = []
    promises.push(
        generateInvoceWhenAddingNewUsers(userPayingId, newAddedUserIds, amount, companyData, nextPaymentDate, res)
    )
    newUsersToBePremium.forEach(user => {
        if (user) promises.push(addMonthlyGoldToUser(user, true))
    })
    await Promise.all(promises)
}

const processPaymentUnpaidStatusWhenActivateSubscription = async (
    userPayingId,
    selectedUserIds,
    activePaidUsersIds,
    paidUsersIds,
    res
) => {
    const { newAddedUserIds } = generateUsersStatusList(selectedUserIds, activePaidUsersIds, paidUsersIds)
    const promises = []
    promises.push(
        admin.firestore().doc(`subscriptions/${userPayingId}`).set(
            {
                activePaidUsersIds: [],
                selectedUserIds: [],
                status: SUBSCRIPTION_STATUS_CANCELED,
                paymentLink: admin.firestore.FieldValue.delete(),
                paymentId: admin.firestore.FieldValue.delete(),
            },
            { merge: true }
        )
    )
    removeUsersTemporaryPremiumStatus(userPayingId, newAddedUserIds, promises)
    await Promise.all(promises)
    res.status(200).send('All good')
}

const updateSubscriptionWhenAddingNewUsers = (userPayingId, newAddedUserIds, promises) => {
    promises.push(
        admin
            .firestore()
            .doc(`subscriptions/${userPayingId}`)
            .update({
                status: SUBSCRIPTION_STATUS_ACTIVE,
                showSuccessfullyPayment: true,
                paymentLink: admin.firestore.FieldValue.delete(),
                paymentId: admin.firestore.FieldValue.delete(),
                paidUsersIds: admin.firestore.FieldValue.arrayUnion(...newAddedUserIds),
                activePaidUsersIds: admin.firestore.FieldValue.arrayUnion(...newAddedUserIds),
            })
    )
}

const convertUserSubcriptionFromPendingToActive = (usersIds, userPayingId, promises) => {
    usersIds.forEach(userId => {
        if (userId !== userPayingId)
            promises.push(
                admin
                    .firestore()
                    .doc(`subscriptionsPaidByOtherUser/${userId}`)
                    .update({
                        pending: admin.firestore.FieldValue.delete(),
                        firstPaymentDate: moment().format('DD.MM.YYYY').toString(),
                    })
            )
    })
}

const generateInvoceWhenAddingNewUsers = async (
    userPayingId,
    newAddedUserIds,
    amount,
    companyData,
    nextPaymentDate,
    res
) => {
    const userPaying = (await admin.firestore().doc(`users/${userPayingId}`).get()).data()
    const { displayName, email } = userPaying

    Invoices.createPdf(
        newAddedUserIds.length,
        userPayingId,
        amount.value,
        displayName,
        email,
        companyData,
        true,
        nextPaymentDate,
        res
    )
}

const removeUsersTemporaryPremiumStatus = (userPayingId, userIds, promises) => {
    userIds.forEach(userId => {
        promises.push(
            admin
                .firestore()
                .doc(`users/${userId}`)
                .update({
                    premium: {
                        status: PLAN_STATUS_FREE,
                    },
                })
        )
        if (userId !== userPayingId)
            promises.push(admin.firestore().doc(`subscriptionsPaidByOtherUser/${userId}`).delete())
    })
}

const processMontlyPaymentStatus = async (paymentId, res) => {
    const { amount, subscriptionId, status } = await getPayment(paymentId)

    //TEST VARIABLE
    //const amount = { currency: 'EUR', value: '10.00' }
    //const subscriptionId = 'sub_gZXsZGmZhb'
    //const status = 'canceled'

    const subscriptionsDocs = (
        await admin
            .firestore()
            .collection('subscriptions')
            .where('subscriptionIdInMollie', '==', subscriptionId)
            .limit(1)
            .get()
    ).docs
    const subscription = subscriptionsDocs[0].data()
    const userPayingId = subscriptionsDocs[0].id
    console.log('userPayingId')
    console.log(userPayingId)
    if (status === 'paid') {
        await processMontlyPaymentPaidStatus(userPayingId, subscriptionId, subscription, amount, res)
    } else if (status === 'expired' || status === 'canceled' || status === 'failed') {
        await processMontlyPaymentUnpaidStatus(userPayingId, subscription, res)
    }
}

const processMontlyPaymentPaidStatus = async (userPayingId, subscriptionId, subscription, amount, res) => {
    const { paidUsersIds, companyData, customerId, activePaidUsersIds } = subscription

    let promises = []
    promises.push(getMollieSubscription(subscriptionId, customerId))
    promises.push(admin.firestore().doc(`users/${userPayingId}`).get())
    const promisesResult = await Promise.all(promises)

    const mollieSubscription = promisesResult[0]
    const userPaying = promisesResult[1].data()

    const { nextPaymentDate } = mollieSubscription
    const { displayName, email } = userPaying

    promises = []
    if (activePaidUsersIds.length !== paidUsersIds.length)
        promises.push(processCanceledUsers(userPayingId, subscription))
    promises.push(admin.firestore().doc(`subscriptions/${userPayingId}`).update({ nextPaymentDate }))
    await Promise.all(promises)

    purchaseEvent(userPayingId, amount.value, subscriptionId)
    Invoices.createPdf(
        activePaidUsersIds.length,
        userPayingId,
        amount.value,
        displayName,
        email,
        companyData,
        false,
        null,
        res
    )
}

const processMontlyPaymentUnpaidStatus = async (userPayingId, subscription, res) => {
    const { customerId, subscriptionIdInMollie } = subscription
    const mollieSubscription = await getMollieSubscription(subscriptionIdInMollie, customerId)
    await processCanceledSubscription(userPayingId, subscription, mollieSubscription.status === 'canceled')
    res.status(200).send('All good')
}

module.exports = {
    processPaymentStatus,
    processMontlyPaymentStatus,
}
