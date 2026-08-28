import firebase from 'firebase/compat/app'
import 'firebase/compat/firestore'

// A FieldPath keeps Firebase Auth UIDs containing dots or other field-path
// punctuation as one literal map key.
export const getRoleIdsVisibleToField = userId => new firebase.firestore.FieldPath('roleIdsVisibleTo', userId)

export const getFollowedByVisibleToField = userId => new firebase.firestore.FieldPath('followedByVisibleTo', userId)

export const getBacklinkIdsVisibleToField = userId =>
    new firebase.firestore.FieldPath('backlinkIdsVisibleTo', String(userId))

export const buildBacklinkToken = (idsField, objectId) => JSON.stringify([idsField, objectId])

export const FOLLOWED_READER_IDS_FIELD = 'followedReaderIds'
