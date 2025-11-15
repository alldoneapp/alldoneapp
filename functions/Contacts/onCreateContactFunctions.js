const admin = require('firebase-admin')

const { CONTACTS_OBJECTS_TYPE, createRecord } = require('../AlgoliaGlobalSearchHelper')

const proccessAlgoliaRecord = async (projectId, contact) => {
    await createRecord(projectId, contact.uid, contact, CONTACTS_OBJECTS_TYPE, admin.firestore(), false, null)
}

const onCreateContact = async (projectId, contact) => {
    await proccessAlgoliaRecord(projectId, contact)
}

module.exports = {
    onCreateContact,
}
