'use strict'

const admin = require('firebase-admin')

const { ARTIFACT_KINDS, getArtifactFileStoragePath } = require('./artifactModel')
const { ARTIFACTS_COLLECTION } = require('../typesenseHelper')

// Search for artifacts (ARTIFACTS_PLAN.md §6): one Typesense document per artifact, in its own
// collection, with the same `projectId` + `isPublicFor` access fields every other collection
// carries — so the scoped search key's embedded filter (functions/Typesense/
// scopedSearchCredentials.js) restricts it exactly like notes, and a private artifact is only
// ever found by its owner.
//
// The text of the entry file is indexed for the kinds that are text, so "the dashboard with the
// churn numbers" is found by what it says, not only by its title. It is stored for matching and
// never returned: the client excludes `content` from every response.

const ARTIFACTS_SEARCH_COLLECTION = ARTIFACTS_COLLECTION
const SEARCHABLE_TEXT_KINDS = [ARTIFACT_KINDS.WEB, ARTIFACT_KINDS.MARKDOWN, ARTIFACT_KINDS.TEXT, ARTIFACT_KINDS.DATA]
const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_INDEXED_CHARS = 20000

// Fields whose change changes what a search should find or who may find it. Anything else (a
// comment preview, a follower, the chat assistant) is not worth a re-index.
const INDEXED_FIELDS = [
    'title',
    'description',
    'currentVersionId',
    'entryPath',
    'kind',
    'isPublicFor',
    'isPrivate',
    'userId',
    'lastEditionDate',
]

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function htmlToText(html) {
    return String(html || '')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, name) => {
            if (name[0] === '#') {
                const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1))
                return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' '
            }
            return HTML_ENTITIES[name.toLowerCase()] || ' '
        })
}

function normalizeSearchText(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_INDEXED_CHARS)
}

function isWebEntry(artifact) {
    return artifact.kind === ARTIFACT_KINDS.WEB || /\.html?$/i.test(String(artifact.entryPath || ''))
}

// The searchable text of an artifact's current entry file, or '' when it has none (an image, a
// PDF, a file too large to read on every edit). Never throws: search is a convenience, and a
// failed read must not fail the trigger that hosts it.
async function extractArtifactSearchText({ bucket, projectId, artifactId, artifact }) {
    if (!artifact || !artifact.currentVersionId || !artifact.entryPath) return ''
    if (!SEARCHABLE_TEXT_KINDS.includes(artifact.kind)) return ''
    try {
        const file = bucket.file(
            getArtifactFileStoragePath(projectId, artifactId, artifact.currentVersionId, artifact.entryPath)
        )
        const [metadata] = await file.getMetadata()
        if (Number(metadata?.size) > MAX_SOURCE_BYTES) return ''
        const [bytes] = await file.download()
        const text = bytes.toString('utf8')
        return normalizeSearchText(isWebEntry(artifact) ? htmlToText(text) : text)
    } catch (error) {
        console.warn('[artifacts] Could not read the entry file for search', {
            projectId,
            artifactId,
            error: error.message,
        })
        return ''
    }
}

function toMillis(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
    if (value && typeof value.toMillis === 'function') return value.toMillis()
    return undefined
}

function buildArtifactSearchRecord({ projectId, artifactId, artifact, content = '' }) {
    const isPublicFor = Array.isArray(artifact.isPublicFor) ? artifact.isPublicFor : []
    return {
        objectID: `${artifactId}${projectId}`,
        projectId,
        title: String(artifact.title || ''),
        description: String(artifact.description || ''),
        content: content || '',
        kind: artifact.kind || ARTIFACT_KINDS.FILE,
        mimeType: artifact.mimeType || '',
        entryPath: artifact.entryPath || '',
        source: artifact.source || '',
        userId: artifact.userId || '',
        creatorId: artifact.creatorId || '',
        isPublicFor,
        isPrivate: artifact.isPrivate === true,
        lastEditionDate: toMillis(artifact.lastEditionDate) || toMillis(artifact.created),
        created: toMillis(artifact.created),
        versionCount: Number(artifact.versionCount) || 0,
    }
}

function artifactSearchUpdateNeeded(before = {}, after = {}) {
    return INDEXED_FIELDS.some(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
}

async function indexArtifactForSearch({
    projectId,
    artifactId,
    artifact,
    bucket = admin.storage().bucket(),
    typesense = require('../typesenseHelper'),
}) {
    if (!typesense.isTypesenseConfigured()) return
    const content = await extractArtifactSearchText({ bucket, projectId, artifactId, artifact })
    await typesense.upsertTypesenseDocument(
        ARTIFACTS_SEARCH_COLLECTION,
        buildArtifactSearchRecord({ projectId, artifactId, artifact, content })
    )
}

async function removeArtifactFromSearch({ projectId, artifactId, typesense = require('../typesenseHelper') }) {
    await typesense.deleteTypesenseDocument(ARTIFACTS_SEARCH_COLLECTION, `${artifactId}${projectId}`)
}

// The backfill (migration/backfillTypesense.js): every artifact of one project.
async function buildProjectArtifactSearchRecords({
    projectId,
    db = admin.firestore(),
    bucket = admin.storage().bucket(),
}) {
    const snapshot = await db.collection(`artifactItems/${projectId}/artifacts`).get()
    const records = []
    for (const doc of snapshot.docs) {
        const artifact = doc.data() || {}
        const content = await extractArtifactSearchText({ bucket, projectId, artifactId: doc.id, artifact })
        records.push(buildArtifactSearchRecord({ projectId, artifactId: doc.id, artifact, content }))
    }
    return records
}

module.exports = {
    ARTIFACTS_SEARCH_COLLECTION,
    INDEXED_FIELDS,
    MAX_INDEXED_CHARS,
    artifactSearchUpdateNeeded,
    buildArtifactSearchRecord,
    buildProjectArtifactSearchRecords,
    extractArtifactSearchText,
    htmlToText,
    indexArtifactForSearch,
    removeArtifactFromSearch,
}
