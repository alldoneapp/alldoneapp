'use strict'

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { normalizeEmailAddress } = require('../Email/emailChannelHelpers')
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
    return projectData
}

// MCP feed parity: contacts and moves
// Every field update_contact can change writes an Updates entry, with the tool's actor (the
// assistant, or the user marked "via <client>" over MCP). The entries are written after the contact
// itself, in a batch of their own, so a failing feed can never fail the write or the tool call.

const FEED_VALUE_LIMIT = 80
// The app shortens a task's and a goal's description to 50 characters in its feed entry.
const FEED_DESCRIPTION_LIMIT = 50

function shortFeedValue(value, limit = FEED_VALUE_LIMIT) {
    const { shrinkTagText } = require('../Utils/parseTextUtils')
    if (typeof value !== 'string') return ''
    return shrinkTagText(value.replace(/\s+/g, ' ').trim(), limit)
}

function shortFeedDescription(value) {
    if (typeof value !== 'string' || !value.trim()) return ''
    const { getTaskNameWithoutMeta } = require('../Utils/HelperFunctionsCloud')
    return shortFeedValue(getTaskNameWithoutMeta(value, true), FEED_DESCRIPTION_LIMIT)
}

function getContactStatusName(contactStatuses, statusId) {
    if (!statusId) return ''
    const status = contactStatuses && contactStatuses[statusId]
    return status && typeof status.name === 'string' && status.name.trim() ? status.name.trim() : 'Unknown'
}

function changed(updates, field) {
    return Object.prototype.hasOwnProperty.call(updates, field)
}

// A contact created outside the app's own chain (by the tools before this existed, or by any server
// path that wrote no feed) has no feed object, and every contact feed helper skips such a contact.
// Seeding it from the contact as it was before the change gives the first entry somewhere to land.
async function seedContactFeedObjectIfMissing({ projectId, contact, batch }) {
    const { getFeedObjectLastState } = require('../Feeds/globalFeedsHelper')
    const existing = await getFeedObjectLastState(projectId, 'contacts', contact.uid)
    if (existing) return
    const { generateContactObjectModel } = require('../Feeds/contactsFeedsHelper')
    const feedObject = generateContactObjectModel(Date.now(), contact, contact.uid)
    if (Array.isArray(contact.isPublicFor) && contact.isPublicFor.length > 0) {
        feedObject.isPublicFor = [...contact.isPublicFor]
    }
    batch.feedObjects = { ...(batch.feedObjects || {}), [contact.uid]: feedObject }
}

async function writeContactChangeFeeds({ db, projectId, contact, updates, feedUser, contactStatuses }) {
    const feeds = require('../Feeds/contactsFeeds')
    const contactId = contact.uid
    const batch = new BatchWrapper(db)
    const notify = true

    await seedContactFeedObjectIfMissing({ projectId, contact, batch })

    if (changed(updates, 'displayName')) {
        await feeds.createContactNameChangedFeed(
            projectId,
            contactId,
            updates.displayName,
            shortFeedValue(contact.displayName),
            batch,
            feedUser,
            notify
        )
    }
    if (changed(updates, 'photoURL50') || changed(updates, 'photoURL')) {
        const newPhotoURL = changed(updates, 'photoURL50') ? updates.photoURL50 : updates.photoURL
        await feeds.createContactPictureChangedFeed(
            projectId,
            contactId,
            newPhotoURL,
            contact.photoURL50 || contact.photoURL || '',
            batch,
            feedUser,
            notify
        )
    }
    if (changed(updates, 'company')) {
        await feeds.createContactCompanyChangedFeed(
            projectId,
            contactId,
            shortFeedValue(updates.company),
            shortFeedValue(contact.company),
            batch,
            feedUser,
            notify
        )
    }
    if (changed(updates, 'role')) {
        await feeds.createContactRoleChangedFeed(
            projectId,
            contactId,
            shortFeedValue(updates.role),
            shortFeedValue(contact.role),
            batch,
            feedUser,
            notify
        )
    }
    if (changed(updates, 'extendedDescription') || changed(updates, 'description')) {
        const newDescription = changed(updates, 'extendedDescription')
            ? updates.extendedDescription
            : updates.description
        await feeds.createContactDescriptionChangedFeed(
            projectId,
            contactId,
            shortFeedDescription(newDescription),
            shortFeedDescription(contact.extendedDescription || contact.description),
            batch,
            feedUser,
            notify
        )
    }
    if (changed(updates, 'phone')) {
        await feeds.createContactPhoneNumberChangedFeed(
            projectId,
            contactId,
            shortFeedValue(updates.phone),
            shortFeedValue(contact.phone),
            batch,
            feedUser,
            notify
        )
    }
    if (changed(updates, 'email')) {
        await feeds.createContactEmailChangedFeed(
            projectId,
            contactId,
            updates.email,
            normalizeEmailAddress(contact.email),
            batch,
            feedUser,
            notify
        )
    }
    if (changed(updates, 'linkedInUrl')) {
        await feeds.createContactLinkedInChangedFeed(
            projectId,
            contactId,
            shortFeedValue(updates.linkedInUrl),
            shortFeedValue(contact.linkedInUrl),
            batch,
            feedUser,
            notify
        )
    }
    if (changed(updates, 'contactStatusId')) {
        await feeds.createContactStatusChangedFeed(
            projectId,
            contactId,
            getContactStatusName(contactStatuses, updates.contactStatusId),
            getContactStatusName(contactStatuses, contact.contactStatusId),
            batch,
            feedUser,
            notify
        )
    }

    await batch.commit()
}

/**
 * The "added" entry for a contact a tool created (update_contact or update_note with
 * createIfMissing): the server copy of the app's own creation chain, written with the tool's actor.
 * Best effort: the contact already exists, so a failing feed is logged and the call goes on.
 */
async function writeContactCreatedFeeds({ db, projectId, contact, feedUser, userId }) {
    if (!contact?.uid || !feedUser?.uid) return false
    try {
        await loadFeedsStateForContactWrite({ db, projectId, feedUser, userId })
        const { addContactFeedsChain } = require('../Feeds/contactsFeedsChains')
        const contactForFeeds = {
            ...contact,
            isPublicFor: Array.isArray(contact.isPublicFor) ? contact.isPublicFor : [],
        }
        await addContactFeedsChain(projectId, contactForFeeds, contact.photoURL50 || '', contact.uid, false, true)
        return true
    } catch (error) {
        console.warn('[contactUpdateHelper] Could not write the contact-added feed', {
            projectId,
            contactId: contact.uid,
            error: error.message,
        })
        return false
    }
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
    const projectData = await loadFeedsStateForContactWrite({ db, projectId, feedUser, userId })

    const batch = new BatchWrapper(db)
    const contactRef = db.doc(`projectsContacts/${projectId}/contacts/${contactId}`)
    const metadataUpdates = {
        ...normalizedUpdates,
        lastEditionDate: Date.now(),
        lastEditorId: userId,
    }
    batch.update(contactRef, metadataUpdates)

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

    if (feedUser?.uid) {
        try {
            await writeContactChangeFeeds({
                db,
                projectId,
                contact,
                updates: normalizedUpdates,
                feedUser,
                contactStatuses: projectData?.contactStatuses || {},
            })
        } catch (error) {
            console.warn('[contactUpdateHelper] Could not write the contact change feeds', {
                projectId,
                contactId,
                fields: Object.keys(normalizedUpdates),
                error: error.message,
            })
        }
    }

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
    writeContactCreatedFeeds,
}
