'use strict'

const admin = require('firebase-admin')
const moment = require('moment')

const {
    FEED_ARTIFACT_CREATED,
    FEED_ARTIFACT_DATA_ACCESS_CHANGED,
    FEED_ARTIFACT_DELETED,
    FEED_ARTIFACT_DESCRIPTION_CHANGED,
    FEED_ARTIFACT_PRIVACY_CHANGED,
    FEED_ARTIFACT_PUBLIC_LINK_CHANGED,
    FEED_ARTIFACT_TITLE_CHANGED,
    FEED_ARTIFACT_VERSION_RESTORED,
    FEED_ARTIFACT_VERSION_SAVED,
} = require('../Feeds/FeedsConstants')
const { ARTIFACT_HISTORY_TYPES, buildMetadataHistoryEvents } = require('./artifactHistory')
const {
    ARTIFACT_DELETION_STAMP_FIELD,
    ARTIFACT_FEED_OBJECTS_TYPE,
    buildArtifactFeedId,
    generateArtifactObjectModel,
    getArtifactFeedReaders,
} = require('./artifactFeedModel')
const { getActorChannelFields, isMcpActor } = require('../shared/mcpActor')

/**
 * Updates-feed entries for artifacts, from every source: an upload in the app, an assistant's tool,
 * an MCP client and a VM job alike (all of them write through artifactStore.js).
 *
 * Each entry belongs to one event of the artifact's own history (artifactHistory.js) and is written
 * where that event is: a version, a restore, the public link and live data right after their own
 * transaction, a rename, a new description and a change of audience from the update trigger, and a
 * deletion from the delete trigger. Its id is derived from the history entry's id (or the trigger
 * event), so a retried write or a redelivered trigger overwrites the entry instead of adding one.
 *
 * The actor is the user who made the change, with the MCP marker when an MCP client made it in their
 * name ("Karsten Wysk (via Claude)"), or the assistant whose tool made it.
 *
 * An entry is readable exactly as the artifact is: it carries the artifact's `isPublicFor`, the
 * projection triggers derive `readerIds` from it, and a change of audience re-privatises the
 * existing entries (Feeds/objectFeedPrivacy.js) and the day cards (reconcileArtifactFeedObjectsPrivacy).
 * No `feedsObjectsLastStates` copy is kept: every member may read that collection, and the client
 * rebuilds a missing card from the artifact, which only its readers can read.
 *
 * Best effort: a feed failure is logged and never fails the artifact write it describes.
 */

const SHORT_TEXT_CHARS = 50

function shorten(text) {
    const { shrinkTagText } = require('../Utils/parseTextUtils')
    return shrinkTagText(
        String(text || '')
            .replace(/\s+/g, ' ')
            .trim(),
        SHORT_TEXT_CHARS
    )
}

const SIMPLE_EVENT_TEXTS = {
    [ARTIFACT_HISTORY_TYPES.CREATED]: [FEED_ARTIFACT_CREATED, 'created artifact'],
    [ARTIFACT_HISTORY_TYPES.MADE_PRIVATE]: [FEED_ARTIFACT_PRIVACY_CHANGED, 'made artifact private'],
    [ARTIFACT_HISTORY_TYPES.SHARED]: [FEED_ARTIFACT_PRIVACY_CHANGED, 'shared artifact with the project'],
    [ARTIFACT_HISTORY_TYPES.PUBLIC_LINK_ON]: [FEED_ARTIFACT_PUBLIC_LINK_CHANGED, 'switched the public link on'],
    [ARTIFACT_HISTORY_TYPES.PUBLIC_LINK_OFF]: [FEED_ARTIFACT_PUBLIC_LINK_CHANGED, 'switched the public link off'],
    [ARTIFACT_HISTORY_TYPES.PUBLIC_LINK_CHANGED]: [
        FEED_ARTIFACT_PUBLIC_LINK_CHANGED,
        'replaced the public link with a new one',
    ],
    [ARTIFACT_HISTORY_TYPES.DATA_ACCESS_ON]: [FEED_ARTIFACT_DATA_ACCESS_CHANGED, 'switched live project data on'],
    [ARTIFACT_HISTORY_TYPES.DATA_ACCESS_OFF]: [FEED_ARTIFACT_DATA_ACCESS_CHANGED, 'switched live project data off'],
}

/**
 * The feed type and English entry text of a history event, or null for the events nobody decided:
 * a serve address rotated because somebody lost access, a public link that ended because the
 * artifact was made private (its own entry says so), and the legacy "Reset link".
 */
