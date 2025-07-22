const { FEED_PUBLIC_FOR_ALL, promiseAllAndCatch } = require('./HelperFunctions')
const { addFollower, FOLLOW_TYPE_CONTACTS } = require('./FollowObjectHelper')

const copyContacts = async (firebase, projectId, newProjectId, user, originContacts) => {
    const db = firebase.firestore()
    let arrayPromises = []
    let promiseIndex = 0
    const objectNotes = []

    originContacts.forEach(contact => {
        const contactData = contact.data()
        if (contactData.noteId != null) objectNotes.push(contactData.noteId)

        const newContactRef = db.doc(`/projectsContacts/${newProjectId}/contacts/${contact.id}`)
        const newContactData = {
            ...contactData,
            isPrivate: false,
            isPublicFor: [FEED_PUBLIC_FOR_ALL, user.uid],
            recorderUserId: user.uid,
            lastEditorId: user.uid,
            lastEditionDate: Date.now(),
        }

        if (!arrayPromises[promiseIndex]) arrayPromises[promiseIndex] = []
        arrayPromises[promiseIndex].push(newContactRef.set(newContactData))
        arrayPromises[promiseIndex].push(
            addFollower(firebase, newProjectId, user.uid, FOLLOW_TYPE_CONTACTS, contact.id)
        )

        if (arrayPromises[promiseIndex].length === 500) {
            promiseIndex += 2
        }
    })

    for (let subArray of arrayPromises) {
        await promiseAllAndCatch(subArray, 'CONTACTS')
    }

    return objectNotes
}

module.exports = {
    copyContacts,
}
