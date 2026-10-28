'use strict'

const admin = require('firebase-admin')
const { createHash } = require('crypto')

const { canAccessObject } = require('../shared/privacyAccess')
const { commitArtifactVersion } = require('./artifactStore')
const { buildArtifactAppUrl, isThreadPrivate } = require('./artifactAssistant')
const {
    ARTIFACT_SOURCES,
    MAX_ARTIFACT_FILES,
    MAX_ARTIFACT_UPLOAD_BYTES,
    getArtifactsCollectionPath,
    normalizeArtifactPath,
} = require('./artifactModel')

// VM deliverables become artifacts (decision 3 of ARTIFACTS_PLAN.md). What the agent wrote to
// /home/user/output is grouped into artifacts:
//
//   - a top-level folder holding an index.html is one web bundle (its relative links keep working),
//   - an index.html at the top level makes the whole output one bundle,
//   - every other file is an artifact of its own.
//
// An artifact is keyed on its output path within its thread (`vmOutputKey`), so the next run in the
// same thread that writes the same folder or file saves version 2 instead of a second copy. Only
// groups the run actually touched are published, and a touched bundle is always published whole,
// because a version is a complete snapshot.

const MAX_VM_ARTIFACTS_PER_RUN = 10
const MODIFIED_SKEW_MS = 5000

function toOutputEntry(entry, outputDir) {
    const prefix = `${outputDir.replace(/\/+$/, '')}/`
    const rawPath =
        typeof entry.path === 'string' && entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.name
    let relativePath
    try {
        relativePath = normalizeArtifactPath(rawPath)
    } catch (_) {
        return null
    }
    return {
        relativePath,
        size: Number(entry.size) || 0,
        modifiedMs: entry.modifiedTime ? new Date(entry.modifiedTime).getTime() || 0 : 0,
    }
}

function isChangedSince(entry, sinceMs) {
    return !sinceMs || entry.modifiedMs === 0 || entry.modifiedMs >= sinceMs - MODIFIED_SKEW_MS
}

// Pure: which artifacts this run produced, from a listing of the output directory.
function planVmOutputArtifacts(listing, { outputDir = '/home/user/output', sinceMs = 0 } = {}) {
    const entries = (Array.isArray(listing) ? listing : [])
        .filter(entry => (entry.type === 'file' || entry.type === undefined) && Number(entry.size) > 0)
        .map(entry => toOutputEntry(entry, outputDir))
        .filter(Boolean)

    const groups = new Map()
    const addTo = (outputPath, base, entry) => {
        if (!groups.has(outputPath)) groups.set(outputPath, { outputPath, isBundle: base !== null, entries: [] })
        // A bundle keeps its inner layout; a single file is stored under its own name.
        const path =
            base === null
                ? entry.relativePath.split('/').pop()
                : base
                  ? entry.relativePath.slice(base.length + 1)
                  : entry.relativePath
        groups.get(outputPath).entries.push({ ...entry, path })
    }

    const rootIsSite = entries.some(entry => entry.relativePath === 'index.html')
    const bundleFolders = new Set(
        entries
            .map(entry => entry.relativePath.split('/'))
            .filter(parts => parts.length === 2 && parts[1] === 'index.html')
            .map(parts => parts[0])
    )

    for (const entry of entries) {
        const topFolder = entry.relativePath.includes('/') ? entry.relativePath.split('/')[0] : null
        if (topFolder && bundleFolders.has(topFolder) && !rootIsSite) addTo(`${topFolder}/`, topFolder, entry)
        else if (rootIsSite) addTo('/', '', entry)
        else addTo(entry.relativePath, null, entry)
    }

    return [...groups.values()]
        .filter(group => group.entries.some(entry => isChangedSince(entry, sinceMs)))
        .filter(group => {
            const bytes = group.entries.reduce((sum, entry) => sum + entry.size, 0)
            return bytes <= MAX_ARTIFACT_UPLOAD_BYTES && group.entries.length <= MAX_ARTIFACT_FILES
        })
        .slice(0, MAX_VM_ARTIFACTS_PER_RUN)
        .map(group => ({
            outputPath: group.outputPath,
            isBundle: group.isBundle,
            title: group.isBundle && group.outputPath !== '/' ? group.outputPath.replace(/\/$/, '') : null,
            files: group.entries.map(entry => ({ relativePath: entry.relativePath, path: entry.path })),
        }))
}

// A web bundle is named after its page title when it has one; "index" says nothing.
function readHtmlTitle(file) {
    if (!file) return ''
    const html = Buffer.from(file.base64, 'base64').toString('utf8', 0, 64 * 1024)
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    return match ? match[1].replace(/\s+/g, ' ').trim() : ''
}

function buildVmOutputKey({ objectType, objectId }, outputPath) {
    return `${objectType || 'tasks'}/${objectId}/${outputPath}`
}

async function findThreadArtifact(db, projectId, userId, vmOutputKey) {
    const snapshot = await db
        .collection(getArtifactsCollectionPath(projectId))
        .where('vmOutputKey', '==', vmOutputKey)
        .limit(5)
        .get()
    const doc = snapshot.docs.find(candidate => canAccessObject(candidate.data() || {}, userId))
    return doc ? doc.id : null
}

