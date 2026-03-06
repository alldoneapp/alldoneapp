const admin = require('firebase-admin')

const { CONTACTS_OBJECTS_TYPE, updateRecord } = require('../AlgoliaGlobalSearchHelper')
const { syncContactFollowUpTask } = require('./contactFollowUpTasks')

const proccessAlgoliaRecord = async (projectId, contactId, oldContact, newContact) => {
    await updateRecord(projectId, contactId, oldContact, newContact, CONTACTS_OBJECTS_TYPE, admin.firestore())
}

const onUpdateContact = async (projectId, contactId, change) => {
    const oldContact = change.before.data()
    const newContact = change.after.data()

    console.log('[ContactFollowUp][Trigger:onUpdate]', {
        projectId,
        contactId,
        oldStatusId: oldContact?.contactStatusId || null,
        newStatusId: newContact?.contactStatusId || null,
        oldLastEditionDate: oldContact?.lastEditionDate || null,
        newLastEditionDate: newContact?.lastEditionDate || null,
        oldRecorderUserId: oldContact?.recorderUserId || null,
        newRecorderUserId: newContact?.recorderUserId || null,
    })

    await Promise.all([
        proccessAlgoliaRecord(projectId, contactId, oldContact, newContact),
        syncContactFollowUpTask(projectId, { ...newContact, uid: contactId }),
    ])
}

module.exports = {
    onUpdateContact,
}
