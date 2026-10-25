'use strict'

const admin = require('firebase-admin')

const { canAccessObject, getObjectDocPath, FEED_PUBLIC_FOR_ALL } = require('../shared/privacyAccess')
const { commitArtifactVersion, setArtifactDataAccess } = require('./artifactStore')
const { MCP_CHANNEL, buildLastEditorVia, buildMcpActorMarker } = require('../shared/mcpActor')
const {
    ARTIFACT_SOURCES,
    ArtifactInputError,
    buildArtifactAppPath,
    getArtifactDocPath,
    getArtifactFileStoragePath,
    getArtifactVersionsCollectionPath,
    getArtifactsCollectionPath,
    getMimeTypeForPath,
    isTextMimeType,
    mapArtifactData,
    mapArtifactVersionData,
    normalizeArtifactDescription,
    normalizeArtifactPath,
    normalizeArtifactTitle,
    sortArtifactsByLastEdition,
} = require('./artifactModel')

// Execution of the four artifact tools (see artifactToolSchemas.js). Every write goes through
// commitArtifactVersion, exactly like an upload from the app, so an assistant can store nothing an
// upload could not. Reads apply the same check as firestore.rules: a member of the project, and the
// artifact visible to the requesting user.

const MAX_READ_CHARS = 60000
const DEFAULT_LIST_LIMIT = 30
const MAX_LIST_LIMIT = 100

class ArtifactToolError extends Error {}

function fail(message) {
    throw new ArtifactToolError(message)
}

function getBaseUrl() {
    return require('../Utils/HelperFunctionsCloud').getBaseUrl()
}

function buildArtifactAppUrl(projectId, artifactId, baseUrl = getBaseUrl()) {
    return `${String(baseUrl || '').replace(/\/+$/, '')}${buildArtifactAppPath(projectId, artifactId)}`
}

async function assertMember(db, projectId, userId) {
    if (!userId) fail('Artifacts need a signed-in user to act for.')
    if (!projectId) fail('No project to work in.')
    const snapshot = await db.doc(`projects/${projectId}`).get()
    const userIds = snapshot.exists && Array.isArray(snapshot.data().userIds) ? snapshot.data().userIds : []
    if (!userIds.includes(userId)) fail('The project was not found or the user is not a member of it.')
}

async function readArtifact(db, projectId, artifactId, userId) {
    if (!artifactId || typeof artifactId !== 'string') fail('An artifactId is required.')
    const snapshot = await db.doc(getArtifactDocPath(projectId, artifactId)).get()
    const data = snapshot.exists ? snapshot.data() || {} : null
    if (!data || !canAccessObject(data, userId)) fail('Artifact not found.')
    return mapArtifactData(snapshot.id, data)
}

async function readVersion(db, projectId, artifact, versionNumber) {
    const versionsPath = getArtifactVersionsCollectionPath(projectId, artifact.id)
    if (versionNumber === undefined || versionNumber === null) {
        if (!artifact.currentVersionId) fail('The artifact has no version yet.')
        const snapshot = await db.doc(`${versionsPath}/${artifact.currentVersionId}`).get()
        if (!snapshot.exists) fail('The current version of the artifact is missing.')
        return mapArtifactVersionData(snapshot.id, snapshot.data())
    }
    const number = Number(versionNumber)
    if (!Number.isInteger(number) || number < 1) fail('versionNumber must be a positive whole number.')
    const snapshot = await db.collection(versionsPath).where('versionNumber', '==', number).limit(1).get()
    if (snapshot.empty) fail(`The artifact has no version ${number}.`)
    const doc = snapshot.docs[0]
    return mapArtifactVersionData(doc.id, doc.data())
}

async function readFileText(bucket, projectId, artifactId, versionId, path) {
    const [bytes] = await bucket.file(getArtifactFileStoragePath(projectId, artifactId, versionId, path)).download()
    return bytes.toString('utf8')
}