async function identicalCurrentVersion(db, projectId, artifactId, files) {
    if (!artifactId) return null
    const artifact = await db.doc(`${getArtifactsCollectionPath(projectId)}/${artifactId}`).get()
    const versionId = artifact.data()?.currentVersionId
    if (!versionId) return null
    const version = await db.doc(`${getArtifactsCollectionPath(projectId)}/${artifactId}/versions/${versionId}`).get()
    const stored = version.data()?.files || []
    if (
        stored.length !== files.length ||
        !files.every(file =>
            stored.some(
                previous =>
                    previous.path === file.path &&
                    previous.sha256 === createHash('sha256').update(Buffer.from(file.base64, 'base64')).digest('hex')
            )
        )
    )
        return null
    return { artifactId, versionNumber: version.data().versionNumber, created: false, unchanged: true }
}

// Publishes the planned groups. `readFile(relativePath)` returns the bytes. Best effort per group:
// a failure is logged and the rest still publish, and nothing here can fail the VM run.
async function publishVmOutputArtifacts({
    job,
    groups,
    readFile,
    db = admin.firestore(),
    bucket = admin.storage().bucket(),
    baseUrl,
}) {
    const { projectId, objectType, objectId, requestUserId, assistantId, correlationId } = job || {}
    if (!projectId || !objectId || !requestUserId || !Array.isArray(groups) || groups.length === 0) return []

    let threadPrivate = null
    const published = []
    for (const group of groups) {
        try {
            const files = []
            for (const file of group.files) {
                const bytes = await readFile(file.relativePath)
                files.push({ path: file.path, base64: Buffer.from(bytes).toString('base64') })
            }
            const vmOutputKey = buildVmOutputKey({ objectType, objectId }, group.outputPath)
            const entryFile = group.isBundle ? files.find(file => file.path === 'index.html') : null
            const existingId = await findThreadArtifact(db, projectId, requestUserId, vmOutputKey)
            if (!existingId && threadPrivate === null) {
                threadPrivate = await isThreadPrivate(db, { projectId, objectType, objectId })
            }
            const result =
                (await identicalCurrentVersion(db, projectId, existingId, files)) ||
                (await commitArtifactVersion({
                    db,
                    bucket,
                    userId: requestUserId,
                    projectId,
                    artifactId: existingId,
                    files,
                    title: existingId ? undefined : readHtmlTitle(entryFile) || group.title || undefined,
                    isPrivate: threadPrivate === true,
                    changeSummary: existingId ? 'Updated by a VM run' : undefined,
                    source: ARTIFACT_SOURCES.VM,
                    parentObject: { type: objectType || 'tasks', id: objectId, projectId },
                    assistantId: assistantId || null,
                    vmOutputKey,
                }))
            const snapshot = await db.doc(`${getArtifactsCollectionPath(projectId)}/${result.artifactId}`).get()
            published.push({
                artifactId: result.artifactId,
                versionNumber: result.versionNumber,
                created: result.created,
                title: (snapshot.exists && snapshot.data().title) || group.outputPath,
                url: buildArtifactAppUrl(projectId, result.artifactId, baseUrl),
                outputPaths: group.files.map(file => file.relativePath),
                ...(result.unchanged ? { unchanged: true } : {}),
            })
        } catch (error) {
            console.warn('🖥️ VM JOB: could not publish an output as an artifact', {
                correlationId,
                outputPath: group.outputPath,
                error: error.message,
            })
        }
    }
    return published
}

// One line per artifact under the VM's answer. The in-app link, never the serve link: the chat can
// be readable by more people than the artifact.
function buildVmArtifactLinksText(published) {
    if (!Array.isArray(published) || published.length === 0) return ''
    return published
        .map(
            artifact =>
                `📦 ${artifact.title}${artifact.versionNumber > 1 ? ` (v${artifact.versionNumber})` : ''}: ${artifact.url}`
        )
        .join('\n')
}

function appendVmArtifactLinks(text, published) {
    const links = buildVmArtifactLinksText(published)
    if (!links) return text
    const urls = new Set(published.map(artifact => artifact.url))
    const body = String(text || '')
        .replace(/\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\)/g, (match, url) => (urls.has(url) ? '' : match))
        .split('\n')
        .map(line => [...urls].reduce((value, url) => value.split(url).join(''), line))
        .map(line => (/^\s*[-*•]\s*$/.test(line) ? '' : line))
        .join('\n')
        .trim()
    return body ? `${body}\n\n${links}` : links
}

// A successfully published file is returned only as its artifact. Chat attachments are a
// fallback for files whose publication failed, never a second upload of the same deliverable.
function unpublishedVmFiles(files, published) {
    const paths = new Set((published || []).flatMap(artifact => artifact.outputPaths || []))
    return (files || []).filter(file => !paths.has(file.relativePath || file.fileName))
}

module.exports = {
    MAX_VM_ARTIFACTS_PER_RUN,
    appendVmArtifactLinks,
    buildVmArtifactLinksText,
    buildVmOutputKey,
    planVmOutputArtifacts,
    publishVmOutputArtifacts,
    unpublishedVmFiles,
}
