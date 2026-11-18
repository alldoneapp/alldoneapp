'use strict'

// The one place the profile text changes: a nightly run, the user's own edit in the settings, or a
// restore of an older version. Each change is a revision document, created in the same transaction
// that moves the profile to it, so the history never misses a version and two writers of the same
// version cannot both win (the revision id is derived from its number and created, not set).
//
// A run only writes over the version it read (expectedRevision). When the user edited the profile
// while the run was thinking, the run's text is dropped: it was written against text the user has
// since replaced, and the next night starts from the user's version.

const {
    ASSISTANT_PROFILE_MAX_CHARS,
    ASSISTANT_PROFILE_REVISION_MODES,
    ASSISTANT_PROFILE_SUMMARY_MAX_CHARS,
    getAssistantProfilePath,
    getAssistantProfileRevisionId,
    getAssistantProfileRevisionsPath,
    normalizeAssistantProfileText,
} = require('./assistantProfileModel')

function clip(value, maxChars) {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
    return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text
}

async function writeAssistantProfileText({
    db,
    userId,
    text,
    mode,
    summary = '',
    runId = null,
    model = null,
    expectedRevision = null,
    restoredFromRevision = null,
    now = Date.now(),
}) {
    if (!userId) throw new Error('userId is required')
    if (!ASSISTANT_PROFILE_REVISION_MODES.includes(mode)) throw new Error(`Unknown revision mode "${mode}"`)
    const nextText = normalizeAssistantProfileText(text)
    if (nextText.length > ASSISTANT_PROFILE_MAX_CHARS) {
        return {
            success: false,
            reason: 'too_long',
            error: `The profile may be at most ${ASSISTANT_PROFILE_MAX_CHARS} characters; this one has ${nextText.length}.`,
        }
    }

    const profileRef = db.doc(getAssistantProfilePath(userId))
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(profileRef)
        const current = snapshot.exists ? snapshot.data() || {} : {}
        const currentRevision = Number.isFinite(current.revision) ? current.revision : 0
        if (expectedRevision !== null && expectedRevision !== currentRevision) {
            return { success: false, reason: 'conflict', revision: currentRevision }
        }
        const previousText = normalizeAssistantProfileText(current.text)
        if (previousText === nextText) return { success: true, unchanged: true, revision: currentRevision }

        const revision = currentRevision + 1
        const revisionId = getAssistantProfileRevisionId(revision)
        transaction.create(db.doc(`${getAssistantProfileRevisionsPath(userId)}/${revisionId}`), {
            revision,
            mode,
            text: nextText,
            previousText,
            summary: clip(summary, ASSISTANT_PROFILE_SUMMARY_MAX_CHARS),
            runId,
            model,
            ...(Number.isFinite(restoredFromRevision) ? { restoredFromRevision } : {}),
            createdAt: now,
        })
        transaction.set(
            profileRef,
            {
                userId,
                text: nextText,
                revision,
                textUpdatedAt: now,
                textUpdatedBy: mode,
                updatedAt: now,
            },
            { merge: true }
        )
        return { success: true, revision, revisionId }
    })
}

module.exports = {
    writeAssistantProfileText,
}
