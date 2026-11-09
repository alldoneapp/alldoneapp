'use strict'

const admin = require('firebase-admin')

const { canAccessObject, getObjectDocPath, FEED_PUBLIC_FOR_ALL } = require('../shared/privacyAccess')
const {
    commitArtifactVersion,
    restoreArtifactVersion,
    setArtifactDataAccess,
    setArtifactPublicLink,
} = require('./artifactStore')
const { MCP_CHANNEL, buildLastEditorVia, buildMcpActorMarker } = require('../shared/mcpActor')
const { LAST_EDITOR_ASSISTANT_FIELD, buildLastEditorAssistant } = require('./artifactHistory')
const { ARTIFACT_DELETION_STAMP_FIELD, buildArtifactDeletionStamp } = require('./artifactFeedModel')
const {
    ARTIFACT_SOURCES,
    ArtifactInputError,
    buildArtifactAppPath,
    buildArtifactIsPublicFor,
    buildArtifactPublicUrl,
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
    resolveArtifactPublicBaseUrl,
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

/**
 * The bytes of one file of an artifact version the user can read: a member of the project, the
 * artifact visible to them. `versionNumber` defaults to the current version, `path` to its entry file.
 * Used for mail attachments and assistant pictures (Assistant/assistantPhoto.js).
 */
async function readArtifactFileForUser({
    db,
    bucket,
    projectId,
    artifactId,
    userId,
    versionNumber,
    path,
    maxBytes,
    tooLargeMessage,
}) {
    if (![projectId, artifactId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id))) {
        fail('A valid projectId and artifactId are required.')
    }
    await assertMember(db, projectId, userId)
    const artifact = await readArtifact(db, projectId, artifactId, userId)
    const version = await readVersion(db, projectId, artifact, versionNumber)
    const filePath = path ? normalizeArtifactPath(path) : version.entryPath
    const file = version.files.find(candidate => candidate.path === filePath)
    if (!file) fail(`The file ${filePath} is not part of version ${version.versionNumber}.`)
    const storedFile = bucket.file(getArtifactFileStoragePath(projectId, artifact.id, version.id, filePath))
    const tooLarge = tooLargeMessage || 'The artifact file is too large.'
    if (maxBytes) {
        const [metadata] = await storedFile.getMetadata()
        if (Number(metadata.size) > maxBytes) fail(tooLarge)
    }
    const [bytes] = await storedFile.download()
    if (maxBytes && bytes.length > maxBytes) fail(tooLarge)
    return {
        bytes,
        path: filePath,
        mimeType: file.mimeType || getMimeTypeForPath(filePath),
        artifactId: artifact.id,
        versionNumber: version.versionNumber,
    }
}

