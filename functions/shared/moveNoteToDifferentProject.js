'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')

async function persistNoteMoveFeed(database, params) {
    const { targetProjectId, noteId, movedNote, feedUser, sourceProjectName, sourceProjectColor } = params
    if (!feedUser?.uid) return

    const timestamp = Date.now()
    const feedId = crypto.randomUUID().replace(/-/g, '')
    const feed = {
        type: 74,
        lastChangeDate: timestamp,
        creatorId: feedUser.uid,
        objectId: noteId,
        isPublicFor: movedNote.isPublicFor || [0],
        projectName: sourceProjectName || '',
        projectColor: sourceProjectColor || '',
        changeDirection: 'from',
    }
    const batch = database.batch()
    batch.set(database.doc(`projectsInnerFeeds/${targetProjectId}/notes/${noteId}/feeds/${feedId}`), feed)
    batch.set(database.doc(`feedsStore/${targetProjectId}/all/${feedId}`), feed, { merge: true })
    for (const followerId of movedNote.followersIds || []) {
        batch.set(database.doc(`feedsStore/${targetProjectId}/${followerId}/feeds/followed/${feedId}`), feed, {
            merge: true,
        })
    }
    batch.set(database.doc(`projects/${targetProjectId}`), { lastActionDate: timestamp }, { merge: true })
    await batch.commit()
}

async function moveNoteToDifferentProject(params) {
    const { database, sourceProjectId, targetProjectId, noteId, editorId, editorName, notesBucketName } = params

    if (!sourceProjectId || !targetProjectId || !noteId) {
        throw new Error('sourceProjectId, targetProjectId and noteId are required for note move')
    }
    if (sourceProjectId === targetProjectId) {
        return { moved: false, reason: 'already_in_target_project', sourceProjectId, targetProjectId, noteId }
    }

    const sourceNoteRef = database.doc(`noteItems/${sourceProjectId}/notes/${noteId}`)
    const targetNoteRef = database.doc(`noteItems/${targetProjectId}/notes/${noteId}`)
    const [sourceNoteDoc, targetNoteDoc] = await Promise.all([sourceNoteRef.get(), targetNoteRef.get()])
    if (!sourceNoteDoc.exists && targetNoteDoc.exists) {
        return { moved: false, reason: 'already_moved', sourceProjectId, targetProjectId, noteId }
    }
    if (!sourceNoteDoc.exists) {
        throw new Error(`Note ${noteId} not found in source project ${sourceProjectId}`)
    }
    if (targetNoteDoc.exists) {
        throw new Error(`Cannot move note ${noteId}: target project already contains this note ID.`)
    }
    if (!notesBucketName) throw new Error('Could not resolve notes storage bucket for note move.')

    const storage = params.storage || admin.storage()
    const copyChat = params.copyChat || require('../Chats/chatsFirestoreCloud').copyChatToOtherProject
    const copyInnerFeeds = params.copyInnerFeeds || require('../Feeds/globalFeedsHelper').copyInnerFeedsToOtherProject

    const timestamp = Date.now()
    const movedNote = {
        ...(sourceNoteDoc.data() || {}),
        projectId: targetProjectId,
        lastEditionDate: timestamp,
    }
    if (editorId) movedNote.lastEditorId = editorId
    if (editorName) movedNote.lastEditorName = editorName
    delete movedNote.movingToOtherProjectId

    const notesBucket = storage.bucket(notesBucketName)
    const sourceFile = notesBucket.file(`notesData/${sourceProjectId}/${noteId}`)
    const [contentExists] = await sourceFile.exists()
    if (contentExists) {
        await sourceFile.copy(`gs://${notesBucketName}/notesData/${targetProjectId}/${noteId}`)
    }

    await targetNoteRef.set(movedNote)

    const sourceMoveMarkerUpdate = {
        movingToOtherProjectId: targetProjectId,
        lastEditionDate: timestamp,
    }
    if (editorId) sourceMoveMarkerUpdate.lastEditorId = editorId
    if (editorName) sourceMoveMarkerUpdate.lastEditorName = editorName
    await sourceNoteRef.update(sourceMoveMarkerUpdate)

    try {
        await copyChat(admin, sourceProjectId, targetProjectId, 'notes', noteId)
    } catch (error) {
        console.warn('Note move: failed to copy chat to target project', { noteId, error: error.message })
    }
    try {
        await copyInnerFeeds(admin, sourceProjectId, targetProjectId, 'notes', noteId)
    } catch (error) {
        console.warn('Note move: failed to copy updates feed to target project', { noteId, error: error.message })
    }

    await persistNoteMoveFeed(database, {
        targetProjectId,
        noteId,
        movedNote,
        feedUser: params.feedUser,
        sourceProjectName: params.sourceProjectName,
        sourceProjectColor: params.sourceProjectColor,
    })

    await sourceNoteRef.delete()

    return { moved: true, sourceProjectId, targetProjectId, noteId }
}

module.exports = { moveNoteToDifferentProject, persistNoteMoveFeed }
