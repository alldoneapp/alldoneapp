'use strict'

/**
 * delete_contact for assistants and MCP clients.
 *
 * Deleting is the document delete the app does (utils/backends/Contacts/contactsFirestore.js
 * deleteProjectContact) plus its "deleted relevant person" Updates entry. Everything behind the
 * contact - its thread, its note, its photos, backlinks, the search record and open managed
 * follow-up tasks - is removed by onDeleteContactSecondGen, so a contact deleted here leaves exactly
 * what one deleted in the app leaves.
 *
 * The contact is named by its exact id only. update_contact matches names fuzzily, which is right
 * for an edit and wrong for a delete: the wrong person must never be removed by a near match.
 */

const { canAccessObject } = require('../shared/privacyAccess')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')

class ContactDeleteError extends Error {}

const fail = message => {
    throw new ContactDeleteError(message)
}

async function deleteContact({ db, projectId, userId, args = {}, writeDeletedFeed }) {
    const contactId = typeof args.contactId === 'string' ? args.contactId.trim() : ''
    if (!contactId) fail('contactId is required: get it from get_contacts. Names are not accepted for deleting.')
    if (contactId.includes('/')) fail('contactId is not valid.')
    if (!projectId) fail('projectId is required.')

    const projectSnapshot = await db.doc(`projects/${projectId}`).get()
    const projectUserIds = projectSnapshot.exists ? projectSnapshot.data()?.userIds || [] : []
    if (!projectUserIds.includes(userId)) fail('The project does not exist or you are not a member of it.')

    const contactRef = db.doc(`projectsContacts/${projectId}/contacts/${contactId}`)
    const snapshot = await contactRef.get()
    const contact = snapshot.exists ? snapshot.data() || {} : null
    // A contact without a stored audience is visible to the project and its recorder (mapContactData).
    const audience = contact
        ? { isPublicFor: contact.isPublicFor || [FEED_PUBLIC_FOR_ALL, contact.recorderUserId] }
        : null
    if (!contact || !canAccessObject(audience, userId)) fail(`No contact with id "${contactId}" in this project.`)

    const warnings = []
    if (typeof writeDeletedFeed === 'function') {
        try {
            await writeDeletedFeed({ ...contact, uid: contactId })
        } catch (error) {
            console.warn('[delete_contact] Updates entry failed', { projectId, contactId, error: error.message })
            warnings.push(`The contact is deleted, but its entry in Updates could not be written (${error.message}).`)
        }
    }

    await contactRef.delete()

    return {
        success: true,
        deleted: true,
        message: `Contact "${contact.displayName || contactId}" was deleted permanently.`,
        contact: { contactId, displayName: contact.displayName || '' },
        ...(warnings.length > 0 ? { warnings } : {}),
    }
}

module.exports = { ContactDeleteError, deleteContact }
