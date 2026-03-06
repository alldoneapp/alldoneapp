const admin = require('firebase-admin')

const { deleteRecord, CONTACTS_OBJECTS_TYPE } = require('../AlgoliaGlobalSearchHelper')
const { removeObjectFromBacklinks } = require('../Backlinks/backlinksHelper')
const { deleteChat } = require('../Chats/chatsFirestoreCloud')
const { deleteNote } = require('../Notes/notesFirestoreCloud')
const { deleteOpenManagedFollowUpTasks } = require('./contactFollowUpTasks')

const deletePictures = async (projectId, contactId) => {
    const bucket = admin.storage().bucket()
    await bucket.deleteFiles({ force: true, prefix: `projectsContacts/${projectId}/${contactId}/` })
}

const onDeleteContact = async (projectId, contact) => {
    const { uid: contactId, noteId } = contact

    console.log('[ContactFollowUp][Trigger:onDelete]', {
        projectId,
        contactId,
        noteId: noteId || null,
        contactStatusId: contact?.contactStatusId || null,
    })

    const promises = []
    promises.push(deleteChat(admin, projectId, contactId))
    if (noteId) promises.push(deleteNote(projectId, noteId, '', admin))
    promises.push(deletePictures(projectId, contactId))
    promises.push(removeObjectFromBacklinks(projectId, 'linkedParentContactsIds', contactId, admin))
    promises.push(deleteRecord(contactId, projectId, CONTACTS_OBJECTS_TYPE))
    promises.push(deleteOpenManagedFollowUpTasks(projectId, contactId))
    await Promise.all(promises)
}

module.exports = {
    onDeleteContact,
}