function summarizeArtifact(artifact, projectId, baseUrl) {
    return {
        artifactId: artifact.id,
        projectId,
        title: artifact.title,
        description: artifact.description || undefined,
        kind: artifact.kind,
        entryPath: artifact.entryPath,
        fileCount: artifact.fileCount,
        versionNumber: artifact.versionCount,
        lastEditionDate: artifact.lastEditionDate,
        isPrivate: artifact.isPrivate,
        liveData: artifact.dataAccess === true,
        source: artifact.source,
        url: buildArtifactAppUrl(projectId, artifact.id, baseUrl),
    }
}

// Decision 5 of ARTIFACTS_PLAN.md: an artifact made in a private thread is private. A thread that
// cannot be read is treated as private, so an unknown thread can never widen the audience.
async function isThreadPrivate(db, runtime = {}) {
    const { objectType, objectId } = runtime
    const threadProjectId = runtime.projectId
    if (!objectType || !objectId) return false
    const path = getObjectDocPath(threadProjectId, objectType, objectId)
    if (!path || path.startsWith('projects/') || path.startsWith('users/')) return false
    try {
        const snapshot = await db.doc(path).get()
        if (!snapshot.exists) return true
        const data = snapshot.data() || {}
        if (data.isPrivate === true) return true
        return Array.isArray(data.isPublicFor) && !data.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
    } catch (error) {
        console.warn('[artifacts] Could not read the thread to inherit its privacy', { path, error: error.message })
        return true
    }
}

function buildParentObject(runtime = {}) {
    if (!runtime.objectType || !runtime.objectId) return null
    return { type: runtime.objectType, id: runtime.objectId, projectId: runtime.projectId || null }
}

function encodeTextFiles(files, argumentName = 'files') {
    if (files === undefined || files === null) return []
    if (!Array.isArray(files)) fail(`${argumentName} must be a list of { path, content }.`)
    return files.map(file => {
        if (!file || typeof file.path !== 'string' || !file.path.trim()) fail('Every file needs a path.')
        if (typeof file.content !== 'string') fail(`The file ${file.path} needs its content as text.`)
        return { path: file.path, base64: Buffer.from(file.content, 'utf8').toString('base64') }
    })
}

function countOccurrences(text, find) {
    let count = 0
    let index = text.indexOf(find)
    while (index !== -1) {
        count += 1
        index = text.indexOf(find, index + find.length)
    }
    return count
}

// Exact replacements, applied in order. Each `find` must occur exactly once in the file as it is at
// that point, so a model that guessed at the content fails loudly instead of editing the wrong place.
async function applyEdits({ edits, version, bucket, projectId, artifactId }) {
    if (!Array.isArray(edits)) fail('edits must be a list of { path, find, replace }.')
    const texts = new Map()
    for (const edit of edits) {
        if (!edit || typeof edit.path !== 'string') fail('Every edit needs a path.')
        if (typeof edit.find !== 'string' || edit.find === '') fail(`An edit of ${edit.path} has nothing to find.`)
        if (typeof edit.replace !== 'string') fail(`An edit of ${edit.path} needs replace text.`)
        const path = normalizeArtifactPath(edit.path)
        const file = version.files.find(candidate => candidate.path === path)
        if (!file) fail(`The file ${path} is not part of the artifact.`)
        if (!isTextMimeType(file.mimeType || getMimeTypeForPath(path))) fail(`The file ${path} is not a text file.`)
        if (!texts.has(path)) texts.set(path, await readFileText(bucket, projectId, artifactId, version.id, path))
        const text = texts.get(path)
        const occurrences = countOccurrences(text, edit.find)
        if (occurrences === 0) fail(`The text to find was not found in ${path}. Read the artifact again.`)
        if (occurrences > 1) {
            fail(`The text to find appears ${occurrences} times in ${path}. Include more surrounding text.`)
        }
        texts.set(
            path,
            text.replace(edit.find, () => edit.replace)
        )
    }
    return [...texts.entries()].map(([path, text]) => ({ path, content: text }))
}

