import firebase from 'firebase/compat/app'

import store from '../../../redux/store'
import {
    getDb,
    getFirebaseProjectId,
    getFunctionsRegion,
    getLoggedUserAccessReaderId,
    getNoteData,
    runHttpsCallableFunction,
} from '../firestore'
import { updateQuotaTraffic } from '../Premium/premiumFirestore'
import { awaitWriteAck } from '../offlineWriteAck'
import { shouldUseFirebaseEmulators } from '../../firebaseEmulators'
import { buildBacklinkToken, getBacklinkIdsVisibleToField } from '../firestoreAccess'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { updateChatAssistantWithoutFeeds, updateChatPrivacy } from '../Chats/chatsFirestore'
import {
    MAX_ARTIFACT_UPLOAD_BYTES,
    SERVE_ARTIFACT_FUNCTION,
    buildArtifactIsPublicFor,
    buildArtifactServeUrl,
    getArtifactDocPath,
    getArtifactVersionsCollectionPath,
    getArtifactsCollectionPath,
    mapArtifactData,
    mapArtifactVersionData,
    sortArtifactsByLastEdition,
} from '../../../functions/Artifacts/artifactModel'
import { getArtifactHistoryCollectionPath, mapArtifactHistoryEvent } from '../../../functions/Artifacts/artifactHistory'
import { watchLinkedUploads } from './linkedUploads'
import { ARTIFACT_BRIDGE_QUERY_PARAM } from '../../../functions/Artifacts/artifactDataBridge'

// Artifacts are read straight from Firestore and their metadata is edited there; versions and
// bytes are only ever written by the commitArtifactVersion callable (functions/Artifacts).
//
// The list queries carry a single array-contains on a server-owned projection field and sort on the
// client: that needs no composite index, and a project holds few enough artifacts for it.

const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000

function reportListenerError(scope, projectId, onError) {
    return error => {
        // Offline a listener simply waits; anything else is worth a line in the console.
        if (error?.code !== 'unavailable') console.warn(`[artifacts] ${scope} listener failed`, { projectId, error })
        if (onError) onError(error)
    }
}

export function watchProjectArtifacts(projectId, { followedOnly = false } = {}, onChange, onError) {
    const db = getDb()
    if (!db || !projectId) return () => {}
    const query = followedOnly
        ? db
              .collection(getArtifactsCollectionPath(projectId))
              .where('followedReaderIds', 'array-contains', store.getState().loggedUser.uid)
        : db
              .collection(getArtifactsCollectionPath(projectId))
              .where('readerIds', 'array-contains', getLoggedUserAccessReaderId())
    return query.onSnapshot(
        snapshot => onChange(sortArtifactsByLastEdition(snapshot.docs.map(doc => mapArtifactData(doc.id, doc.data())))),
        reportListenerError('list', projectId, onError)
    )
}

// Linked uploads deliberately use the original object views rather than serveArtifact.
export function watchProjectUploads(projectId, onChange, onError) {
    return watchLinkedUploads({
        db: getDb(),
        projectId,
        userId: store.getState().loggedUser?.uid,
        readerId: getLoggedUserAccessReaderId(),
        bucketName: firebase.app().options.storageBucket,
        loadNote: getNoteData,
        onChange,
        onError,
    })
}

export async function getArtifactData(projectId, artifactId) {
    const db = getDb()
    if (!db || !projectId || !artifactId) return null
    try {
        const snapshot = await db.doc(getArtifactDocPath(projectId, artifactId)).get()
        return snapshot.exists ? mapArtifactData(snapshot.id, snapshot.data()) : null
    } catch (error) {
        // An artifact the viewer cannot read is, for the chat, an artifact that is not there.
        if (error?.code !== 'permission-denied') console.warn('[artifacts] read failed', { projectId, error })
        return null
    }
}

// The artifacts made in one object's thread (a task, a goal…): its results. `parentObject` is
// server-owned, so the list cannot be padded by a client. One equality pair next to the
// array-contains needs no composite index.
export function watchObjectArtifacts(projectId, objectType, objectId, onChange, onError) {
    const db = getDb()
    if (!db || !projectId || !objectType || !objectId) return () => {}
    return db
        .collection(getArtifactsCollectionPath(projectId))
        .where('readerIds', 'array-contains', getLoggedUserAccessReaderId())
        .where('parentObject.type', '==', objectType)
        .where('parentObject.id', '==', objectId)
        .onSnapshot(
            snapshot =>
                onChange(sortArtifactsByLastEdition(snapshot.docs.map(doc => mapArtifactData(doc.id, doc.data())))),
            reportListenerError('object results', projectId, onError)
        )
}

// The tasks and notes whose text links to the artifact. Each object carries, per reader, the
// tokens of the objects it links to (backlinkIdsVisibleTo, server-owned), so one array-contains
// proves both the link and that the viewer may read the match; a private task linking the
// artifact never shows up for anybody else.
export const ARTIFACT_BACKLINK_FIELD = 'linkedParentArtifactsIds'

