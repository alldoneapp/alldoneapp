'use strict'

const { normalizeEmailAddress } = require('../Email/emailChannelHelpers')
const { buildContactEmailFields, getContactEmails } = require('./contactEmailHelper')
const { FOLLOWER_CONTACTS_TYPE, FOLLOWER_NOTES_TYPE } = require('../Followers/FollowerConstants')
const { tryAddFollower } = require('../Followers/followerHelper')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { ProjectService } = require('./ProjectService')

const MIN_FUZZY_NAME_SIMILARITY = 0.8

function normalizeText(value = '') {
    return String(value || '').trim()
}

function normalizeName(value = '') {
    return normalizeText(value).toLowerCase()
}

function normalizeNameForComparison(value = '') {
    return normalizeName(value)
        .replace(/[._-]+/g, ' ')
        .replace(/,/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function buildNameVariants(value = '') {
    const normalized = normalizeNameForComparison(value)
    if (!normalized) return []

    const tokens = normalized.split(' ').filter(Boolean)
    if (tokens.length <= 1) return [normalized]

    const variants = new Set([normalized])
    variants.add(tokens.slice().reverse().join(' '))
    return Array.from(variants)
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

function getContactSortDate(contact) {
    return Number(contact?.lastEditionDate || 0)
}

function sortContactsDeterministically(left, right) {
    const dateDifference = getContactSortDate(right) - getContactSortDate(left)
    if (dateDifference !== 0) return dateDifference
    return String(left?.uid || '').localeCompare(String(right?.uid || ''))
}

function levenshteinDistance(str1, str2) {
    const matrix = []

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i]
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1]
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
            }
        }
    }

    return matrix[str2.length][str1.length]
}

function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2
    const shorter = str1.length > str2.length ? str2 : str1

    if (longer.length === 0) return 1

    const distance = levenshteinDistance(longer, shorter)
    return (longer.length - distance) / longer.length
}

function getFuzzyNameMatches(contacts, normalizedName) {
    if (!normalizedName || normalizedName.length < 3) return []

    const searchVariants = buildNameVariants(normalizedName)

    return contacts
        .map(contact => {
            const candidateVariants = buildNameVariants(contact.displayName)
            if (candidateVariants.length === 0) return null

            let similarity = 0
            candidateVariants.forEach(candidateName => {
                searchVariants.forEach(searchVariant => {
                    if (!candidateName || candidateName.length < 3 || !searchVariant || searchVariant.length < 3) return
                    similarity = Math.max(similarity, calculateSimilarity(candidateName, searchVariant))
                })
            })

            const candidateName = candidateVariants[0]
            if (!candidateName || candidateName.length < 3) return null
            if (similarity <= MIN_FUZZY_NAME_SIMILARITY) return null

            return {
                ...contact,
                matchScore: similarity,
            }
        })
        .filter(Boolean)
        .sort((left, right) => {
            if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore
            return sortContactsDeterministically(left, right)
        })
}

async function resolveProjectForContactNote({ db, userId, projectId = '', projectName = '' }) {
    const normalizedProjectId = normalizeText(projectId)
    const normalizedProjectName = normalizeText(projectName)

    if (normalizedProjectId) {
        const projectDoc = await db.collection('projects').doc(normalizedProjectId).get()
        if (!projectDoc.exists) {
            throw new Error(`Project "${normalizedProjectId}" was not found.`)
        }
        return {
            id: normalizedProjectId,
            name: projectDoc.data()?.name || normalizedProjectId,
        }
    }

    if (!normalizedProjectName) {
        return null
    }

    const projectService = new ProjectService({
        database: db,
    })
    await projectService.initialize()
    const projects = await projectService.getUserProjects(userId, {
        includeArchived: true,
        includeCommunity: false,
        activeOnly: false,
    })

    const exactMatches = projects.filter(
        project => normalizeName(project.name) === normalizeName(normalizedProjectName)
    )
    if (exactMatches.length === 1) return exactMatches[0]
    if (exactMatches.length > 1) {
        throw new Error(`Multiple projects matched "${normalizedProjectName}". Please provide projectId instead.`)
    }

    const partialMatches = projects.filter(project =>
        normalizeName(project.name).includes(normalizeName(normalizedProjectName))
    )
    if (partialMatches.length === 1) return partialMatches[0]
    if (partialMatches.length > 1) {
        throw new Error(`Multiple projects matched "${normalizedProjectName}". Please provide projectId instead.`)
    }

    throw new Error(`Project "${normalizedProjectName}" was not found.`)
}

