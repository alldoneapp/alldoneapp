'use strict'

// security audit 2026-11 (notes-collab:y-websocket-room-by-noteId-without-credential).
//
// The notes collaboration server (alldone-notes-collab-server, Cloud Run) holds one Yjs room per
// note and used to accept anybody who knew a note id. It has no database credentials of its own,
// so it asks this endpoint, server to server, whether the signed-in user behind a connection may
// read and write the note:
//
//     POST { idToken, projectId, noteId }   header X-Notes-Access-Secret: <NOTES_COLLAB_ACCESS_SECRET>
//     200  { read, write, uid, expiresAt }  401 bad secret / bad token, 403 no access, 400 bad input
//
// The decision mirrors storage.notes.rules exactly, because the room carries the same note body:
//   - a project member (projects/{projectId}.userIds) may read and write a note whose access
//     projection names them, or, only while no projection field exists yet, whose isPublicFor does
//     (canAccessObjectWhileProjectionIsPending in firestore.rules);
//   - a project member may use the room of a note whose document does not exist (yet): a note is
//     opened right after it is created, and setNoteProject writes the body before the document;
//   - a non-member of a public project (isShared != 2) may READ a note public within it.
// The missing-document allowance is only safe because the collab server keys its rooms by
// `${projectId}/${noteId}` once it enforces this: a member of project A asking for an id that lives
// in project B lands in an empty room of A, never in B's.

const crypto = require('crypto')

const PRIVATE_PROJECT = 2
const PUBLIC_FOR_ALL = 0
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const PROJECTION_FIELDS = [
    'readerIds',
    'roleIdsVisibleTo',
    'followedByVisibleTo',
    'followedReaderIds',
    'backlinkIdsVisibleTo',
]

const NO_ACCESS = Object.freeze({ read: false, write: false })

function secretMatches(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false
    // Hash both sides so the comparison is constant-time and independent of the lengths.
    const a = crypto.createHash('sha256').update(provided).digest()
    const b = crypto.createHash('sha256').update(expected).digest()
    return crypto.timingSafeEqual(a, b)
}

function isMember(projectData, uid) {
    return !!uid && Array.isArray(projectData?.userIds) && projectData.userIds.includes(uid)
}

function projectionNames(note, uid) {
    const has = (field, check) => note[field] !== undefined && note[field] !== null && check(note[field])
    return (
        has('readerIds', v => Array.isArray(v) && v.includes(uid)) ||
        has('roleIdsVisibleTo', v => typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, uid)) ||
        has('backlinkIdsVisibleTo', v => typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, uid)) ||
        has('followedReaderIds', v => Array.isArray(v) && v.includes(uid)) ||
        has('followedByVisibleTo', v => typeof v === 'object' && v[uid] === true)
    )
}

function projectionAbsent(note) {
    return PROJECTION_FIELDS.every(field => !(field in note))
}

/**
 * Pure decision. `project` and `note` are document data, or null when the document does not exist.
 */
function decideNoteRoomAccess({ uid, project, note }) {
    if (!uid || !project) return NO_ACCESS
    if (isMember(project, uid)) {
        if (!note) return { read: true, write: true }
        const isPublicFor = Array.isArray(note.isPublicFor) ? note.isPublicFor : []
        if (
            projectionNames(note, uid) ||
            (projectionAbsent(note) && (isPublicFor.includes(PUBLIC_FOR_ALL) || isPublicFor.includes(uid)))
        ) {
            return { read: true, write: true }
        }
        return NO_ACCESS
    }
    const isShared = project.isShared === undefined ? PRIVATE_PROJECT : project.isShared
    if (
        note &&
        isShared !== PRIVATE_PROJECT &&
        Array.isArray(note.readerIds) &&
        note.readerIds.includes(PUBLIC_FOR_ALL)
    ) {
        return { read: true, write: false }
    }
    return NO_ACCESS
}

function createNotesCollabAccessHandler({ db, auth, getSecret }) {
    return async function handleNotesCollabAccess(req, res) {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'method_not_allowed' })
            return
        }
        if (!secretMatches(req.get('X-Notes-Access-Secret'), getSecret())) {
            res.status(401).json({ error: 'unauthorized' })
            return
        }
        const { idToken, projectId, noteId } = req.body || {}
        if (
            typeof idToken !== 'string' ||
            !idToken ||
            !ID_PATTERN.test(String(projectId || '')) ||
            !ID_PATTERN.test(String(noteId || ''))
        ) {
            res.status(400).json({ error: 'invalid_request' })
            return
        }

        let decoded
        try {
            decoded = await auth.verifyIdToken(idToken)
        } catch (error) {
            res.status(401).json({ error: 'invalid_token' })
            return
        }

        const [projectDoc, noteDoc] = await Promise.all([
            db.collection('projects').doc(projectId).get(),
            db.collection('noteItems').doc(projectId).collection('notes').doc(noteId).get(),
        ])
        const access = decideNoteRoomAccess({
            uid: decoded.uid,
            project: projectDoc.exists ? projectDoc.data() || {} : null,
            note: noteDoc.exists ? noteDoc.data() || {} : null,
        })
        if (!access.read) {
            res.status(403).json({ error: 'forbidden' })
            return
        }
        res.status(200).json({
            read: true,
            write: access.write,
            uid: decoded.uid,
            expiresAt: Number(decoded.exp) * 1000,
        })
    }
}

module.exports = { decideNoteRoomAccess, createNotesCollabAccessHandler, secretMatches }