export function watchArtifactBacklinks(projectId, artifactId, onChange, onError) {
    const db = getDb()
    if (!db || !projectId || !artifactId) return () => {}
    const field = getBacklinkIdsVisibleToField(getLoggedUserAccessReaderId())
    const token = buildBacklinkToken(ARTIFACT_BACKLINK_FIELD, artifactId)
    const state = { tasks: [], notes: [] }
    const emit = () => onChange([...state.tasks, ...state.notes].sort((a, b) => b.lastEditionDate - a.lastEditionDate))
    const toLink = (type, doc) => {
        const data = doc.data() || {}
        return {
            type,
            id: doc.id,
            title: type === 'task' ? data.extendedName || data.name || '' : data.extendedTitle || data.title || '',
            done: type === 'task' && data.done === true,
            lastEditionDate: Number(data.lastEditionDate) || Number(data.created) || 0,
        }
    }
    const watch = (collectionPath, type) =>
        db
            .collection(collectionPath)
            .where(field, 'array-contains', token)
            .onSnapshot(
                snapshot => {
                    state[`${type}s`] = snapshot.docs.map(doc => toLink(type, doc))
                    emit()
                },
                reportListenerError(`${type} backlinks`, projectId, onError)
            )
    const unsubs = [watch(`items/${projectId}/tasks`, 'task'), watch(`noteItems/${projectId}/notes`, 'note')]
    return () => unsubs.forEach(unsub => unsub())
}

// The newest entries of the artifact's history (written by Cloud Functions), newest first.
export const ARTIFACT_HISTORY_PAGE_SIZE = 50

export function watchArtifactHistory(projectId, artifactId, onChange, onError) {
    const db = getDb()
    if (!db || !projectId || !artifactId) return () => {}
    return db
        .collection(getArtifactHistoryCollectionPath(projectId, artifactId))
        .orderBy('date', 'desc')
        .limit(ARTIFACT_HISTORY_PAGE_SIZE)
        .onSnapshot(
            snapshot => onChange(snapshot.docs.map(doc => mapArtifactHistoryEvent(doc.id, doc.data()))),
            reportListenerError('history', projectId, onError)
        )
}

// `null` once the artifact is known not to exist (or not to be readable).
export function watchArtifact(projectId, artifactId, onChange, onError) {
    const db = getDb()
    if (!db || !projectId || !artifactId) return () => {}
    return db.doc(getArtifactDocPath(projectId, artifactId)).onSnapshot(
        snapshot => onChange(snapshot.exists ? mapArtifactData(snapshot.id, snapshot.data()) : null),
        reportListenerError('artifact', projectId, error => {
            onChange(null)
            if (onError) onError(error)
        })
    )
}

export function watchArtifactVersions(projectId, artifactId, onChange, onError) {
    const db = getDb()
    if (!db || !projectId || !artifactId) return () => {}
    return db
        .collection(getArtifactVersionsCollectionPath(projectId, artifactId))
        .onSnapshot(
            snapshot =>
                onChange(
                    snapshot.docs
                        .map(doc => mapArtifactVersionData(doc.id, doc.data()))
                        .sort((left, right) => right.versionNumber - left.versionNumber)
                ),
            reportListenerError('versions', projectId, onError)
        )
}

// The serveArtifact function's own URL. It is deliberately a different origin from the app's:
// an HTML artifact must never run on my.alldone.app (see functions/Artifacts/serveArtifact.js).
export function getArtifactServeBaseUrl() {
    const projectId = getFirebaseProjectId()
    const region = getFunctionsRegion()
    if (!projectId || !region) return null
    return shouldUseFirebaseEmulators()
        ? `http://127.0.0.1:5001/${projectId}/${region}/${SERVE_ARTIFACT_FUNCTION}`
        : `https://${region}-${projectId}.cloudfunctions.net/${SERVE_ARTIFACT_FUNCTION}`
}

// `bridge` asks for the address the app frames a data-bound page at: serveArtifact answers it with
// the locked-down policy of the live data bridge (functions/Artifacts/artifactDataBridge.js).
export function getArtifactUrl(projectId, artifact, { versionId = null, path, bridge = false } = {}) {
    if (!artifact) return null
    const url = buildArtifactServeUrl(getArtifactServeBaseUrl(), {
        projectId,
        artifactId: artifact.id,
        serveSecret: artifact.serveSecret,
        versionId,
        path: path === undefined ? artifact.entryPath : path,
    })
    return url && bridge ? `${url}?${ARTIFACT_BRIDGE_QUERY_PARAM}=1` : url
}

// "Live project data" on or off; only the owner may (the server checks).
export function setArtifactDataAccess(projectId, artifactId, enabled) {
    return runHttpsCallableFunction('setArtifactDataAccess', { projectId, artifactId, enabled })
}

export function getTotalFileBytes(files) {
    return Array.from(files || []).reduce((total, file) => total + (Number(file?.size) || 0), 0)
}

