import firebase from 'firebase/compat/app'

import { generateSortIndex, getDb, getId } from '../firestore'

export function addContactStatus(projectId, name, color) {
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
            },
        })

    return statusId
}

export function updateContactStatus(projectId, statusId, name, color) {
    getDb()
        .doc(`projects/${projectId}`)
        .update({
            [`contactStatuses.${statusId}.name`]: name,
            [`contactStatuses.${statusId}.color`]: color,
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