// File bytes stay on the server. Resolve an immutable, authorised artifact version directly
// into a mail attachment instead of asking the model to copy a binary/base64 chat response.
async function resolveArtifactDraftAttachments({ attachments, projectId, userId, db, bucket }) {
    if (!Array.isArray(attachments)) return attachments
    if (attachments.length > 10) fail('A draft supports at most 10 attachments.')
    const resolved = []
    for (const attachment of attachments) {
        if (!attachment?.artifactId) {
            resolved.push(attachment)
            continue
        }
        if (attachment.base64 || attachment.fileBase64 || attachment.data) {
            fail('Use an artifact reference or base64 for an attachment, not both.')
        }
        const file = await readArtifactFileForUser({
            db,
            bucket,
            projectId: attachment.projectId || projectId,
            artifactId: attachment.artifactId,
            userId,
            versionNumber: attachment.versionNumber,
            path: attachment.path,
            maxBytes: 10 * 1024 * 1024,
            tooLargeMessage: 'An artifact attachment exceeds the 10 MB draft attachment limit.',
        })
        resolved.push({
            fileName: attachment.fileName || file.path.split('/').pop(),
            mimeType: file.mimeType,
            base64: file.bytes.toString('base64'),
        })
    }
    return resolved
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
        attachment: { artifactId: artifact.id, projectId, versionNumber: version.versionNumber, path },
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

// Who made an edit the update trigger derives the history event and the Updates entry from: the
// stamps say it came through an MCP client or an assistant's tool (artifactHistory.buildMetadataHistoryEvents).
function buildEditorStamps(userId, actorChannel, assistantId, lastEditionDate) {
    return {
        lastEditorId: userId,
        lastEditionDate,
        lastEditorVia: buildLastEditorVia(actorChannel, lastEditionDate),
        [LAST_EDITOR_ASSISTANT_FIELD]: buildLastEditorAssistant(assistantId, actorChannel, lastEditionDate),
    }
}

async function updateMetadata({
    db,
    projectId,
    artifactId,
    userId,
    title,
    description,
    actorChannel = null,
    assistantId = null,
}) {
    const patch = buildEditorStamps(userId, actorChannel, assistantId, Date.now())
    if (title) patch.title = title
    if (description !== undefined) patch.description = description
    await db.doc(getArtifactDocPath(projectId, artifactId)).update(patch)
}

const PUBLIC_LINK_ARGUMENTS = { on: 'enable', off: 'disable', new: 'change' }
const MAX_COMMENT_LENGTH = 5000

function readUpdateOptions(args, artifact, userId) {
    const restoreVersion =
        args.restoreVersion === undefined || args.restoreVersion === null ? undefined : args.restoreVersion
    const isPrivate = typeof args.isPrivate === 'boolean' ? args.isPrivate : undefined
    if (args.isPrivate !== undefined && args.isPrivate !== null && isPrivate === undefined) {
        fail('isPrivate must be true or false.')
    }
    let publicLinkAction
    if (args.publicLink !== undefined && args.publicLink !== null && args.publicLink !== '') {
        publicLinkAction = PUBLIC_LINK_ARGUMENTS[String(args.publicLink).trim().toLowerCase()]
        if (!publicLinkAction) fail('publicLink must be "on", "off" or "new".')
    }
    let comment
    if (args.comment !== undefined && args.comment !== null) {
        if (typeof args.comment !== 'string' || !args.comment.trim()) fail('comment must be a non-empty text.')
        comment = args.comment.trim()
        if (comment.length > MAX_COMMENT_LENGTH) fail(`comment must not exceed ${MAX_COMMENT_LENGTH} characters.`)
    }

    // The app shows the privacy switch to the owner only (firestore.rules lets a write through only
    // when the new audience still includes the writer), and a private artifact has no public link.
    const changesPrivacy = isPrivate !== undefined && isPrivate !== artifact.isPrivate
    if (changesPrivacy && artifact.userId !== userId) {
        fail('Only the owner of an artifact can change who sees it.')
    }
    const endsPrivate = isPrivate === undefined ? artifact.isPrivate : isPrivate
    if (publicLinkAction && publicLinkAction !== 'disable' && endsPrivate) {
        fail('A private artifact has no public link. Share it with the project first (isPrivate: false).')
    }
    return { restoreVersion, isPrivate, changesPrivacy, publicLinkAction, comment }
}

// The artifact's chat follows its privacy, like a note's (utils setArtifactPrivacy). The public link
// of an artifact made private is withdrawn by the update trigger (withdrawPublicLinkWhenMadePrivate).
async function setPrivacy({ db, projectId, artifact, userId, isPrivate, actorChannel, assistantId = null }) {
    const isPublicFor = buildArtifactIsPublicFor(isPrivate, artifact.userId || userId)
    await db.doc(getArtifactDocPath(projectId, artifact.id)).update({
        isPrivate,
        isPublicFor,
        ...buildEditorStamps(userId, actorChannel, assistantId, Date.now()),
    })
    const chatRef = db.doc(`chatObjects/${projectId}/chats/${artifact.id}`)
    const chat = await chatRef.get()
    if (chat.exists) {
        const followers = Array.isArray(chat.data()?.usersFollowing) ? chat.data().usersFollowing : []
        await chatRef.update({
            isPublicFor,
            usersFollowing: isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                ? followers
                : followers.filter(followerId => isPublicFor.includes(followerId)),
        })
    }
}

function getPublicUrl(publicLink) {
    if (!publicLink || !publicLink.token) return null
    const firebaseProjectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || ''
    return buildArtifactPublicUrl(resolveArtifactPublicBaseUrl(firebaseProjectId, null), publicLink.token)
}

async function updateArtifactTool({ db, bucket, projectId, userId, assistantId, args, runtime, baseUrl, postComment }) {
    await assertMember(db, projectId, userId)
    const actorChannel = getMcpActorChannel(runtime)
    const artifact = await readArtifact(db, projectId, args.artifactId, userId)
    const title = args.title === undefined ? '' : normalizeArtifactTitle(args.title)
    const description = args.description === undefined ? undefined : normalizeArtifactDescription(args.description)
    const hasEdits = Array.isArray(args.edits) && args.edits.length > 0
    const files = encodeTextFiles(args.files)
    const removePaths = Array.isArray(args.removePaths) ? args.removePaths : []
    const hasContent = hasEdits || files.length > 0 || removePaths.length > 0
    const switchesLiveData = typeof args.liveData === 'boolean'
    const options = readUpdateOptions(args, artifact, userId)

    if (
        !hasContent &&
        !title &&
        description === undefined &&
        !switchesLiveData &&
        options.restoreVersion === undefined &&
        options.isPrivate === undefined &&
        !options.publicLinkAction &&
        !options.comment
    ) {
        fail(
            'Nothing to change: give edits, files, removePaths, a title, a description, liveData, restoreVersion, isPrivate, publicLink or a comment.'
        )
    }
    if (options.restoreVersion !== undefined && hasContent) {
        fail('restoreVersion cannot be combined with edits, files or removePaths: restore first, then edit.')
    }
    if (options.comment && typeof postComment !== 'function') fail('Comments on artifacts are not available here.')

    const changes = []
    let versionNumber
    let changedFiles
    if (hasContent) {
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
            dataAccess: switchesLiveData ? args.liveData : undefined,
            actorChannel,
        })
        versionNumber = result.versionNumber
        changedFiles = [...files.map(file => normalizeArtifactPath(file.path)), ...edited.map(file => file.path)]
        changes.push(`version ${result.versionNumber} saved`)
    } else {
        if (switchesLiveData) {
            await setArtifactDataAccess({
                db,
                projectId,
                artifactId: artifact.id,
                userId,
                enabled: args.liveData,
                actorChannel,
                assistantId: assistantId || null,
            })
            changes.push(args.liveData ? 'live data on' : 'live data off')
        }
        if (title || description !== undefined) {
            await updateMetadata({
                db,
                projectId,
                artifactId: artifact.id,
                userId,
                title,
                description,
                actorChannel,
                assistantId: assistantId || null,
            })
            changes.push('details updated')
        }
    }

    if (options.restoreVersion !== undefined) {
        const version = await readVersion(db, projectId, artifact, options.restoreVersion)
        if (version.id === artifact.currentVersionId) {
            changes.push(`version ${version.versionNumber} is already the current one`)
        } else {
            await restoreArtifactVersion({
                userId,
                projectId,
                artifactId: artifact.id,
                versionId: version.id,
                assistantId: assistantId || null,
                actorChannel,
                db,
            })
            changes.push(`version ${version.versionNumber} restored`)
        }
    }

    if (options.changesPrivacy) {
        await setPrivacy({
            db,
            projectId,
            artifact,
            userId,
            isPrivate: options.isPrivate,
            actorChannel,
            assistantId: assistantId || null,
        })
        changes.push(options.isPrivate ? 'made private' : 'shared with the project')
    }

    let publicLinkResult = null
    if (options.publicLinkAction) {
        publicLinkResult = await setArtifactPublicLink({
            userId,
            projectId,
            artifactId: artifact.id,
            action: options.publicLinkAction,
            actorChannel,
            assistantId: assistantId || null,
            db,
        })
        if (publicLinkResult.changed) {
            changes.push(
                options.publicLinkAction === 'disable'
                    ? 'public link off'
                    : options.publicLinkAction === 'change'
                      ? 'new public link'
                      : 'public link on'
            )
        }
    }

    let commentResult = null
    if (options.comment) {
        const somethingElseChanged = changes.length > 0
        try {
            commentResult = await postComment({ artifact, comment: options.comment })
            changes.push('comment added')
        } catch (error) {
            // The comment alone is the whole request; next to other changes, those stay saved.
            if (!somethingElseChanged) throw error
            changes.push(`comment failed (${error.message})`)
        }
    }

    const updated = await readArtifact(db, projectId, artifact.id, userId).catch(() => null)
    const publicUrl = getPublicUrl(updated ? updated.publicLink : null)
    return {
        success: true,
        ...summarizeArtifact(updated || artifact, projectId, baseUrl),
        ...(versionNumber ? { versionNumber } : {}),
        ...(changedFiles ? { changedFiles, removedFiles: removePaths } : {}),
        publicLink: !!(updated && updated.publicLink),
        ...(publicUrl ? { publicUrl } : {}),
        ...(commentResult
            ? {
                  comment: {
                      commentId: commentResult.commentId,
                      notifiedFollowers: commentResult.notifiedFollowers || 0,
                  },
              }
            : {}),
        changes,
        message: versionNumber
            ? `Version ${versionNumber} saved. Give the user the url.`
            : `Artifact updated (${changes.join(', ')}).`,
    }
}

