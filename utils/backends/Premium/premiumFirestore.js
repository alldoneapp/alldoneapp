import { firebase } from '@firebase/app'

import { getDb, globalWatcherUnsub, runHttpsCallableFunction } from '../firestore'
import { getSubscriptionStatus, removeUsersPaidByOtherUser } from '../../../components/Premium/PremiumHelper'
import store from '../../../redux/store'
import { difference } from 'lodash'
import { intersection } from 'lodash'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'

export const removeQuotaWarnings = userId => {
    const db = getDb()
    db.doc(`users/${userId}`).set({ quotaWarnings: {} }, { merge: true })
}

export const updateQuotaXp = (projectId, userId, xpEarned, increaseProjectQuota) => {
    const db = getDb()
    db.doc(`users/${userId}`).set({ monthlyXp: firebase.firestore.FieldValue.increment(xpEarned) }, { merge: true })
    if (increaseProjectQuota) {
        const isGuide = !!ProjectHelper.getProjectById(projectId)?.parentTemplateId
        if (!isGuide)
            db.doc(`projects/${projectId}`).set(
                { monthlyXp: firebase.firestore.FieldValue.increment(xpEarned) },
                { merge: true }
            )
    }
}

export const updateQuotaTraffic = (projectId, userId, traficSize) => {
    const db = getDb()
    db.doc(`users/${userId}`).set(
        { monthlyTraffic: firebase.firestore.FieldValue.increment(traficSize) },
        { merge: true }
    )
    const isGuide = !!ProjectHelper.getProjectById(projectId)?.parentTemplateId
    if (!isGuide)
        db.doc(`projects/${projectId}`).set(
            { monthlyTraffic: firebase.firestore.FieldValue.increment(traficSize) },
            { merge: true }
        )
}

export const watchSubscription = (userId, watcherKey, callback) => {
    const db = getDb()
    globalWatcherUnsub[watcherKey] = db.doc(`subscriptions/${userId}`).onSnapshot(doc => {
        callback(doc.data())
    })
}

export const hideSuccessfullyPaymentStatus = userId => {
    const db = getDb()
    db.doc(`subscriptions/${userId}`).update({ showSuccessfullyPayment: firebase.firestore.FieldValue.delete() })
}

export const watchSubscriptionPaidByOtherUser = (userId, watcherKey, callback) => {
    const db = getDb()
    globalWatcherUnsub[watcherKey] = db.doc(`subscriptionsPaidByOtherUser/${userId}`).onSnapshot(doc => {
        callback(doc.data())
    })
}

export const removeSubscription = async () => {
    const loggedUserId = store.getState().loggedUser.uid
    const db = getDb()
    await db.doc(`subscriptions/${loggedUserId}`).delete()
}

export const updateCompanyDataInSubscription = async (companyData, subscription) => {
    const { selectedUserIds, paidUsersIds } = subscription
    const {
        isPendingSubscription,
        isEditingUsersPendingSubscription,
        isActivationPendingSubscription,
        isUpdateCreditCardPendingSubscription,
    } = getSubscriptionStatus(subscription)
    const userIdsWithSubscriptionPaidByLoggedUser =
        isPendingSubscription ||
        isEditingUsersPendingSubscription ||
        isActivationPendingSubscription ||
        isUpdateCreditCardPendingSubscription
            ? selectedUserIds
            : paidUsersIds

    const loggedUserId = store.getState().loggedUser.uid
    const db = getDb()
    const promises = []
    promises.push(db.doc(`subscriptions/${loggedUserId}`).update({ companyData }))

    userIdsWithSubscriptionPaidByLoggedUser.forEach(userId => {
        if (userId !== loggedUserId)
            promises.push(
                db.doc(`subscriptionsPaidByOtherUser/${userId}`).update({
                    name: companyData.name,
                })
            )
    })
    await Promise.all(promises)
}

export const updateUserIdsInSubscription = async selectedUserIds => {
    const loggedUserId = store.getState().loggedUser.uid
    const db = getDb()
    await db.doc(`subscriptions/${loggedUserId}`).update({ selectedUserIds })
}

