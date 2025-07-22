import { getDb, globalWatcherUnsub } from '../firestore'
import store from '../../../redux/store'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'

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
