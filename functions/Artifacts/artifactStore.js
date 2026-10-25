'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')

const { buildObjectAccessProjection } = require('../shared/objectAccessProjection')
const { canAccessObject } = require('../shared/privacyAccess')
const { buildLastEditorVia, getActorChannelFields } = require('../shared/mcpActor')
const {
    ARTIFACT_SOURCES,
    ArtifactInputError,
    MAX_ARTIFACT_FILES,
    MAX_ARTIFACT_UPLOAD_BYTES,
    buildArtifactIsPublicFor,
    getArtifactDocPath,
    getArtifactFileStoragePath,
    getArtifactKindForMimeType,
    getArtifactStoragePrefix,
    getArtifactVersionsCollectionPath,
    getFileNameFromPath,
    getLostReaderIds,
    getMimeTypeForPath,
    getTitleFromFileName,
    normalizeArtifactDescription,
    normalizeArtifactPath,
    normalizeArtifactTitle,
    normalizeChangeSummary,
    resolveEntryPath,
} = require('./artifactModel')
const {
    ARTIFACT_HISTORY_TYPES,
    buildHistoryEvent,
    buildVersionHistoryEvent,
    getArtifactHistoryCollectionPath,
} = require('./artifactHistory')

// Writes of artifacts: every version and every byte goes through here, so whatever serveArtifact
// later serves was validated and stored by the server. Clients only edit an artifact's metadata
// (title, description, privacy) directly, under firestore.rules.

const FOLLOWER_FIELD = 'isVisibleInFollowedFor'

// History entries carry their time in the id, so the collection also reads in order by id.
function newHistoryPath(projectId, artifactId, now) {
    return `${getArtifactHistoryCollectionPath(projectId, artifactId)}/${now}-${crypto.randomBytes(6).toString('hex')}`
}

function generateServeSecret() {
    return crypto.randomBytes(24).toString('base64url')
}

function generateId() {
    return crypto.randomBytes(15).toString('base64url')
}

function validateCaller(userId, projectId) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId || typeof projectId !== 'string') {
        throw new HttpsError('invalid-argument', 'A projectId is required.')
    }
}

async function assertProjectMember(db, projectId, userId) {
    const snapshot = await db.doc(`projects/${projectId}`).get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'Project not found.')
    const project = snapshot.data() || {}
    const userIds = Array.isArray(project.userIds) ? project.userIds : []
    if (!userIds.includes(userId)) {
        throw new HttpsError('permission-denied', 'You are not a member of this project.')
    }
    return project
}

// The same 404 whether the artifact is missing or merely invisible to the caller.
async function readAccessibleArtifact(reader, db, projectId, artifactId, userId) {
    if (!artifactId || typeof artifactId !== 'string') {
        throw new HttpsError('invalid-argument', 'An artifactId is required.')
    }
    const snapshot = await reader.get(db.doc(getArtifactDocPath(projectId, artifactId)))
    const artifact = snapshot.exists ? snapshot.data() || {} : null
    if (!artifact || !canAccessObject(artifact, userId)) throw new HttpsError('not-found', 'Artifact not found.')
    return artifact
}

function decodeFiles(files, { allowEmpty = false } = {}) {
    if (allowEmpty && (files === undefined || files === null)) return { files: [], totalBytes: 0 }
    if (!Array.isArray(files) || (files.length === 0 && !allowEmpty)) {
        throw new ArtifactInputError('At least one file is required.')
    }
    if (files.length > MAX_ARTIFACT_FILES) {
        throw new ArtifactInputError(`An artifact can hold at most ${MAX_ARTIFACT_FILES} files.`)
    }
    const seen = new Set()
    let totalBytes = 0
    const decoded = files.map(file => {
        const path = normalizeArtifactPath(file && file.path)
        if (seen.has(path)) throw new ArtifactInputError(`The file ${path} appears twice.`)
        seen.add(path)
        if (typeof file.base64 !== 'string') throw new ArtifactInputError(`The file ${path} has no content.`)
        const bytes = Buffer.from(file.base64, 'base64')
        totalBytes += bytes.length
        if (totalBytes > MAX_ARTIFACT_UPLOAD_BYTES) {
            throw new ArtifactInputError('The upload is larger than 20 MB.')
        }
        return {
            path,
            bytes,
            size: bytes.length,
            mimeType: getMimeTypeForPath(path),
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        }
    })
    return { files: decoded, totalBytes }
}