export async function updateActivePaidUsersInActiveSubscription(subscription, closeModal) {
    const { uid } = store.getState().loggedUser
    const { activePaidUsersIds, paidUsersIds, selectedUserIds } = subscription
    const addedUserIds = difference(selectedUserIds, activePaidUsersIds)
    const removedUserIds = difference(activePaidUsersIds, selectedUserIds)
    if (addedUserIds.length > 0) {
        const newAddedUserIds = difference(addedUserIds, paidUsersIds)
        const usersToPayForIds = await removeUsersPaidByOtherUser(newAddedUserIds)
        if (usersToPayForIds.length > 0) {
            const usersPaidByOtherUserIds = difference(newAddedUserIds, usersToPayForIds)
            return addedUsersToSubscription({
                userPayingId: uid,
                newAddedUserIds: usersToPayForIds,
                urlOrigin: window.location.origin,
                newSelectedUserIds: selectedUserIds.filter(userId => !usersPaidByOtherUserIds.includes(userId)),
            })
        } else {
            const paidAddedUserIds = intersection(paidUsersIds, addedUserIds)
            if (paidAddedUserIds.length > 0) await addedPaidUsersToSubscription({ userPayingId: uid, paidAddedUserIds })
            if (removedUserIds.length > 0) await removePaidUsersFromSubscription({ userPayingId: uid, removedUserIds })
            closeModal()
        }
    } else {
        await removePaidUsersFromSubscription({ userPayingId: uid, removedUserIds })
    }
}

export async function activateSubscription(subscription, closeModal) {
    const { uid } = store.getState().loggedUser
    const { activePaidUsersIds, paidUsersIds, selectedUserIds } = subscription
    const addedUserIds = difference(selectedUserIds, activePaidUsersIds)

    if (addedUserIds.length > 0) {
        const newAddedUserIds = difference(addedUserIds, paidUsersIds)
        const usersToPayForIds = await removeUsersPaidByOtherUser(newAddedUserIds)
        if (usersToPayForIds.length > 0) {
            const usersPaidByOtherUserIds = difference(newAddedUserIds, usersToPayForIds)

            return addedUsersWhenActivateSubscription({
                userPayingId: uid,
                newAddedUserIds: usersToPayForIds,
                urlOrigin: window.location.origin,
                newSelectedUserIds: selectedUserIds.filter(userId => !usersPaidByOtherUserIds.includes(userId)),
            })
        } else {
            const paidAddedUserIds = intersection(paidUsersIds, addedUserIds)
            if (paidAddedUserIds.length > 0)
                await addedPaidUsersWhenActivateSubscription({ userPayingId: uid, paidAddedUserIds })
            closeModal()
        }
    }
}

export const cancelSubscription = async data => {
    return await runHttpsCallableFunction('cancelSubscriptionSecondGen', data)
}

export function createCompanySubscription(data) {
    return runHttpsCallableFunction('createCompanySubscriptionSecondGen', data)
}

async function addedUsersToSubscription(data) {
    return await runHttpsCallableFunction('addedUsersToSubscriptionSecondGen', data)
}

async function addedUsersWhenActivateSubscription(data) {
    return await runHttpsCallableFunction('addedUsersWhenActivateSubscriptionSecondGen', data)
}

async function addedPaidUsersWhenActivateSubscription(data) {
    return await runHttpsCallableFunction('addedPaidUsersWhenActivateSubscriptionSecondGen', data)
}

async function addedPaidUsersToSubscription(data) {
    return await runHttpsCallableFunction('addedPaidUsersToSubscriptionSecondGen', data)
}

export async function removePaidUsersFromSubscription(data) {
    return await runHttpsCallableFunction('removePaidUsersFromSubscriptionSecondGen', data)
}

export function removeUserFromSubscription(data) {
    return runHttpsCallableFunction('removeUserFromSubscriptionSecondGen', data)
}

export function updateCreditCardNumber(data) {
    return runHttpsCallableFunction('updateCreditCardNumberSecondGen', data)
}
