const { sanitizeCallPageContext } = require('./assistantCallPageContext')
const { assertProjectAccess, canAccessObject } = require('../shared/privacyAccess')

function getCallNotePage(pageContext) {
    const path = sanitizeCallPageContext(pageContext)?.path || ''
    // A person's note route contains the person/contact ID, not the note ID.
    const match = path.match(/^\/projects\/([\w-]+)\/(contacts|user)\/([\w-]+)\/note\/?$/)
    return match ? { projectId: match[1], contactId: match[3] } : null
}

async function resolveCallContactNote({ db, userId, pageContext }) {
    const page = getCallNotePage(pageContext)
    if (!page) return null
    await assertProjectAccess(db, userId, page.projectId)
    const contactDoc = await db.doc(`projectsContacts/${page.projectId}/contacts/${page.contactId}`).get()
    if (!contactDoc.exists) return null
    const contact = contactDoc.data()
    if (!canAccessObject(contact, userId)) throw new Error('User does not have access to this contact')
    if (!contact.noteId) throw new Error('This contact has no attached note')
    if (typeof contact.noteId !== 'string' || !/^[\w-]+$/.test(contact.noteId))
        throw new Error('The contact has an invalid attached note reference')
    const noteDoc = await db.doc(`noteItems/${page.projectId}/notes/${contact.noteId}`).get()
    if (!noteDoc.exists) throw new Error('The attached note was not found')
    if (!canAccessObject(noteDoc.data(), userId)) throw new Error('User does not have access to this note')
    return { ...page, noteId: contact.noteId }
}

module.exports = { getCallNotePage, resolveCallContactNote }