// Fields derived from a version, copied onto the artifact so the list never reads a version.
function describeVersion(version) {
    const mimeType = getMimeTypeForPath(version.entryPath)
    return {
        currentVersionId: version.id,
        kind: getArtifactKindForMimeType(mimeType),
        mimeType,
        entryPath: version.entryPath,
        sizeBytes: version.sizeBytes,
        fileCount: version.files.length,
    }
}

// No download token is ever attached: the bytes are reachable only through serveArtifact, which
// checks the artifact's secret on every request.
async function storeVersionFiles(bucket, projectId, artifactId, versionId, files) {
    await Promise.all(
        files.map(file =>
            bucket.file(getArtifactFileStoragePath(projectId, artifactId, versionId, file.path)).save(file.bytes, {
                resumable: false,
                contentType: file.mimeType,
            })
        )
    )
}

// The current version's files, for a new version that only sends what changed. The version id is
// checked again inside the commit transaction, so two writers cannot silently drop each other's work.
async function readCurrentVersionFiles(db, projectId, artifactId, userId) {
    const artifact = await readAccessibleArtifact({ get: ref => ref.get() }, db, projectId, artifactId, userId)
    const baseVersionId = artifact.currentVersionId
    if (!baseVersionId) return { baseVersionId: null, entryPath: '', files: [] }
    const snapshot = await db.doc(`${getArtifactVersionsCollectionPath(projectId, artifactId)}/${baseVersionId}`).get()
    const version = snapshot.exists ? snapshot.data() || {} : {}
    return {
        baseVersionId,
        entryPath: version.entryPath || artifact.entryPath || '',
        files: Array.isArray(version.files) ? version.files : [],
    }
}

function artifactChangedError() {
    return new HttpsError(
        'aborted',
        'The artifact changed while this version was being written. Read it again and retry.'
    )
}

// Unchanged files keep their bytes: they are copied inside the bucket, never sent again.
function mergeWithCurrentVersion(current, newFiles, removePaths) {
    const replaced = new Set(newFiles.map(file => file.path))
    const removed = new Set()
    for (const rawPath of removePaths) {
        const path = normalizeArtifactPath(rawPath)
        if (!current.files.some(file => file.path === path)) {
            throw new ArtifactInputError(`The file ${path} is not part of the artifact.`)
        }
        if (replaced.has(path)) throw new ArtifactInputError(`The file ${path} is both replaced and removed.`)
        removed.add(path)
    }
    const inherited = current.files.filter(file => !replaced.has(file.path) && !removed.has(file.path))
    if (inherited.length + newFiles.length === 0) {
        throw new ArtifactInputError('A version needs at least one file.')
    }
    if (inherited.length + newFiles.length > MAX_ARTIFACT_FILES) {
        throw new ArtifactInputError(`An artifact can hold at most ${MAX_ARTIFACT_FILES} files.`)
    }
    const totalBytes =
        inherited.reduce((sum, file) => sum + (Number(file.size) || 0), 0) +
        newFiles.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_ARTIFACT_UPLOAD_BYTES) throw new ArtifactInputError('The artifact is larger than 20 MB.')
    return { inherited, totalBytes }
}

async function copyInheritedFiles(bucket, projectId, artifactId, fromVersionId, toVersionId, files) {
    await Promise.all(
        files.map(file =>
            bucket
                .file(getArtifactFileStoragePath(projectId, artifactId, fromVersionId, file.path))
                .copy(bucket.file(getArtifactFileStoragePath(projectId, artifactId, toVersionId, file.path)))
        )
    )
}

async function removeStoredVersion(bucket, projectId, artifactId, versionId) {
    try {
        await bucket.deleteFiles({ prefix: `${getArtifactStoragePrefix(projectId, artifactId)}${versionId}/` })
    } catch (error) {
        console.warn('[artifacts] Could not remove the files of an unsaved version', {
            projectId,
            artifactId,
            versionId,
            error: error.message,
        })
    }
}