function describeArtifactEvent(event = {}, { fromDescription = '', toDescription = '' } = {}) {
    const simple = SIMPLE_EVENT_TEXTS[event.type]
    if (simple) return { feedType: simple[0], entryText: simple[1] }
    const versionNumber = Number(event.versionNumber) || 0
    switch (event.type) {
        case ARTIFACT_HISTORY_TYPES.VERSION: {
            const saved = versionNumber ? `saved version ${versionNumber}` : 'saved a new version'
            const summary = shorten(event.changeSummary)
            return { feedType: FEED_ARTIFACT_VERSION_SAVED, entryText: summary ? `${saved} • ${summary}` : saved }
        }
        case ARTIFACT_HISTORY_TYPES.RESTORED:
            return {
                feedType: FEED_ARTIFACT_VERSION_RESTORED,
                entryText: versionNumber ? `restored version ${versionNumber}` : 'restored an earlier version',
            }
        case ARTIFACT_HISTORY_TYPES.RENAMED:
            return {
                feedType: FEED_ARTIFACT_TITLE_CHANGED,
                entryText: `renamed artifact • From ${shorten(event.from)} to ${shorten(event.to)}`,
            }
        case ARTIFACT_HISTORY_TYPES.DESCRIPTION: {
            const from = shorten(fromDescription)
            const to = shorten(toDescription)
            const entryText = !from
                ? `added artifact description • ${to}`
                : !to
                  ? 'removed artifact description'
                  : `changed artifact description • From ${from} to ${to}`
            return { feedType: FEED_ARTIFACT_DESCRIPTION_CHANGED, entryText }
        }
        default:
            return null
    }
}

/**
 * Who the entry names: the user with the MCP marker when an MCP client acted in their name, the
 * assistant when its tool did, the user otherwise. Null when nobody acted (an automatic event).
 */
function resolveArtifactFeedActor(event = {}) {
    const actorId = typeof event.actorId === 'string' ? event.actorId : ''
    if (actorId && isMcpActor(event)) return { uid: actorId, id: actorId, ...getActorChannelFields(event) }
    if (event.assistantId && typeof event.assistantId === 'string') {
        return { uid: event.assistantId, id: event.assistantId }
    }
    return actorId ? { uid: actorId, id: actorId } : null
}

function buildEntry(artifactId, eventKey, event, details) {
    const description = describeArtifactEvent(event, details)
    const actor = resolveArtifactFeedActor(event)
    if (!description || !actor) return null
    return {
        ...description,
        actor,
        date: Number(event.date) || Date.now(),
        feedId: buildArtifactFeedId(artifactId, eventKey),
    }
}

// The fan-out writes through the Admin SDK's own Firestore (Feeds/globalFeedsHelper.js). A caller
// working on another database (an in-memory double) therefore gets no entries rather than entries
// written somewhere its artifact is not.
function usesAdminFirestore(db) {
    try {
        return !!db && db === admin.firestore()
    } catch (error) {
        return false
    }
}

async function readProjectUserIds(db, projectId) {
    const snapshot = await db.doc(`projects/${projectId}`).get()
    const userIds = snapshot.exists ? snapshot.data()?.userIds : []
    return Array.isArray(userIds) ? userIds : []
}

// The artifact's followers get the entry in their Followed tab, as far as they may read it.
function getReadingFollowers(artifact, readers) {
    const followers = Array.isArray(artifact.followersIds)
        ? artifact.followersIds.filter(id => typeof id === 'string' && id)
        : []
    return readers.includes(0) ? followers : followers.filter(id => readers.includes(id))
}

/**
 * Writes the given entries for one artifact, in one batch. Resolves with the number written; never
 * rejects.
 */
async function writeArtifactFeedEntries({
    db = admin.firestore(),
    projectId,
    artifactId,
    artifact,
    entries,
    projectUserIds = null,
    isDeleted = false,
}) {
    const pending = (entries || []).filter(Boolean)
    if (!projectId || !artifactId || !artifact || pending.length === 0) return 0
    if (!usesAdminFirestore(db)) return 0
    try {
        const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
        const {
            generateFeedModel,
            insertFollowersUserToFeedChain,
            proccessFeed,
        } = require('../Feeds/globalFeedsHelper')

        const userIds = Array.isArray(projectUserIds) ? projectUserIds : await readProjectUserIds(db, projectId)
        const readers = getArtifactFeedReaders(artifact)
        const batch = new BatchWrapper(db)
        insertFollowersUserToFeedChain(getReadingFollowers(artifact, readers), artifactId, batch)

        for (const entry of pending) {
            const feedObject = generateArtifactObjectModel(entry.date, artifact, artifactId, { isDeleted })
            const { feed } = generateFeedModel({
                feedType: entry.feedType,
                lastChangeDate: entry.date,
                entryText: entry.entryText,
                feedUser: entry.actor,
                objectId: artifactId,
                isPublicFor: feedObject.isPublicFor,
            })
            await proccessFeed(
                projectId,
                moment(entry.date).format('DDMMYYYY'),
                [],
                artifactId,
                ARTIFACT_FEED_OBJECTS_TYPE,
                feedObject,
                entry.feedId,
                feed,
                entry.actor,
                batch,
                true,
                // Explicit context instead of the per-instance feed state: nothing here reads it.
                { feedCreator: entry.actor, project: { userIds }, skipObjectLastState: true }
            )
        }
        await batch.commit()
        return pending.length
    } catch (error) {
        console.warn('[artifacts] Could not write the Updates entry', {
            projectId,
            artifactId,
            feedTypes: pending.map(entry => entry.feedType),
            error: error.message,
        })
        return 0
    }
}

