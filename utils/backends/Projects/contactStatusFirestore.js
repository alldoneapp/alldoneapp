import { firebase } from '@firebase/app'

import { generateSortIndex, getDb, getId } from '../firestore'

export function addContactStatus(projectId, name, color, followUpDays = null) {
    const statusId = getId()
    const sortIndex = generateSortIndex()

    getDb()
        .doc(`projects/${projectId}`)
        .update({
            [`contactStatuses.${statusId}`]: {
                id: statusId,
                name,
                color,
                sortIndex,
                followUpDays,
            },
        })

    return statusId
}

export function updateContactStatus(projectId, statusId, name, color, followUpDays = null) {
    getDb()
        .doc(`projects/${projectId}`)
        .update({
            [`contactStatuses.${statusId}.name`]: name,
            [`contactStatuses.${statusId}.color`]: color,
            [`contactStatuses.${statusId}.followUpDays`]: followUpDays,
        })
}

export function deleteContactStatus(projectId, statusId) {
    getDb()
        .doc(`projects/${projectId}`)
        .update({
            [`contactStatuses.${statusId}`]: firebase.firestore.FieldValue.delete(),
        })
}

export function updateContactStatusSortIndex(projectId, statusId, sortIndex, batch) {
    batch.update(getDb().doc(`projects/${projectId}`), {
        [`contactStatuses.${statusId}.sortIndex`]: sortIndex,
    })
}