async function commitArtifactVersion({
    userId,
    projectId,
    artifactId = null,
    files,
    title,
    description,
    isPrivate = false,
    changeSummary,
    source = ARTIFACT_SOURCES.UPLOAD,
    parentObject = null,
    assistantId = null,
    // Set by the VM publisher on create, so the next run in the same thread finds this artifact.
    vmOutputKey = null,
    // Only for a new version of an existing artifact: start from the current version's files,
    // replace the ones in `files` and drop `removePaths`.
    keepUnchangedFiles = false,
    removePaths = [],
    // The version the caller's changes were made against (an edit of a file it read). Without it the
    // commit builds on whatever version is current when it starts.
    baseVersionId = null,
    // Live project data for the page (artifactDataBridge.js): set on create, or changed by the
    // artifact's owner together with a new version. Undefined leaves it as it is.
    dataAccess,
    // The MCP marker of a commit an MCP client made in the user's name (shared/mcpActor.js): the
    // version, its history event and the artifact's last editor say which client it was.
    actorChannel = null,
    db = admin.firestore(),
    bucket = admin.storage().bucket(),
    now = Date.now(),
    newId = generateId,
    newSecret = generateServeSecret,
}) {
    validateCaller(userId, projectId)
    const mergeWithCurrent = !!artifactId && keepUnchangedFiles === true
    const lastEditorVia = buildLastEditorVia(actorChannel, now)

    let input
    try {
        input = {
            ...decodeFiles(files, { allowEmpty: mergeWithCurrent }),
            title: normalizeArtifactTitle(title),
            description: normalizeArtifactDescription(description),
            changeSummary: normalizeChangeSummary(changeSummary),
        }
    } catch (error) {
        if (error instanceof ArtifactInputError) throw new HttpsError('invalid-argument', error.message)
        throw error
    }

    const project = await assertProjectMember(db, projectId, userId)
    let current = null
    let inherited = []
    let totalBytes = input.totalBytes
    if (mergeWithCurrent) {
        current = await readCurrentVersionFiles(db, projectId, artifactId, userId)
        if (baseVersionId && current.baseVersionId !== baseVersionId) throw artifactChangedError()
        try {
            ;({ inherited, totalBytes } = mergeWithCurrentVersion(
                current,
                input.files,
                Array.isArray(removePaths) ? removePaths : []
            ))
        } catch (error) {
            if (error instanceof ArtifactInputError) throw new HttpsError('invalid-argument', error.message)
            throw error
        }
    } else if (artifactId) {
        await readAccessibleArtifact({ get: ref => ref.get() }, db, projectId, artifactId, userId)
    }

    const targetArtifactId = artifactId || newId()
    const versionId = newId()
    const versionFiles = [
        ...inherited.map(({ path, size, mimeType, sha256 }) => ({ path, size, mimeType, sha256 })),
        ...input.files.map(({ path, size, mimeType, sha256 }) => ({ path, size, mimeType, sha256 })),
    ]
    const filePaths = versionFiles.map(file => file.path)
    // A partial update keeps the entry file the artifact already opens on, as long as it still exists.
    const entryPath =
        current && current.entryPath && filePaths.includes(current.entryPath)
            ? current.entryPath
            : resolveEntryPath(filePaths)
    const versionBase = {
        id: versionId,
        files: versionFiles,
        entryPath,
        sizeBytes: totalBytes,
        createdBy: userId,
        createdAt: now,
        changeSummary: input.changeSummary,
        source,
        ...getActorChannelFields(actorChannel),
    }
    if (assistantId) versionBase.assistantId = assistantId

    try {
        await storeVersionFiles(bucket, projectId, targetArtifactId, versionId, input.files)
        if (inherited.length > 0) {
            await copyInheritedFiles(bucket, projectId, targetArtifactId, current.baseVersionId, versionId, inherited)
        }
    } catch (error) {
        await removeStoredVersion(bucket, projectId, targetArtifactId, versionId)
        throw error
    }

    const artifactRef = db.doc(getArtifactDocPath(projectId, targetArtifactId))
    const versionRef = db.doc(`${getArtifactVersionsCollectionPath(projectId, targetArtifactId)}/${versionId}`)
    // Keyed by the version, so a retried transaction writes the same history entry again.
    const historyRef = db.doc(`${getArtifactHistoryCollectionPath(projectId, targetArtifactId)}/version-${versionId}`)

    try {
        return await db.runTransaction(async transaction => {
            if (artifactId) {
                const latest = await readAccessibleArtifact(transaction, db, projectId, artifactId, userId)
                if (current && latest.currentVersionId !== current.baseVersionId) throw artifactChangedError()
                const version = { ...versionBase, versionNumber: (Number(latest.versionCount) || 0) + 1 }
                const patch = {
                    ...describeVersion(version),
                    versionCount: version.versionNumber,
                    lastEditorId: userId,
                    lastEditionDate: now,
                    lastEditorVia,
                }
                if (input.title) patch.title = input.title
                if (input.description) patch.description = input.description
                if (typeof dataAccess === 'boolean' && dataAccess !== (latest.dataAccess === true)) {
                    if (latest.userId !== userId) throw onlyOwnerSwitchesDataAccessError()
                    patch.dataAccess = dataAccess
                }
                transaction.set(versionRef, version)
                transaction.update(artifactRef, patch)
                transaction.set(historyRef, buildVersionHistoryEvent({ created: false, version, userId, now }))
                return { artifactId, versionId, versionNumber: version.versionNumber, created: false }
            }

            const version = { ...versionBase, versionNumber: 1 }
            const artifact = {
                id: targetArtifactId,
                title: input.title || getTitleFromFileName(getFileNameFromPath(entryPath)),
                description: input.description,
                source,
                ...describeVersion(version),
                versionCount: 1,
                serveSecret: newSecret(),
                created: now,
                creatorId: userId,
                userId,
                lastEditorId: userId,
                lastEditionDate: now,
                isPrivate: isPrivate === true,
                isPublicFor: buildArtifactIsPublicFor(isPrivate === true, userId),
                hasStar: '#FFFFFF',
                dataAccess: dataAccess === true,
                followersIds: [userId],
                [FOLLOWER_FIELD]: [userId],
                parentObject,
            }
            if (assistantId) {
                artifact.creatorAssistantId = assistantId
                artifact.assistantId = assistantId
            }
            if (vmOutputKey) artifact.vmOutputKey = vmOutputKey
            if (lastEditorVia) artifact.lastEditorVia = lastEditorVia
            // Written together with the artifact, so it is in the creator's list the moment the call
            // returns instead of after a projection trigger has run.
            Object.assign(artifact, buildObjectAccessProjection(artifact, project.userIds, null, FOLLOWER_FIELD))
            transaction.set(versionRef, version)
            transaction.set(artifactRef, artifact)
            transaction.set(historyRef, buildVersionHistoryEvent({ created: true, version, userId, now }))
            return { artifactId: targetArtifactId, versionId, versionNumber: 1, created: true }
        })
    } catch (error) {
        await removeStoredVersion(bucket, projectId, targetArtifactId, versionId)
        throw error
    }
}

