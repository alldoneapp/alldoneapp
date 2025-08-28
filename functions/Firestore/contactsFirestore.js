const admin = require('firebase-admin')

const { mapContactData } = require('../Utils/MapDataFuncions')
const { addContactFeedsChain } = require('../Feeds/contactsFeedsChains')
const { logEvent } = require('../GAnalytics/GAnalytics')

const getContactData = async (db, projectId, contactId) => {
    const contact = (await db.doc(`/projectsContacts/${projectId}/contacts/${contactId}`).get()).data()
    return contact ? mapContactData(contactId, contact) : null
}

async function getProjectContacts(projectId) {
    const contactDocs = (await admin.firestore().collection(`/projectsContacts/${projectId}/contacts`).get()).docs
    const contacts = []
    contactDocs.forEach(doc => {
        contacts.push(mapContactData(doc.id, doc.data()))
    })
    return contacts
}

async function uploadNewContact(projectId, contact) {
    const contactCopy = { ...contact }
    delete contactCopy.uid

    const promises = []
    promises.push(admin.firestore().doc(`projectsContacts/${projectId}/contacts/${contact.id}`).set(contactCopy))
    promises.push(addContactFeedsChain(projectId, contact, contact.photoURL, contact.uid, false, false))
    promises.push(logEvent('', 'new_contact', { id: contact.id, email: contact.email }))
    await Promise.all(promises)
}

const updateContactEditionData = async (projectId, contactId, editorId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`projectsContacts/${projectId}/contacts/${contactId}`)
            const contactDoc = await transaction.get(ref)
            if (contactDoc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const updateContactOpenTasksAmount = async (projectId, contactId, amountToAdd) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`projectsContacts/${projectId}/contacts/${contactId}`)
            const contactDoc = await transaction.get(ref)
            if (contactDoc.exists)
                transaction.update(ref, {
                    openTasksAmount: admin.firestore.FieldValue.increment(amountToAdd),
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const updateContactLastCommentData = async (projectId, contactId, lastComment, lastCommentType) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`projectsContacts/${projectId}/contacts/${contactId}`)
            const contactDoc = await transaction.get(ref)
            if (contactDoc.exists)
                transaction.update(ref, {
                    [`commentsData.lastComment`]: lastComment,
                    [`commentsData.lastCommentType`]: lastCommentType,
                    [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

module.exports = {
    getContactData,
    getProjectContacts,
    uploadNewContact,
    updateContactEditionData,
    updateContactLastCommentData,
    updateContactOpenTasksAmount,
}
