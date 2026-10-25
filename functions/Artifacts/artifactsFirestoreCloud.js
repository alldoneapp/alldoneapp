const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')

const { getArtifactDocPath } = require('./artifactModel')

// The parent-object side of an artifact's chat, the same three writes every other commentable object
// has (see Skills/skillsFirestore.js). Each runs in a transaction that skips a deleted artifact, so a
// comment arriving after a delete cannot recreate the document.

async function updateIfExists(projectId, artifactId, patch) {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(getArtifactDocPath(projectId, artifactId))
            const artifactDoc = await transaction.get(ref)
            if (artifactDoc.exists) transaction.update(ref, patch)
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const updateArtifactEditionData = (projectId, artifactId, editorId) =>
    updateIfExists(projectId, artifactId, { lastEditionDate: Date.now(), lastEditorId: editorId })

const updateArtifactLastCommentData = (projectId, artifactId, lastComment, lastCommentType) =>
    updateIfExists(projectId, artifactId, {
        [`commentsData.lastComment`]: lastComment,
        [`commentsData.lastCommentType`]: lastCommentType,
        [`commentsData.amount`]: FieldValue.increment(1),
    })

const resetArtifactLastCommentData = (projectId, artifactId) =>
    updateIfExists(projectId, artifactId, {
        [`commentsData.lastComment`]: null,
        [`commentsData.lastCommentType`]: null,
        [`commentsData.amount`]: 0,
    })

module.exports = {
    resetArtifactLastCommentData,
    updateArtifactEditionData,
    updateArtifactLastCommentData,
}