async function restoreArtifactVersion({
    userId,
    projectId,
    artifactId,
    versionId,
    db = admin.firestore(),
    now = Date.now(),
}) {
    validateCaller(userId, projectId)
    if (!versionId || typeof versionId !== 'string')
        throw new HttpsError('invalid-argument', 'A versionId is required.')
    await assertProjectMember(db, projectId, userId)

    return db.runTransaction(async transaction => {
        await readAccessibleArtifact(transaction, db, projectId, artifactId, userId)
        const versionSnapshot = await transaction.get(
            db.doc(`${getArtifactVersionsCollectionPath(projectId, artifactId)}/${versionId}`)
        )
        if (!versionSnapshot.exists) throw new HttpsError('not-found', 'Version not found.')
        const version = { ...versionSnapshot.data(), id: versionId }
        transaction.update(db.doc(getArtifactDocPath(projectId, artifactId)), {
            ...describeVersion({ ...version, files: Array.isArray(version.files) ? version.files : [] }),
            lastEditorId: userId,
            lastEditionDate: now,
        })
        transaction.set(
            db.doc(newHistoryPath(projectId, artifactId, now)),
            buildHistoryEvent(ARTIFACT_HISTORY_TYPES.RESTORED, {
                date: now,
                actorId: userId,
                versionId,
                versionNumber: version.versionNumber,
            })
        )
        return { artifactId, versionId }
    })
}

function onlyOwnerSwitchesDataAccessError() {
    return new HttpsError('permission-denied', "Only the artifact's owner can switch live project data on or off.")
}

