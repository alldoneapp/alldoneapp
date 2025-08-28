const admin = require('firebase-admin')

const { CONTACTS_OBJECTS_TYPE, updateRecord } = require('../AlgoliaGlobalSearchHelper')
const { updateProjectLastUserInteractionDate } = require('../Projects/projectsFirestore')

const proccessAlgoliaRecord = async (projectId, contactId, oldContact, newContact) => {
    await updateRecord(projectId, contactId, oldContact, newContact, CONTACTS_OBJECTS_TYPE, admin.firestore())
}

const onUpdateContact = async (projectId, contactId, change) => {
    const oldContact = change.before.data()
    const newContact = change.after.data()

    const promises = []
    promises.push(proccessAlgoliaRecord(projectId, contactId, oldContact, newContact))
    promises.push(updateProjectLastUserInteractionDate(projectId, Date.now()))
    await Promise.all(promises)
}

module.exports = {
    onUpdateContact,
}
