const { BatchWrapper } = require('../BatchWrapper/batchWrapper')

const FOLLOW_TYPE_TASKS = 'tasks'
const FOLLOW_TYPE_GOALS = 'goals'
const FOLLOW_TYPE_NOTES = 'notes'
const FOLLOW_TYPE_CONTACTS = 'contacts'
const FOLLOW_TYPE_PROJECTS = 'projects'
const FOLLOW_TYPE_USERS = 'users'

const addFollower = async (firebase, newProjectId, userFollowingId, followObjectsType, followObjectId) => {
    const db = firebase.firestore()
    const batch = new BatchWrapper(db)
    const arrayUnion = firebase.firestore.FieldValue.arrayUnion

    const entry = { [followObjectsType]: {} }

    entry[followObjectsType][followObjectId] = true
    const userFollowingRef = db.doc(`usersFollowing/${newProjectId}/entries/${userFollowingId}`)
    batch.set(userFollowingRef, entry, { merge: true })

    const followersRef = db.doc(`followers/${newProjectId}/${followObjectsType}/${followObjectId}`)
    batch.set(followersRef, { usersFollowing: arrayUnion(userFollowingId) }, { merge: true })

    if (followObjectsType === FOLLOW_TYPE_NOTES) {
        const noteRef = db.doc(`noteItems/${newProjectId}/notes/${followObjectId}`)
        const note = (await noteRef.get()).data()
        if (note) {
            const updateData = {
                followersIds: arrayUnion(userFollowingId),
                isVisibleInFollowedFor: arrayUnion(userFollowingId),
            }
            batch.set(noteRef, updateData, { merge: true })
        }
    }
    await batch.commit()
}

module.exports = {
    FOLLOW_TYPE_TASKS,
    FOLLOW_TYPE_GOALS,
    FOLLOW_TYPE_NOTES,
    FOLLOW_TYPE_CONTACTS,
    FOLLOW_TYPE_PROJECTS,
    FOLLOW_TYPE_USERS,
    addFollower,
}