// "Live project data" on or off. The owner decides, because switching it on hands every viewer's
// project-shared data to code the owner is answerable for.
async function setArtifactDataAccess({
    userId,
    projectId,
    artifactId,
    enabled,
    actorChannel = null,
    db = admin.firestore(),
    now = Date.now(),
}) {
    validateCaller(userId, projectId)
    if (typeof enabled !== 'boolean') throw new HttpsError('invalid-argument', 'enabled must be true or false.')
    await assertProjectMember(db, projectId, userId)
    return db.runTransaction(async transaction => {
        const artifact = await readAccessibleArtifact(transaction, db, projectId, artifactId, userId)
        if (artifact.userId !== userId) throw onlyOwnerSwitchesDataAccessError()
        if ((artifact.dataAccess === true) === enabled) return { artifactId, dataAccess: enabled, changed: false }
        transaction.update(db.doc(getArtifactDocPath(projectId, artifactId)), { dataAccess: enabled })
        transaction.set(
            db.doc(newHistoryPath(projectId, artifactId, now)),
            buildHistoryEvent(
                enabled ? ARTIFACT_HISTORY_TYPES.DATA_ACCESS_ON : ARTIFACT_HISTORY_TYPES.DATA_ACCESS_OFF,
                {
                    date: now,
                    actorId: userId,
                    ...getActorChannelFields(actorChannel),
                }
            )
        )
        return { artifactId, dataAccess: enabled, changed: true }
    })
}

async function resetArtifactLink({
    userId,
    projectId,
    artifactId,
    db = admin.firestore(),
    now = Date.now(),
    newSecret = generateServeSecret,
}) {
    validateCaller(userId, projectId)
    await assertProjectMember(db, projectId, userId)
    return db.runTransaction(async transaction => {
        await readAccessibleArtifact(transaction, db, projectId, artifactId, userId)
        transaction.update(db.doc(getArtifactDocPath(projectId, artifactId)), {
            serveSecret: newSecret(),
            serveSecretRotatedAt: now,
        })
        transaction.set(
            db.doc(newHistoryPath(projectId, artifactId, now)),
            buildHistoryEvent(ARTIFACT_HISTORY_TYPES.LINK_RESET, { date: now, actorId: userId })
        )
        return { artifactId }
    })
}

// Runs on every artifact update. Read access is lost when the artifact turns private, when its
// audience narrows, or when a member leaves the project (the membership sync rewrites readerIds);
// in each case a link copied before must stop working.
async function rotateServeSecretOnLostReaders({
    db = admin.firestore(),
    projectId,
    artifactId,
    before,
    after,
    now = Date.now(),
    newSecret = generateServeSecret,
}) {
    if (!after) return false
    if (before && after && before.serveSecret !== after.serveSecret) return false
    if (getLostReaderIds(before, after).length === 0) return false
    const batch = db.batch()
    batch.update(db.doc(getArtifactDocPath(projectId, artifactId)), {
        serveSecret: newSecret(),
        serveSecretRotatedAt: now,
    })
    // Nobody pressed anything: the old link stopped working because someone lost access.
    batch.set(
        db.doc(newHistoryPath(projectId, artifactId, now)),
        buildHistoryEvent(ARTIFACT_HISTORY_TYPES.LINK_ROTATED, { date: now })
    )
    await batch.commit()
    return true
}

async function deleteArtifactData({
    db = admin.firestore(),
    bucket = admin.storage().bucket(),
    projectId,
    artifactId,
}) {
    const [versions, history] = await Promise.all([
        db.collection(getArtifactVersionsCollectionPath(projectId, artifactId)).get(),
        db.collection(getArtifactHistoryCollectionPath(projectId, artifactId)).get(),
    ])
    const docs = [...versions.docs, ...history.docs]
    // A batch holds at most 500 writes, and a long-lived artifact can have more history than that.
    for (let start = 0; start < docs.length; start += 450) {
        const batch = db.batch()
        docs.slice(start, start + 450).forEach(doc => batch.delete(doc.ref))
        await batch.commit()
    }
    await bucket.deleteFiles({ prefix: getArtifactStoragePrefix(projectId, artifactId) })
    return { deletedVersions: versions.size, deletedHistory: history.size }
}

module.exports = {
    commitArtifactVersion,
    deleteArtifactData,
    generateServeSecret,
    resetArtifactLink,
    restoreArtifactVersion,
    rotateServeSecretOnLostReaders,
    setArtifactDataAccess,
}
