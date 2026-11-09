'use strict'

const { getActorChannelFields, isMcpActor } = require('../shared/mcpActor')

// How an artifact appears in the Updates feed. The server writes the entries (artifactFeeds.js) and
// the web client renders them (components/Feeds/FeedsObjects/ArtifactObject.js) and rebuilds a
// missing feed object from the artifact itself, so this module stays free of anything but the MCP
// actor helpers, which are dependency-free too.

// The feed object's `type`, and the objects-type key of the unread counters, the followers and the
// object's own Updates history (`projectsInnerFeeds/{projectId}/artifacts/{artifactId}`). The plural is
// the same key the artifact's chat and followers already use.
const ARTIFACT_FEED_OBJECT_TYPE = 'artifact'
const ARTIFACT_FEED_OBJECTS_TYPE = 'artifacts'

const FEED_PUBLIC_FOR_ALL = 0

// Who may read the artifact, and therefore its Updates entries. Artifacts written before
// `isPublicFor` existed fall back to their `isPrivate` flag, like mapArtifactData.
function getArtifactFeedReaders(artifact = {}) {
    if (Array.isArray(artifact.isPublicFor) && artifact.isPublicFor.length > 0) return [...artifact.isPublicFor]
    const ownerId = artifact.userId || artifact.creatorId || ''
    if (artifact.isPrivate === true) return ownerId ? [ownerId] : []
    return ownerId ? [FEED_PUBLIC_FOR_ALL, ownerId] : [FEED_PUBLIC_FOR_ALL]
}

function generateArtifactObjectModel(lastChangeDate, artifact = {}, artifactId, { isDeleted = false } = {}) {
    return {
        type: ARTIFACT_FEED_OBJECT_TYPE,
        lastChangeDate,
        artifactId,
        name: artifact.title || '',
        kind: artifact.kind || '',
        userId: artifact.userId || artifact.creatorId || '',
        isPublicFor: getArtifactFeedReaders(artifact),
        isDeleted: isDeleted === true,
    }
}

// One entry per artifact event, under an id derived from it (the history entry's id where there is
// one), so a retried write or a redelivered trigger overwrites the entry instead of adding a second.
// The id is also a key of the unread counters, so it keeps to characters a map key can hold.
function buildArtifactFeedId(artifactId, eventKey) {
    const safe = value => String(value || '').replace(/[^A-Za-z0-9_-]/g, '_')
    return `artifact_${safe(artifactId)}_${safe(eventKey)}`
}

// Who deleted an artifact. A deleted document carries no deleter, so whoever deletes stamps it
// first, in a write of its own (a batch would hand the delete trigger the document from before the
// batch): the app, and the delete tool for an assistant or an MCP client.
const ARTIFACT_DELETION_STAMP_FIELD = 'deletedBy'

function buildArtifactDeletionStamp({ userId, assistantId = null, actorChannel = null, now = Date.now() }) {
    const stamp = { userId: userId || '', date: Number(now) || Date.now() }
    if (isMcpActor(actorChannel)) return { ...stamp, ...getActorChannelFields(actorChannel) }
    if (assistantId) stamp.assistantId = assistantId
    return stamp
}

// An update that only stamps the deleter: the document is about to go, so nothing has to follow it.
function isArtifactDeletionStampOnly(before = {}, after = {}) {
    if (!before || !after) return false
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    const changed = [...keys].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    return changed.length > 0 && changed.every(key => key === ARTIFACT_DELETION_STAMP_FIELD)
}

module.exports = {
    ARTIFACT_DELETION_STAMP_FIELD,
    ARTIFACT_FEED_OBJECTS_TYPE,
    ARTIFACT_FEED_OBJECT_TYPE,
    buildArtifactDeletionStamp,
    buildArtifactFeedId,
    generateArtifactObjectModel,
    getArtifactFeedReaders,
    isArtifactDeletionStampOnly,
}