export function isArtifactUploadTooLarge(files) {
    return getTotalFileBytes(files) > MAX_ARTIFACT_UPLOAD_BYTES
}

export function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = String(reader.result || '')
            const comma = result.indexOf(',')
            resolve(comma >= 0 ? result.slice(comma + 1) : '')
        }
        reader.onerror = () => reject(reader.error || new Error('Could not read the file'))
        reader.readAsDataURL(file)
    })
}

// One artifact per call. `artifactId` adds a version to an existing artifact instead.
export async function uploadArtifactFiles({ projectId, files, artifactId = null, isPrivate = false, title }) {
    const fileList = Array.from(files || [])
    if (fileList.length === 0) return null
    if (isArtifactUploadTooLarge(fileList)) {
        const error = new Error('The upload is larger than 20 MB.')
        error.code = 'too-large'
        throw error
    }

    const encoded = await Promise.all(
        fileList.map(async file => ({ path: file.name, base64: await readFileAsBase64(file) }))
    )
    const result = await runHttpsCallableFunction(
        'commitArtifactVersion',
        { projectId, artifactId, files: encoded, isPrivate, title },
        { timeout: UPLOAD_TIMEOUT_MS }
    )
    updateQuotaTraffic(projectId, store.getState().loggedUser.uid, getTotalFileBytes(fileList) / 1024 / 1024)
    return result
}

// Metadata edits and deletes work offline like any other Firestore write: the caller continues as
// soon as the write is queued instead of waiting for a server ack that cannot arrive (AT-2340).
export function updateArtifactMetadata(projectId, artifactId, patch) {
    const write = getDb()
        .doc(getArtifactDocPath(projectId, artifactId))
        .update({
            ...patch,
            lastEditorId: store.getState().loggedUser.uid,
            lastEditionDate: Date.now(),
        })
    return awaitWriteAck(write, 'artifact metadata')
}

// Private means visible to the owner only. firestore.rules lets a write through only when the new
// audience still includes the writer, so in practice only the owner can make an artifact private.
export function setArtifactPrivacy(projectId, artifact, isPrivate) {
    const ownerId = artifact.userId || store.getState().loggedUser.uid
    const isPublicFor = buildArtifactIsPublicFor(isPrivate, ownerId)
    // The artifact's chat follows it, like a note's or a skill's: a private artifact has a private
    // conversation. The chat write only happens when that chat exists.
    updateChatPrivacy(projectId, artifact.id, 'artifacts', isPublicFor).catch(error =>
        console.warn('[artifacts] chat privacy update failed', { projectId, error })
    )
    return updateArtifactMetadata(projectId, artifact.id, { isPrivate, isPublicFor })
}

// The assistant that answers in the artifact's chat. Choosing one is not an edit of the artifact,
// so the edition stamps stay where they are.
export async function setArtifactAssistant(projectId, artifactId, assistantId) {
    const batch = new BatchWrapper(getDb())
    batch.update(getDb().doc(getArtifactDocPath(projectId, artifactId)), { assistantId })
    await updateChatAssistantWithoutFeeds(projectId, artifactId, assistantId, batch)
    await awaitWriteAck(batch.commit(), 'artifact assistant')
}

export function updateArtifactLastCommentData(projectId, artifactId, lastComment, lastCommentType) {
    const write = getDb()
        .doc(getArtifactDocPath(projectId, artifactId))
        .update({
            [`commentsData.lastComment`]: lastComment,
            [`commentsData.lastCommentType`]: lastCommentType,
            [`commentsData.amount`]: firebase.firestore.FieldValue.increment(1),
        })
    return awaitWriteAck(write, 'artifact last comment')
}

export async function resetArtifactLastCommentData(projectId, artifactId) {
    const artifact = await getArtifactData(projectId, artifactId)
    if (!(artifact?.commentsData?.amount > 0)) return
    await awaitWriteAck(
        getDb()
            .doc(getArtifactDocPath(projectId, artifactId))
            .update({
                [`commentsData.lastComment`]: null,
                [`commentsData.lastCommentType`]: null,
                [`commentsData.amount`]: 0,
            }),
        'artifact last comment reset'
    )
}

export function deleteArtifact(projectId, artifactId) {
    return awaitWriteAck(getDb().doc(getArtifactDocPath(projectId, artifactId)).delete(), 'artifact delete')
}

export function restoreArtifactVersion(projectId, artifactId, versionId) {
    return runHttpsCallableFunction('restoreArtifactVersion', { projectId, artifactId, versionId })
}

// Copies a chat or note attachment into a new private artifact. Only the URL travels: the server
// reads the file it already stores, after checking the URL's own download token.
export function saveAttachmentAsArtifact(projectId, url, fileName) {
    return runHttpsCallableFunction('saveAttachmentAsArtifact', { projectId, url, fileName })
}

export function resetArtifactLink(projectId, artifactId) {
    return runHttpsCallableFunction('resetArtifactLink', { projectId, artifactId })
}
