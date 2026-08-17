import { getCountFromServer } from 'firebase/firestore'

import { getDb, globalWatcherUnsub } from '../firestore'
import store from '../../../redux/store'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { isBrowserOffline } from '../../connectionState'

const MAX_CONCURRENT_NOTE_COUNTS = 4

const countQuery = async query => {
    // Keep using the compat Firestore instance that owns the app's cache and network
    // connection. Modular aggregation helpers accept its delegate directly; creating a
    // second Firestore instance here would split the client's cache and listeners.
    const snapshot = await getCountFromServer(query._delegate)
    return snapshot.data().count
}

const countNotesByProject = async (projectIds, createQuery) => {
    if (isBrowserOffline()) {
        const offlineError = new Error('Counting notes needs an internet connection')
        offlineError.code = 'offline'
        throw offlineError
    }

    let total = 0
    // All Projects can contain many projects. Bound the fan-out so the secondary header
    // count cannot compete with the small list queries that render the actual content.
    for (let index = 0; index < projectIds.length; index += MAX_CONCURRENT_NOTE_COUNTS) {
        const projectBatch = projectIds.slice(index, index + MAX_CONCURRENT_NOTE_COUNTS)
        const counts = await Promise.all(projectBatch.map(projectId => countQuery(createQuery(projectId))))
        total += counts.reduce((sum, count) => sum + count, 0)
    }
    return total
}

export const getAllNotesAmount = projectIds => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser
    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    return countNotesByProject(projectIds, projectId =>
        getDb().collection(`noteItems/${projectId}/notes`).where('isPublicFor', 'array-contains-any', allowUserIds)
    )
}

export const getFollowedNotesAmount = projectIds => {
    const loggedUserId = store.getState().loggedUser.uid

    return countNotesByProject(projectIds, projectId =>
        getDb()
            .collection(`noteItems/${projectId}/notes`)
            .where('isVisibleInFollowedFor', 'array-contains', loggedUserId)
    )
}

export const watchAllNotesAmount = (projectIds, watcherKeys, callback) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]
    const amountsByProject = { total: 0 }

    projectIds.forEach((projectId, index) => {
        globalWatcherUnsub[watcherKeys[index]] = getDb()
            .collection(`noteItems/${projectId}/notes`)
            .where('isPublicFor', 'array-contains-any', allowUserIds)
            .onSnapshot(snapshot => {
                const newAmount = snapshot.docs.length
                const previousAmount = amountsByProject[projectId]
                if (newAmount !== previousAmount) {
                    if (previousAmount) amountsByProject.total -= previousAmount
                    amountsByProject.total += newAmount
                    amountsByProject[projectId] = newAmount
                    callback(amountsByProject.total)
                }
            })
    })
}

export const watchFollowedNotesAmount = (projectIds, watcherKeys, callback) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId } = loggedUser

    const amountsByProject = { total: 0 }

    projectIds.forEach((projectId, index) => {
        globalWatcherUnsub[watcherKeys[index]] = getDb()
            .collection(`noteItems/${projectId}/notes`)
            .where('isVisibleInFollowedFor', 'array-contains', loggedUserId)
            .onSnapshot(snapshot => {
                const newAmount = snapshot.docs.length
                const previousAmount = amountsByProject[projectId]
                if (newAmount !== previousAmount) {
                    if (previousAmount) amountsByProject.total -= previousAmount
                    amountsByProject.total += newAmount
                    amountsByProject[projectId] = newAmount
                    callback(amountsByProject.total)
                }
            })
    })
}

export const unwatchNotesAmount = watcherKeys => {
    if (watcherKeys.length > 0) {
        watcherKeys.forEach(watcherKey => {
            globalWatcherUnsub[watcherKey]()
        })
    }
}
