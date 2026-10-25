'use strict'

const { getArtifactDocPath } = require('./artifactModel')

// What happened to an artifact, in order: who created it, who saved which version and how, who
// renamed it, shared it or reset its link (the artifact's "Updates", ARTIFACTS_PLAN.md §8). One
// document per event in `artifactItems/{projectId}/artifacts/{id}/history`, written only by Cloud
// Functions and readable by whoever may read the artifact (firestore.rules), so the timeline is a
// record the client cannot rewrite.
//
// Version events are written in the same transaction as the version itself; metadata edits, which
// a member makes straight in Firestore, are derived by the update trigger from before/after.

const ARTIFACT_HISTORY_TYPES = Object.freeze({
    CREATED: 'created',
    VERSION: 'version',
    RESTORED: 'restored',
    RENAMED: 'renamed',
    DESCRIPTION: 'description',
    MADE_PRIVATE: 'made_private',
    SHARED: 'shared',
    LINK_RESET: 'link_reset',
    LINK_ROTATED: 'link_rotated',
    DATA_ACCESS_ON: 'data_access_on',
    DATA_ACCESS_OFF: 'data_access_off',
})

const MAX_HISTORY_TEXT_CHARS = 200

function getArtifactHistoryCollectionPath(projectId, artifactId) {
    return `${getArtifactDocPath(projectId, artifactId)}/history`
}

const clip = value => String(value || '').slice(0, MAX_HISTORY_TEXT_CHARS)

function buildHistoryEvent(type, fields = {}) {
    const event = { type, date: Number(fields.date) || Date.now(), actorId: fields.actorId || '' }
    if (fields.assistantId) event.assistantId = fields.assistantId
    if (fields.versionId) event.versionId = fields.versionId
    if (fields.versionNumber) event.versionNumber = Number(fields.versionNumber)
    if (fields.source) event.source = fields.source
    if (fields.changeSummary) event.changeSummary = clip(fields.changeSummary)
    if (fields.from !== undefined) event.from = clip(fields.from)
    if (fields.to !== undefined) event.to = clip(fields.to)
    return event
}

// The events of a commit: the artifact's creation, or the new version it now shows.
function buildVersionHistoryEvent({ created, version, userId, now }) {
    return buildHistoryEvent(created ? ARTIFACT_HISTORY_TYPES.CREATED : ARTIFACT_HISTORY_TYPES.VERSION, {
        date: now,
        actorId: userId,
        assistantId: version.assistantId,
        versionId: version.id,
        versionNumber: version.versionNumber,
        source: version.source,
        changeSummary: version.changeSummary,
    })
}

// What a member changed in the artifact's own fields. A commit also rewrites the title or the
// description when it brings new ones; those belong to its version event, so an update that moved
// the current version records nothing here.
function buildMetadataHistoryEvents(before = {}, after = {}, now = Date.now()) {
    if (!before || !after) return []
    if (before.currentVersionId !== after.currentVersionId) return []
    const actorId = after.lastEditorId || ''
    const events = []
    if ((before.title || '') !== (after.title || '')) {
        events.push(
            buildHistoryEvent(ARTIFACT_HISTORY_TYPES.RENAMED, {
                date: now,
                actorId,
                from: before.title || '',
                to: after.title || '',
            })
        )
    }
    if ((before.description || '') !== (after.description || '')) {
        events.push(buildHistoryEvent(ARTIFACT_HISTORY_TYPES.DESCRIPTION, { date: now, actorId }))
    }
    if (before.isPrivate !== after.isPrivate && typeof after.isPrivate === 'boolean') {
        events.push(
            buildHistoryEvent(after.isPrivate ? ARTIFACT_HISTORY_TYPES.MADE_PRIVATE : ARTIFACT_HISTORY_TYPES.SHARED, {
                date: now,
                actorId,
            })
        )
    }
    return events
}

// Each trigger delivery writes under ids derived from its event id, so a redelivery overwrites
// instead of duplicating.
async function recordMetadataHistory({ db, projectId, artifactId, before, after, eventId, now = Date.now() }) {
    const events = buildMetadataHistoryEvents(before, after, now)
    if (events.length === 0) return 0
    const collectionPath = getArtifactHistoryCollectionPath(projectId, artifactId)
    const batch = db.batch()
    // Keyed by the trigger event, not by time: a redelivery of the same event overwrites itself.
    const suffix = eventId || `${now}-${Math.random().toString(36).slice(2, 10)}`
    events.forEach(event => batch.set(db.doc(`${collectionPath}/${suffix}-${event.type}`), event))
    await batch.commit()
    return events.length
}

function mapArtifactHistoryEvent(eventId, data = {}) {
    return {
        id: eventId,
        type: data.type || '',
        date: Number(data.date) || 0,
        actorId: data.actorId || '',
        assistantId: data.assistantId || null,
        versionId: data.versionId || null,
        versionNumber: Number(data.versionNumber) || 0,
        source: data.source || '',
        changeSummary: data.changeSummary || '',
        from: data.from || '',
        to: data.to || '',
    }
}

module.exports = {
    ARTIFACT_HISTORY_TYPES,
    MAX_HISTORY_TEXT_CHARS,
    buildHistoryEvent,
    buildMetadataHistoryEvents,
    buildVersionHistoryEvent,
    getArtifactHistoryCollectionPath,
    mapArtifactHistoryEvent,
    recordMetadataHistory,
}