function findMatchingContacts(contacts, { contactId = '', contactEmail = '', contactName = '' }) {
    const normalizedContactId = normalizeText(contactId)
    const normalizedEmail = normalizeEmailAddress(contactEmail)
    const normalizedName = normalizeName(contactName)
    const normalizedComparableName = normalizeNameForComparison(contactName)
    const normalizedNameVariants = buildNameVariants(contactName)

    if (normalizedContactId) {
        const matches = contacts.filter(contact => contact.uid === normalizedContactId)
        return {
            selectedContact: matches.slice().sort(sortContactsDeterministically)[0] || null,
            matches: matches.slice().sort(sortContactsDeterministically),
            matchType: matches.length > 0 ? 'contact_id' : null,
            matchScore: null,
            autoPicked: matches.length > 1,
        }
    }

    if (normalizedEmail) {
        const emailMatches = contacts
            .filter(contact => getContactEmails(contact).includes(normalizedEmail))
            .sort(sortContactsDeterministically)
        if (emailMatches.length > 0) {
            return {
                selectedContact: emailMatches[0],
                matches: emailMatches,
                matchType: 'email',
                matchScore: null,
                autoPicked: emailMatches.length > 1,
            }
        }
    }

    if (normalizedName) {
        const exactNameMatches = contacts
            .filter(contact => {
                const exactName = normalizeName(contact.displayName)
                const comparableVariants = buildNameVariants(contact.displayName)
                return (
                    exactName === normalizedName ||
                    comparableVariants.some(variant => normalizedNameVariants.includes(variant))
                )
            })
            .sort(sortContactsDeterministically)
        if (exactNameMatches.length > 0) {
            return {
                selectedContact: exactNameMatches[0],
                matches: exactNameMatches,
                matchType: 'exact_name',
                matchScore: null,
                autoPicked: exactNameMatches.length > 1,
            }
        }
    }

    if (normalizedComparableName) {
        const fuzzyMatches = getFuzzyNameMatches(contacts, normalizedComparableName)
        if (fuzzyMatches.length > 0) {
            return {
                selectedContact: fuzzyMatches[0],
                matches: fuzzyMatches,
                matchType: 'fuzzy_name',
                matchScore: fuzzyMatches[0].matchScore,
                autoPicked: fuzzyMatches.length > 1,
            }
        }
    }

    return {
        selectedContact: null,
        matches: [],
        matchType: null,
        matchScore: null,
        autoPicked: false,
    }
}

async function createContactRecord({ db, projectId, userId, contactName = '', contactEmail = '' }) {
    const contactId = db.collection('_').doc().id
    const email = normalizeEmailAddress(contactEmail)
    const emailFields = buildContactEmailFields({}, email)
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
        email: emailFields.email,
        emails: emailFields.emails,
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

async function ensureCurrentUserFollowsContactAndNote({ projectId, contact, note, feedUser }) {
    if (!feedUser?.uid || !contact?.uid || !note?.id) return

    await tryAddFollower(
        projectId,
        {
            followObjectsType: FOLLOWER_CONTACTS_TYPE,
            followObjectId: contact.uid,
            followObject: {
                ...contact,
                noteId: note.id,
            },
            feedUser,
        },
        null,
        false
    )

    await tryAddFollower(
        projectId,
        {
            followObjectsType: FOLLOWER_NOTES_TYPE,
            followObjectId: note.id,
            followObject: note,
            feedUser,
        },
        null,
        false
    )
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

    const updatedContact = {
        ...contact,
        noteId: result.noteId,
        lastEditionDate: Date.now(),
        lastEditorId: userId,
    }

    await ensureCurrentUserFollowsContactAndNote({
        projectId,
        contact: updatedContact,
        note: result.note,
        feedUser,
    })

    return {
        note: result.note,
        noteCreated: true,
        contactUpdated: true,
        contact: updatedContact,
    }
}

async function resolveContactTarget({
    db,
    projectId,
    userId,
    contactId = '',
    contactName = '',
    contactEmail = '',
    createIfMissing = true,
}) {
    const contacts = await loadProjectContacts(db, projectId)
    const resolution = findMatchingContacts(contacts, { contactId, contactName, contactEmail })

    let contact = resolution.selectedContact || null
    let contactCreated = false
    let matchType = resolution.matchType
    let matchScore = resolution.matchScore
    let autoPicked = resolution.autoPicked

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
        matchType = 'created'
        matchScore = null
        autoPicked = false
    }

    return {
        success: true,
        contact,
        projectId,
        contactCreated,
        matchType,
        matchScore,
        autoPicked,
        matches: resolution.matches.map(match => ({
            contactId: match.uid,
            displayName: match.displayName || '',
            email: match.email || '',
            noteId: match.noteId || null,
            matchScore: typeof match.matchScore === 'number' ? match.matchScore : null,
        })),
        totalMatches: resolution.matches.length,
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
    const contactResolution = await resolveContactTarget({
        db,
        projectId,
        userId,
        contactId,
        contactName,
        contactEmail,
        createIfMissing,
    })
    if (!contactResolution.success) return contactResolution

    const noteResult = await ensureContactNote({
        db,
        noteService,
        feedUser,
        userId,
        projectId,
        contact: contactResolution.contact,
    })

    return {
        success: true,
        note: noteResult.note,
        projectId,
        contactCreated: contactResolution.contactCreated,
        noteCreated: noteResult.noteCreated,
        matchType: contactResolution.matchType,
        matchScore: contactResolution.matchScore,
        autoPicked: contactResolution.autoPicked,
        matches: contactResolution.matches,
        totalMatches: contactResolution.totalMatches,
        contact: noteResult.contact || contactResolution.contact,
    }
}

module.exports = {
    buildContactDisplayName,
    calculateSimilarity,
    findMatchingContacts,
    MIN_FUZZY_NAME_SIMILARITY,
    resolveContactTarget,
    resolveContactNoteTarget,
    resolveProjectForContactNote,
    sortContactsDeterministically,
}