/**
 * The entry of one history event an artifact write produced (a version, a restore, the public link,
 * live data), keyed by that history entry's id.
 */
function recordArtifactHistoryFeed({ db, projectId, artifactId, artifact, historyId, event, projectUserIds }) {
    return writeArtifactFeedEntries({
        db,
        projectId,
        artifactId,
        artifact,
        projectUserIds,
        entries: [buildEntry(artifactId, historyId, event)],
    })
}

/**
 * The entries of what a member (or a tool, in their name) changed in the artifact's own fields,
 * derived from the update exactly like its history entries and keyed by the same trigger event.
 */
function recordArtifactMetadataFeeds({ db, projectId, artifactId, before, after, eventId, now = Date.now() }) {
    const events = buildMetadataHistoryEvents(before, after, now)
    if (events.length === 0) return Promise.resolve(0)
    const key = eventId || String(now)
    const details = { fromDescription: before?.description, toDescription: after?.description }
    return writeArtifactFeedEntries({
        db,
        projectId,
        artifactId,
        artifact: after,
        entries: events.map(event => buildEntry(artifactId, `${key}-${event.type}`, event, details)),
    })
}

/**
 * The deletion, named after whoever stamped the artifact before deleting it (artifactFeedModel.js).
 * An artifact deleted without a stamp (a whole project going, an app from before the stamp) gets no
 * entry rather than one that names a guess.
 */
function recordArtifactDeletedFeed({ db, projectId, artifactId, artifact, now = Date.now() }) {
    const stamp = artifact && artifact[ARTIFACT_DELETION_STAMP_FIELD]
    if (!stamp || typeof stamp.userId !== 'string' || !stamp.userId) return Promise.resolve(0)
    const actor = resolveArtifactFeedActor({ ...stamp, actorId: stamp.userId })
    return writeArtifactFeedEntries({
        db,
        projectId,
        artifactId,
        artifact,
        isDeleted: true,
        entries: [
            {
                feedType: FEED_ARTIFACT_DELETED,
                entryText: 'deleted artifact',
                actor,
                date: Number(now) || Date.now(),
                feedId: buildArtifactFeedId(artifactId, 'deleted'),
            },
        ],
    })
}

/**
 * The day cards (`projectsFeeds/{projectId}/{day}/{artifactId}`) follow a change of audience too.
 * objectFeedPrivacy.js re-privatises the entries; a card of an earlier day would otherwise keep the
 * old audience: the title readable by members who lost the artifact, or a card members who just got
 * it cannot open. The days come from the artifact's own Updates history.
 */
async function reconcileArtifactFeedObjectsPrivacy({ db = admin.firestore(), projectId, artifactId, before, after }) {
    const { hasFeedPrivacyChanged } = require('../Feeds/objectFeedPrivacy')
    if (!projectId || !artifactId || !after || !hasFeedPrivacyChanged(before, after)) return 0
    const readers = getArtifactFeedReaders(after)
    const inner = await db
        .collection(`projectsInnerFeeds/${projectId}/${ARTIFACT_FEED_OBJECTS_TYPE}/${artifactId}/feeds`)
        .get()
    const days = new Set()
    inner.docs.forEach(doc => {
        const lastChangeDate = Number(doc.data()?.lastChangeDate)
        if (lastChangeDate) days.add(moment(lastChangeDate).format('DDMMYYYY'))
    })
    if (days.size === 0) return 0
    const refs = [...days].map(day => db.doc(`projectsFeeds/${projectId}/${day}/${artifactId}`))
    const snapshots = await Promise.all(refs.map(ref => ref.get()))
    const batch = db.batch()
    let updated = 0
    snapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) return
        batch.set(refs[index], { isPublicFor: readers }, { merge: true })
        updated++
    })
    if (updated > 0) await batch.commit()
    return updated
}

module.exports = {
    describeArtifactEvent,
    reconcileArtifactFeedObjectsPrivacy,
    recordArtifactDeletedFeed,
    recordArtifactHistoryFeed,
    recordArtifactMetadataFeeds,
    resolveArtifactFeedActor,
    writeArtifactFeedEntries,
}
