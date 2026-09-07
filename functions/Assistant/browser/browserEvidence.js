'use strict'

// Evidence: the screenshot and the DOM/accessibility snapshot captured for a step, stored so that
// what the assistant saw can be checked afterwards rather than taken on trust.
//
// Both are uploaded to Firebase Storage under `browserEvidence/{runId}/{stepId}…` and referenced
// from the step's audit record by path, size and SHA-256. The hash is what makes the record
// evidence rather than a pointer: a snapshot whose hash does not match the stored object has been
// replaced.
//
// Redaction runs BEFORE the upload for the snapshot (it is text, and it is going to be read back
// into a conversation). A screenshot cannot be redacted this way — it is pixels — so it is treated
// as the more sensitive of the two: kept out of the model's context, referenced by URL only, and
// stored in a bucket path nothing else reads. That asymmetry is deliberate and documented in the
// threat model; a page that shows personal data will show it in the screenshot.

const crypto = require('crypto')

const { redactForModel } = require('./browserRedaction')

const EVIDENCE_PREFIX = 'browserEvidence'
const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex')
}

function buildDownloadUrl(bucketName, objectPath, token) {
    return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`
}

async function uploadEvidenceObject(bucket, objectPath, buffer, contentType) {
    const token = crypto.randomUUID()
    const file = bucket.file(objectPath)
    await file.save(buffer, {
        contentType,
        resumable: false,
        metadata: {
            contentType,
            cacheControl: 'private, max-age=0, no-transform',
            metadata: { firebaseStorageDownloadTokens: token },
        },
    })
    return {
        path: objectPath,
        url: buildDownloadUrl(bucket.name, objectPath, token),
        bytes: buffer.length,
        sha256: sha256(buffer),
    }
}

/**
 * Store whatever evidence the step produced. Never throws: evidence is a record of browsing that
 * has already happened, and failing the tool call because a bucket write failed would turn a
 * successful page read into an error the user cannot act on. A failure is reported in the returned
 * object so the audit record says the evidence is missing instead of silently omitting it.
 */
async function storeBrowserEvidence({ bucket, runId, stepId, screenshotBase64 = '', snapshot = null }) {
    const result = { screenshot: null, snapshot: null, errors: [] }
    if (!bucket || !runId || !stepId) {
        if (screenshotBase64 || snapshot) result.errors.push('no_storage_bucket')
        return result
    }

    if (screenshotBase64) {
        try {
            const buffer = Buffer.from(String(screenshotBase64), 'base64')
            if (buffer.length > MAX_SCREENSHOT_BYTES) {
                result.errors.push('screenshot_too_large')
            } else {
                result.screenshot = await uploadEvidenceObject(
                    bucket,
                    `${EVIDENCE_PREFIX}/${runId}/${stepId}-screenshot.png`,
                    buffer,
                    'image/png'
                )
            }
        } catch (error) {
            console.warn('🌐 BROWSER EVIDENCE: screenshot upload failed', { runId, stepId, error: error.message })
            result.errors.push('screenshot_upload_failed')
        }
    }

    if (snapshot) {
        try {
            const serialized = JSON.stringify(snapshot)
            const redacted = redactForModel(serialized)
            const buffer = Buffer.from(redacted, 'utf8')
            if (buffer.length > MAX_SNAPSHOT_BYTES) {
                result.errors.push('snapshot_too_large')
            } else {
                result.snapshot = await uploadEvidenceObject(
                    bucket,
                    `${EVIDENCE_PREFIX}/${runId}/${stepId}-snapshot.json`,
                    buffer,
                    'application/json'
                )
            }
        } catch (error) {
            console.warn('🌐 BROWSER EVIDENCE: snapshot upload failed', { runId, stepId, error: error.message })
            result.errors.push('snapshot_upload_failed')
        }
    }

    return result
}

/** The default bucket, resolved lazily so this module can be required without firebase-admin. */
function getDefaultEvidenceBucket() {
    try {
        const admin = require('firebase-admin')
        return admin.storage().bucket()
    } catch (error) {
        console.warn('🌐 BROWSER EVIDENCE: no storage bucket available', { error: error.message })
        return null
    }
}

module.exports = {
    EVIDENCE_PREFIX,
    MAX_SCREENSHOT_BYTES,
    MAX_SNAPSHOT_BYTES,
    buildDownloadUrl,
    getDefaultEvidenceBucket,
    sha256,
    storeBrowserEvidence,
}