async function getArtifacts({ db, projectId, userId, args, baseUrl }) {
    await assertMember(db, projectId, userId)
    const limit = Math.min(Math.max(Number(args.limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
    const snapshot = await db.collection(getArtifactsCollectionPath(projectId)).get()
    const visible = snapshot.docs
        .map(doc => ({ id: doc.id, data: doc.data() || {} }))
        .filter(({ data }) => canAccessObject(data, userId))
        .map(({ id, data }) => mapArtifactData(id, data))
        .filter(
            artifact =>
                !query ||
                artifact.title.toLowerCase().includes(query) ||
                artifact.description.toLowerCase().includes(query)
        )
    const artifacts = sortArtifactsByLastEdition(visible)
    return {
        success: true,
        projectId,
        totalCount: artifacts.length,
        artifacts: artifacts.slice(0, limit).map(artifact => summarizeArtifact(artifact, projectId, baseUrl)),
    }
}

async function readArtifactTool({ db, bucket, projectId, userId, args, baseUrl }) {
    await assertMember(db, projectId, userId)
    const artifact = await readArtifact(db, projectId, args.artifactId, userId)
    const version = await readVersion(db, projectId, artifact, args.versionNumber)
    const path = args.path ? normalizeArtifactPath(args.path) : version.entryPath
    const file = version.files.find(candidate => candidate.path === path)
    if (!file) fail(`The file ${path} is not part of version ${version.versionNumber}.`)

    const result = {
        success: true,
        ...summarizeArtifact(artifact, projectId, baseUrl),
        versionNumber: version.versionNumber,
        isCurrentVersion: version.id === artifact.currentVersionId,
        files: version.files.map(({ path: filePath, size, mimeType }) => ({ path: filePath, size, mimeType })),
        path,
    }
    if (!isTextMimeType(file.mimeType || getMimeTypeForPath(path))) {
        return { ...result, content: null, note: 'This file is not text, so its content is not shown.' }
    }
    const text = await readFileText(bucket, projectId, artifact.id, version.id, path)
    return {
        ...result,
        content: text.length > MAX_READ_CHARS ? text.slice(0, MAX_READ_CHARS) : text,
        truncated: text.length > MAX_READ_CHARS,
    }
}

// An artifact an MCP client creates or changes in the user's name says so in its history.
function getMcpActorChannel(runtime) {
    return runtime?.sourceChannel === MCP_CHANNEL ? buildMcpActorMarker(runtime.mcpClient) : null
}

async function createArtifactTool({ db, bucket, projectId, userId, assistantId, args, runtime, baseUrl }) {
    const files = encodeTextFiles(args.files)
    if (files.length === 0) fail('An artifact needs at least one file.')
    if (!normalizeArtifactTitle(args.title)) fail('An artifact needs a title.')
    await assertMember(db, projectId, userId)
    const isPrivate = args.isPrivate === true || (await isThreadPrivate(db, runtime))

    const result = await commitArtifactVersion({
        db,
        bucket,
        userId,
        projectId,
        files,
        title: args.title,
        description: args.description,
        isPrivate,
        source: ARTIFACT_SOURCES.ASSISTANT,
        parentObject: buildParentObject(runtime),
        assistantId: assistantId || null,
        dataAccess: args.liveData === true,
        actorChannel: getMcpActorChannel(runtime),
    })
    const artifact = await readArtifact(db, projectId, result.artifactId, userId)
    return {
        success: true,
        ...summarizeArtifact(artifact, projectId, baseUrl),
        files: files.map(file => file.path),
        message: 'Artifact created. Give the user the url.',
    }
}

async function updateMetadata({ db, projectId, artifactId, userId, title, description, actorChannel = null }) {
    const lastEditionDate = Date.now()
    // The update trigger derives the history event from this edit; the stamp is how it knows the edit
    // came through an MCP client (artifactHistory.buildMetadataHistoryEvents).
    const patch = {
        lastEditorId: userId,
        lastEditionDate,
        lastEditorVia: buildLastEditorVia(actorChannel, lastEditionDate),
    }
    if (title) patch.title = title
    if (description !== undefined) patch.description = description
    await db.doc(getArtifactDocPath(projectId, artifactId)).update(patch)
}

async function updateArtifactTool({ db, bucket, projectId, userId, assistantId, args, runtime, baseUrl }) {
    await assertMember(db, projectId, userId)
    const actorChannel = getMcpActorChannel(runtime)
    const artifact = await readArtifact(db, projectId, args.artifactId, userId)
    const title = args.title === undefined ? '' : normalizeArtifactTitle(args.title)
    const description = args.description === undefined ? undefined : normalizeArtifactDescription(args.description)
    const hasEdits = Array.isArray(args.edits) && args.edits.length > 0
    const files = encodeTextFiles(args.files)
    const removePaths = Array.isArray(args.removePaths) ? args.removePaths : []

    if (!hasEdits && files.length === 0 && removePaths.length === 0) {
        const switchesLiveData = typeof args.liveData === 'boolean'
        if (!title && description === undefined && !switchesLiveData)
            fail('Nothing to change: give edits, files, removePaths, a title, a description or liveData.')
        if (switchesLiveData) {
            await setArtifactDataAccess({
                db,
                projectId,
                artifactId: artifact.id,
                userId,
                enabled: args.liveData,
                actorChannel,
            })
        }
        if (title || description !== undefined)
            await updateMetadata({ db, projectId, artifactId: artifact.id, userId, title, description, actorChannel })
        const updated = await readArtifact(db, projectId, artifact.id, userId)
        return {
            success: true,
            ...summarizeArtifact(updated, projectId, baseUrl),
            message: 'Artifact details updated.',
        }
    }

    const version = await readVersion(db, projectId, artifact)
    const edited = hasEdits
        ? await applyEdits({ edits: args.edits, version, bucket, projectId, artifactId: artifact.id })
        : []
    const replacedPaths = new Set(files.map(file => normalizeArtifactPath(file.path)))
    for (const file of edited) {
        if (replacedPaths.has(file.path)) fail(`The file ${file.path} is both edited and replaced; do one of them.`)
    }

    const result = await commitArtifactVersion({
        db,
        bucket,
        userId,
        projectId,
        artifactId: artifact.id,
        files: [...files, ...encodeTextFiles(edited, 'edits')],
        removePaths,
        keepUnchangedFiles: true,
        baseVersionId: version.id,
        title: title || undefined,
        description,
        changeSummary: args.changeSummary,
        source: ARTIFACT_SOURCES.ASSISTANT,
        assistantId: assistantId || null,
        dataAccess: typeof args.liveData === 'boolean' ? args.liveData : undefined,
        actorChannel,
    })
    const updated = await readArtifact(db, projectId, artifact.id, userId)
    return {
        success: true,
        ...summarizeArtifact(updated, projectId, baseUrl),
        versionNumber: result.versionNumber,
        changedFiles: [...files.map(file => normalizeArtifactPath(file.path)), ...edited.map(file => file.path)],
        removedFiles: removePaths,
        message: `Version ${result.versionNumber} saved. Give the user the url.`,
    }
}

const EXECUTORS = {
    get_artifacts: getArtifacts,
    read_artifact: readArtifactTool,
    create_artifact: createArtifactTool,
    update_artifact: updateArtifactTool,
}

// Input mistakes come back as `{ success: false, error }` so the model can correct itself; anything
// else (a storage outage, a bug) is thrown like every other tool failure.
async function executeArtifactTool({
    toolName,
    args = {},
    projectId,
    requestUserId,
    assistantId,
    toolRuntimeContext = {},
    db = admin.firestore(),
    bucket = admin.storage().bucket(),
    baseUrl,
}) {
    const execute = EXECUTORS[toolName]
    if (!execute) throw new Error(`Unknown artifact tool: ${toolName}`)
    const targetProjectId = (typeof args.projectId === 'string' && args.projectId.trim()) || projectId
    try {
        return await execute({
            db,
            bucket,
            projectId: targetProjectId,
            userId: requestUserId,
            assistantId,
            args: args || {},
            runtime: { ...(toolRuntimeContext || {}), projectId: toolRuntimeContext?.projectId || projectId },
            baseUrl: baseUrl === undefined ? getBaseUrl() : baseUrl,
        })
    } catch (error) {
        const expected =
            error instanceof ArtifactToolError ||
            ['invalid-argument', 'not-found', 'permission-denied', 'aborted'].includes(error && error.code) ||
            error instanceof ArtifactInputError
        if (!expected) throw error
        return { success: false, error: error.message }
    }
}

module.exports = {
    buildArtifactAppUrl,
    executeArtifactTool,
    isThreadPrivate,
}
