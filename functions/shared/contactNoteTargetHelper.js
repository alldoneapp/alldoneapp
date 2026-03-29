'use strict'

const { normalizeEmailAddress } = require('../Email/emailChannelHelpers')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')

function normalizeText(value = '') {
    return String(value || '').trim()
}

function normalizeName(value = '') {
    return normalizeText(value).toLowerCase()
}

function mapContactDoc(doc) {
    const data = doc.data() || {}
    return {
        uid: doc.id,
        ...data,
    }
}

function buildContactDisplayName({ contactName, contactEmail }) {
    const normalizedName = normalizeText(contactName)
    if (normalizedName) return normalizedName
    const normalizedEmail = normalizeEmailAddress(contactEmail)
    if (!normalizedEmail) return 'Email contact'
    const localPart = normalizedEmail.split('@')[0] || normalizedEmail
    return localPart.replace(/[._-]+/g, ' ').trim() || normalizedEmail
}

async function loadProjectContacts(db, projectId) {
    const snapshot = await db.collection(`projectsContacts/${projectId}/contacts`).get()
    return snapshot.docs.map(mapContactDoc)
}

function findMatchingContacts(contacts, { contactId = '', contactEmail = '', contactName = '' }) {
    const normalizedContactId = normalizeText(contactId)
    const normalizedEmail = normalizeEmailAddress(contactEmail)
    const normalizedName = normalizeName(contactName)

    if (normalizedContactId) {
        return contacts.filter(contact => contact.uid === normalizedContactId)
    }

    if (normalizedEmail) {
        const emailMatches = contacts.filter(contact => normalizeEmailAddress(contact.email) === normalizedEmail)
        if (emailMatches.length > 0) return emailMatches
    }

    if (normalizedName) {
        return contacts.filter(contact => normalizeName(contact.displayName) === normalizedName)
    }

    return []
}

async function createContactRecord({ db, projectId, userId, contactName = '', contactEmail = '' }) {
    const contactId = db.collection('_').doc().id
    const email = normalizeEmailAddress(contactEmail)
    const displayName = buildContactDisplayName({ contactName, contactEmail: email })
    const now = Date.now()
    const contact = {
        displayName,
        photoURL: '',
        photoURL50: '',
        photoURL300: '',
        company: '',
        role: '',
        description: '',
        extendedDescription: '',
        hasStar: '#FFFFFF',
        isPrivate: false,
        isPublicFor: [FEED_PUBLIC_FOR_ALL, userId],
        recorderUserId: userId,
        email,
        phone: '',
        lastEditorId: userId,
        lastEditionDate: now,
        noteId: null,
        isPremium: false,
        assistantId: '',
        commentsData: null,
        openTasksAmount: 0,
        contactStatusId: null,
    }

    await db.doc(`projectsContacts/${projectId}/contacts/${contactId}`).set(contact)
    return {
        uid: contactId,
        ...contact,
    }
}

async function loadNoteById(db, projectId, noteId) {
    const noteDoc = await db.doc(`noteItems/${projectId}/notes/${noteId}`).get()
    if (!noteDoc.exists) return null
    return {
        id: noteId,
        ...noteDoc.data(),
    }
}

async function ensureContactNote({ db, noteService, feedUser, userId, projectId, contact }) {
    if (contact.noteId) {
        const existingNote = await loadNoteById(db, projectId, contact.noteId)
        if (existingNote) {
            return {
                note: existingNote,
                noteCreated: false,
                contactUpdated: false,
            }
        }
    }

    const isPrivate = !!contact.isPrivate
    const isPublicFor = Array.isArray(contact.isPublicFor)
        ? contact.isPublicFor
        : [FEED_PUBLIC_FOR_ALL, contact.recorderUserId || userId]
    const noteTitle = normalizeText(contact.displayName) || normalizeEmailAddress(contact.email) || 'Contact note'

    const result = await noteService.createAndPersistNote(
        {
            title: noteTitle,
            content: '',
            userId,
            projectId,
            isPrivate,
            isPublicFor,
            feedUser,
            parentObject: { id: contact.uid, type: 'contacts' },
        },
        {
            userId,
            projectId,
        }
    )

    await db.doc(`projectsContacts/${projectId}/contacts/${contact.uid}`).update({
        noteId: result.noteId,
        lastEditionDate: Date.now(),
        lastEditorId: userId,
    })

    return {
        note: result.note,
        noteCreated: true,
        contactUpdated: true,
    }
}

async function resolveContactNoteTarget({
    db,
    noteService,
    feedUser,
    userId,
    projectId,
    contactId = '',
    contactName = '',
    contactEmail = '',
    createIfMissing = true,
}) {
    const contacts = await loadProjectContacts(db, projectId)
    const matches = findMatchingContacts(contacts, { contactId, contactName, contactEmail })

    if (matches.length > 1) {
        return {
            success: false,
            error: 'MULTIPLE_CONTACT_MATCHES',
            message: `Found ${matches.length} matching contacts. Please provide a more specific contact email or ID.`,
            matches: matches.map(contact => ({
                contactId: contact.uid,
                displayName: contact.displayName || '',
                email: contact.email || '',
                noteId: contact.noteId || null,
            })),
            totalMatches: matches.length,
        }
    }

    let contact = matches[0] || null
    let contactCreated = false

    if (!contact) {
        if (!createIfMissing) {
            return {
                success: false,
                error: 'NO_CONTACT_MATCH',
                message: 'No matching contact was found.',
                matches: [],
                totalMatches: 0,
            }
        }

        contact = await createContactRecord({
            db,
            projectId,
            userId,
            contactName,
            contactEmail,
        })
        contactCreated = true
    }

    const noteResult = await ensureContactNote({
        db,
        noteService,
        feedUser,
        userId,
        projectId,
        contact,
    })

    return {
        success: true,
        contact,
        note: noteResult.note,
        projectId,
        contactCreated,
        noteCreated: noteResult.noteCreated,
    }
}

module.exports = {
    buildContactDisplayName,
    findMatchingContacts,
    resolveContactNoteTarget,
}
