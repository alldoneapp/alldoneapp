'use strict'

/**
 * Updates-feed entries for OKRs written by the OKR tools of assistants and MCP clients
 * (okrToolService.js), and the privacy follow-up those entries need.
 *
 * An OKR has no feed object of its own, so its entries are lines on the project's feed object:
 * "Karsten Wysk (via Claude) changed OKR "Paying customers" • Current value from 2 to 3". An OKR can
 * be private to its owner, and its label is in the line, so the entry carries the OKR's own
 * `isPublicFor` (projectEntryFeeds.js keeps it out of everybody else's stores and counters) and the
 * OKR's id (`okrId`), which is how reconcileOkrFeedPrivacy finds the entries again when the OKR's
 * privacy changes later, in the app or through a tool.
 *
 * The feed helpers read the actor and the project from the per-instance global state, so each
 * entry point loads it first, as goalToolFeeds.js does.
 */

const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')

const { FEED_PUBLIC_FOR_ALL, getOkrIsPublicFor, normalizeOkrNumber } = require('../shared/OKRHelper')
const { shrinkTagText } = require('../Utils/parseTextUtils')

const OKR_LABEL_FEED_LIMIT = 60

const quoteLabel = label => `"${shrinkTagText(String(label || '').trim(), OKR_LABEL_FEED_LIMIT)}"`

function formatValue(value, unit) {
    const number = String(normalizeOkrNumber(value))
    const cleanUnit = String(unit || '').trim()
    return cleanUnit ? `${number} ${cleanUnit}` : number
}

const isPrivateAudience = isPublicFor => Array.isArray(isPublicFor) && !isPublicFor.includes(FEED_PUBLIC_FOR_ALL)

// The OKR's own audience, read the way the app and the access projection read it. Empty only for a
// private OKR without an owner, which then gets no entry at all rather than a project-wide one.
function okrAudience(okr = {}) {
    return getOkrIsPublicFor(okr || {})
}

function describeOkrCreated(okr = {}) {
    return `created OKR ${quoteLabel(okr.label)} • Target ${formatValue(okr.targetValue, okr.unit)}, ${
        okr.cadence || 'monthly'
    }`
}

// One line for everything a single update_okr call changed, or null when nothing a reader would see
// changed (the period dates that follow a new cadence are part of the cadence change).
function describeOkrUpdate(before = {}, after = {}) {
    const parts = []
    if ((after.label || '') !== (before.label || '')) parts.push(`renamed from ${quoteLabel(before.label)}`)
    if (normalizeOkrNumber(after.currentValue) !== normalizeOkrNumber(before.currentValue)) {
        parts.push(
            `current value from ${formatValue(before.currentValue, before.unit)} to ${formatValue(
                after.currentValue,
                after.unit
            )}`
        )
    }
    if (normalizeOkrNumber(after.targetValue) !== normalizeOkrNumber(before.targetValue)) {
        parts.push(
            `target from ${formatValue(before.targetValue, before.unit)} to ${formatValue(after.targetValue, after.unit)}`
        )
    }
    if ((after.unit || '') !== (before.unit || '')) {
        parts.push(`unit from ${before.unit || '(none)'} to ${after.unit || '(none)'}`)
    }
    if ((after.cadence || 'monthly') !== (before.cadence || 'monthly')) {
        parts.push(`cadence from ${before.cadence || 'monthly'} to ${after.cadence || 'monthly'}`)
    }
    const wasPrivate = isPrivateAudience(okrAudience(before))
    const isPrivate = isPrivateAudience(okrAudience(after))
    if (wasPrivate !== isPrivate) parts.push(isPrivate ? 'made private' : 'made visible to the project')
    if (parts.length === 0) return null
    const details = parts.join(', ')
    return `changed OKR ${quoteLabel(after.label)} • ${details.charAt(0).toUpperCase()}${details.slice(1)}`
}

function buildOkrToolFeeds({ db, projectId, feedUser, userId }) {
    const writeEntry = async ({ project, okr, feedType, entryText }) => {
        const audience = okrAudience(okr)
        if (audience.length === 0) return
        const { loadFeedsStateForContactWrite } = require('../shared/contactUpdateHelper')
        await loadFeedsStateForContactWrite({ db, projectId, feedUser, userId })
        const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
        const { createProjectEntryFeed } = require('../Feeds/projectEntryFeeds')
        const batch = new BatchWrapper(admin.firestore())
        await createProjectEntryFeed({
            projectId,
            project,
            feedType,
            entryText,
            isPublicFor: audience,
            extraFields: { okrId: okr.id },
            batch,
            feedUser,
        })
        await batch.commit()
    }

    return {
        async onOkrCreated(okr, project) {
            const { FEED_PROJECT_OKR_CREATED } = require('../Feeds/FeedsConstants')
            await writeEntry({ project, okr, feedType: FEED_PROJECT_OKR_CREATED, entryText: describeOkrCreated(okr) })
        },

        async onOkrUpdated(before, after, project) {
            const entryText = describeOkrUpdate(before, after)
            if (!entryText) return
            const { FEED_PROJECT_OKR_CHANGED } = require('../Feeds/FeedsConstants')
            await writeEntry({ project, okr: after, feedType: FEED_PROJECT_OKR_CHANGED, entryText })
        },
    }
}

