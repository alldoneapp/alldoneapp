'use strict'

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { normalizeEmailAddress } = require('../Email/emailChannelHelpers')
const { createContactEmailChangedFeed } = require('../Feeds/contactsFeeds')
const { FOLLOWER_CONTACTS_TYPE } = require('../Followers/FollowerConstants')
const { tryAddFollower } = require('../Followers/followerHelper')
const { buildContactEmailFields } = require('./contactEmailHelper')

function normalizeContactUpdateValue(field, value) {
    if (field === 'email') return normalizeEmailAddress(value)
    return value
}

function buildUpdatedContact(contact, updates, userId) {
    const nextContact = { ...contact, ...updates }
    nextContact.lastEditionDate = Date.now()
    nextContact.lastEditorId = userId
    return nextContact
}

async function loadFeedsStateForContactWrite({ db, projectId, feedUser, userId }) {
    const admin = require('firebase-admin')
    const { loadFeedsGlobalState } = require('../GlobalState/globalState')
    let projectData = { userIds: [] }
    try {
        const projectRef = db.doc(`projects/${projectId}`)
        const projectSnap = typeof projectRef?.get === 'function' ? await projectRef.get() : null
        if (projectSnap?.exists) projectData = projectSnap.data() || projectData
    } catch (error) {
        console.warn('[contactUpdateHelper] Could not read the project for feed state', {
            projectId,
            error: error.message,
        })
    }
    const creator = feedUser || { uid: userId, id: userId }
    loadFeedsGlobalState(admin, admin, creator, { ...projectData, id: projectId }, [], null)
}

async function updateContactFields({ db, projectId, contact, userId, feedUser, updates = {} }) {
    const contactId = contact?.uid
    if (!contactId) {
        throw new Error('contact.uid is required for contact updates.')
    }

    const normalizedUpdates = {}
    const changes = []

    Object.entries(updates).forEach(([field, rawValue]) => {
        if (rawValue === undefined) return

        if (field === 'email') {
            const emailFields = buildContactEmailFields(contact, rawValue, { replacePrimary: true })
            const currentPrimaryEmail = normalizeEmailAddress(contact.email)
            const emailsChanged =
                JSON.stringify(emailFields.emails) !==
                JSON.stringify(Array.isArray(contact.emails) ? contact.emails : [])
            if (emailFields.email === currentPrimaryEmail && !emailsChanged) return

            normalizedUpdates.email = emailFields.email
            normalizedUpdates.emails = emailFields.emails
            changes.push(`email to "${emailFields.email}"`)
        } else {
            const nextValue = normalizeContactUpdateValue(field, rawValue)
            const currentValue = normalizeContactUpdateValue(field, contact[field])
            if (nextValue === currentValue) return

            normalizedUpdates[field] = nextValue
            changes.push(`${field} updated`)
        }
    })

    if (Object.keys(normalizedUpdates).length === 0) {
        return {
            success: true,
            updated: false,
            changes: [],
            contact,
        }
    }

    // The feed and follower helpers read `admin`, `feedCreator` and `project` from a per-instance
    // global state that every caller is expected to load first (TaskService, NoteService and the
    // cloud triggers all do). This helper never did, so update_contact only worked on a warm
    // instance where an earlier task or note write had loaded it, and crashed inside
    // tryAddFollower ("Cannot read properties of undefined (reading 'firestore')") on a cold one.
    await loadFeedsStateForContactWrite({ db, projectId, feedUser, userId })

    const batch = new BatchWrapper(db)
    const contactRef = db.doc(`projectsContacts/${projectId}/contacts/${contactId}`)
    const metadataUpdates = {
        ...normalizedUpdates,
        lastEditionDate: Date.now(),
        lastEditorId: userId,
    }
    batch.update(contactRef, metadataUpdates)

    if (normalizedUpdates.email !== undefined) {
        await createContactEmailChangedFeed(
            projectId,
            contactId,
            normalizedUpdates.email,
            normalizeEmailAddress(contact.email),
            batch,
            feedUser,
            false
        )
    }

    await tryAddFollower(
        projectId,
        {
            followObjectsType: FOLLOWER_CONTACTS_TYPE,
            followObjectId: contactId,
            followObject: contact,
            feedUser,
        },
        batch,
        false
    )

    await batch.commit()

    return {
        success: true,
        updated: true,
        changes,
        contact: buildUpdatedContact(contact, normalizedUpdates, userId),
    }
}

module.exports = {
    loadFeedsStateForContactWrite,
    updateContactFields,
}
