const admin = require('firebase-admin')

const { CONTACTS_OBJECTS_TYPE, createRecord } = require('../AlgoliaGlobalSearchHelper')
const { updateProjectLastUserInteractionDate } = require('../Projects/projectsFirestore')

const proccessAlgoliaRecord = async (projectId, contact) => {
    await createRecord(projectId, contact.uid, contact, CONTACTS_OBJECTS_TYPE, admin.firestore(), false, null)
}

const onCreateContact = async (projectId, contact) => {
    const promises = []
    promises.push(proccessAlgoliaRecord(projectId, contact))
    promises.push(updateProjectLastUserInteractionDate(projectId, Date.now()))
    await Promise.all(promises)
}

module.exports = {
    onCreateContact,
}