// Deleting is the document delete the app does; onDeleteArtifactSecondGen removes the versions, the
// stored files, the history, the public link, the thread and the backlinks. Any member who can see
// the artifact may delete it in the app, so the tool asks for nothing more. Like the app, it first
// stamps who deletes it, in a write of its own, for the Updates entry the delete trigger writes.
async function deleteArtifactTool({ db, projectId, userId, assistantId, args, runtime }) {
    await assertMember(db, projectId, userId)
    const artifact = await readArtifact(db, projectId, args.artifactId, userId)
    const artifactRef = db.doc(getArtifactDocPath(projectId, artifact.id))
    await artifactRef.update({
        [ARTIFACT_DELETION_STAMP_FIELD]: buildArtifactDeletionStamp({
            userId,
            assistantId: assistantId || null,
            actorChannel: getMcpActorChannel(runtime),
        }),
    })
    await artifactRef.delete()
    return {
        success: true,
        deleted: true,
        artifactId: artifact.id,
        projectId,
        title: artifact.title,
        message: `Artifact "${artifact.title}" was deleted permanently with all its versions.`,
    }
}

const EXECUTORS = {
    get_artifacts: getArtifacts,
    read_artifact: readArtifactTool,
    create_artifact: createArtifactTool,
    update_artifact: updateArtifactTool,
    delete_artifact: deleteArtifactTool,
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
    postComment,
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
            postComment,
        })
    } catch (error) {
        const expected =
            error instanceof ArtifactToolError ||
            ['invalid-argument', 'not-found', 'permission-denied', 'aborted', 'failed-precondition'].includes(
                error && error.code
            ) ||
            error instanceof ArtifactInputError
        if (!expected) throw error
        return { success: false, error: error.message }
    }
}

module.exports = {
    buildArtifactAppUrl,
    executeArtifactTool,
    isThreadPrivate,
    readArtifactFileForUser,
    resolveArtifactDraftAttachments,
}