// ---------------------------------------------------------------------------------------------
// Privacy follow-up
// ---------------------------------------------------------------------------------------------

const followedStorePath = (projectId, userId) => `feedsStore/${projectId}/${userId}/feeds/followed`

/**
 * Gives every stored entry of one OKR the OKR's current audience: the shared store, the project's
 * inner history and each member's followed store are rewritten, and a member who may no longer
 * read the OKR loses the entries from their followed store and their unread counters (a counter
 * holds a copy of the entry, label included). The same job objectFeedPrivacy.js does for objects
 * with a feed object of their own; it cannot be reused because its counter cleanup removes the
 * whole feed object's slot, which here is the project's and holds every other project entry too.
 */
async function reconcileOkrFeedPrivacy({ database, projectId, okrId, isPublicFor, projectUserIds }) {
    if (!projectId || !okrId || !Array.isArray(isPublicFor)) return { deleted: 0, updated: 0, counters: 0 }
    const { mergeFeedPrivacy, resolveFeedPrivacyReaders } = require('../Feeds/objectFeedPrivacy')
    const { BatchWrapper } = require('../BatchWrapper/batchWrapper')

    const { usersWithAccess, usersWithoutAccess } = resolveFeedPrivacyReaders(isPublicFor, projectUserIds)
    const entriesIn = path => database.collection(path).where('okrId', '==', okrId).get()
    const totals = { deleted: 0, updated: 0, counters: 0 }
    const batch = new BatchWrapper(database)

    const sharedPaths = [`feedsStore/${projectId}/all`, `projectsInnerFeeds/${projectId}/projects/${projectId}/feeds`]
    const feedIds = new Set()
    const rewrite = path =>
        entriesIn(path).then(snapshot => {
            snapshot.docs.forEach(feedDoc => {
                feedIds.add(feedDoc.id)
                batch.set(
                    database.doc(`${path}/${feedDoc.id}`),
                    { isPublicFor: mergeFeedPrivacy(feedDoc.data(), isPublicFor) },
                    { merge: true }
                )
                totals.updated++
            })
        })

    await Promise.all([
        ...sharedPaths.map(rewrite),
        ...usersWithAccess.map(userId => rewrite(followedStorePath(projectId, userId))),
        ...usersWithoutAccess.map(userId => {
            const path = followedStorePath(projectId, userId)
            return entriesIn(path).then(snapshot => {
                snapshot.docs.forEach(feedDoc => {
                    feedIds.add(feedDoc.id)
                    batch.delete(database.doc(`${path}/${feedDoc.id}`))
                    totals.deleted++
                })
            })
        }),
    ])

    if (feedIds.size > 0) {
        const removal = { projects: { [projectId]: {} } }
        feedIds.forEach(feedId => {
            removal.projects[projectId][feedId] = FieldValue.delete()
        })
        usersWithoutAccess.forEach(userId => {
            batch.set(database.doc(`feedsCount/${projectId}/${userId}/followed`), removal, { merge: true })
            batch.set(database.doc(`feedsCount/${projectId}/${userId}/all`), removal, { merge: true })
            totals.counters++
        })
    }

    if (totals.updated + totals.deleted + totals.counters > 0) await batch.commit()
    return totals
}

/**
 * The OKR update trigger's half: runs only when the update moved the OKR's audience, so an OKR whose
 * value changes every day costs nothing here.
 */
async function reconcileOkrFeedPrivacyOnUpdate({ database = admin.firestore(), projectId, okrId, before, after }) {
    const { hasFeedPrivacyChanged } = require('../Feeds/objectFeedPrivacy')
    if (!after || !hasFeedPrivacyChanged({ isPublicFor: okrAudience(before) }, { isPublicFor: okrAudience(after) })) {
        return null
    }
    const projectSnapshot = await database.doc(`projects/${projectId}`).get()
    if (!projectSnapshot.exists) return null
    return reconcileOkrFeedPrivacy({
        database,
        projectId,
        okrId,
        isPublicFor: okrAudience(after),
        projectUserIds: projectSnapshot.data()?.userIds,
    })
}

module.exports = {
    buildOkrToolFeeds,
    describeOkrCreated,
    describeOkrUpdate,
    okrAudience,
    reconcileOkrFeedPrivacy,
    reconcileOkrFeedPrivacyOnUpdate,
}
