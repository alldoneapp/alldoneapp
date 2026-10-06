import firebase from 'firebase/compat/app'
import { readDocumentDirectlyFromServer, updateDocumentDirectlyFromServer } from '../firestoreDirectRead'
import { isBrowserOffline } from '../../connectionState'
import { isManualOfflineMode } from '../../connectionHealth'

export const NEW_DAY_ACKNOWLEDGEMENT_TIMEOUT_MS = 5000

const withBudget = async work => {
    const controller = new AbortController()
    let timer
    try {
        return await Promise.race([
            Promise.resolve().then(() => work(controller.signal)),
            new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    controller.abort()
                    reject(
                        Object.assign(new Error('New day confirmation sync timed out'), { code: 'deadline-exceeded' })
                    )
                }, NEW_DAY_ACKNOWLEDGEMENT_TIMEOUT_MS)
            }),
        ])
    } finally {
        clearTimeout(timer)
    }
}

const checkAccount = (userId, getCurrentUserId, signal) => {
    if (signal?.aborted) throw Object.assign(new Error('New day sync cancelled'), { name: 'AbortError' })
    if (getCurrentUserId() !== userId || firebase.auth().currentUser?.uid !== userId)
        throw new Error('New day account changed')
    if (isBrowserOffline() || isManualOfflineMode())
        throw Object.assign(new Error('New day confirmation is waiting for a connection'), { code: 'unavailable' })
}

export const readNewDayAcknowledgement = (userId, getCurrentUserId) =>
    withBudget(async signal => {
        checkAccount(userId, getCurrentUserId, signal)
        const snapshot = await readDocumentDirectlyFromServer(`users/${userId}`, { signal })
        checkAccount(userId, getCurrentUserId, signal)
        return snapshot.exists ? snapshot.data : null
    })

// The authenticated REST path does not depend on the shared SDK queue. A stalled
// attempt ends so the durable recovery record can actually be retried.
export const persistNewDayAcknowledgement = (userId, previousDate, date, getCurrentUserId) =>
    withBudget(async signal => {
        const assertAccount = () => checkAccount(userId, getCurrentUserId, signal)
        for (let attempt = 0; attempt < 3; attempt++) {
            assertAccount()
            const snapshot = await readDocumentDirectlyFromServer(`users/${userId}`, {
                signal,
                includeUpdateTime: true,
            })
            assertAccount()
            if (!snapshot.exists) throw new Error('New day account document is missing')
            if (Number(snapshot.data?.statisticsModalDate || 0) >= date) return
            try {
                await updateDocumentDirectlyFromServer(
                    `users/${userId}`,
                    {
                        statisticsModalDate: { integerValue: String(date) },
                        previousStatisticsModalDate: { integerValue: String(previousDate) },
                    },
                    snapshot.updateTime,
                    { signal, assertAccount }
                )
                return
            } catch (error) {
                if (!['FAILED_PRECONDITION', 'ABORTED'].includes(error.code) || attempt === 2) throw error
            }
        }
    })
