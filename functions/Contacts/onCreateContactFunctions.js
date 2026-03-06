const admin = require('firebase-admin')

const { CONTACTS_OBJECTS_TYPE, createRecord } = require('../AlgoliaGlobalSearchHelper')
const { syncContactFollowUpTask } = require('./contactFollowUpTasks')

const proccessAlgoliaRecord = async (projectId, contact) => {
    await createRecord(projectId, contact.uid, contact, CONTACTS_OBJECTS_TYPE, admin.firestore(), false, null)
}

const onCreateContact = async (projectId, contact) => {
    console.log('[ContactFollowUp][Trigger:onCreate]', {
        projectId,
        contactId: contact?.uid,
        contactStatusId: contact?.contactStatusId || null,
        lastEditionDate: contact?.lastEditionDate || null,
        recorderUserId: contact?.recorderUserId || null,
    })
    await Promise.all([proccessAlgoliaRecord(projectId, contact), syncContactFollowUpTask(projectId, contact)])
}

module.exports = {
    onCreateContact,
}
