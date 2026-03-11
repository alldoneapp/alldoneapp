const admin = require('firebase-admin')
const moment = require('moment')

const { NoteService } = require('../shared/NoteService')
const { UserHelper } = require('../shared/UserHelper')

const FEED_PUBLIC_FOR_ALL = 0
const USER_MEMORY_CONTEXT_MAX_CHARS = 4000

function normalizeMemoryText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\[[^\]]+\]/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function buildUserMemoryCore({ fact, category = '', reason = '' }) {
    const safeFact = String(fact || '').trim()
    const safeCategory = String(category || '').trim()
    const safeReason = String(reason || '').trim()
    const categoryPrefix = safeCategory ? `[${safeCategory}] ` : ''
    const reasonSuffix = safeReason ? ` (${safeReason})` : ''
    return `${categoryPrefix}${safeFact}${reasonSuffix}`.trim()
}

function buildUserMemoryEntry({ fact, category = '', reason = '', now = null, momentLib = moment }) {
    const dateLabel = (momentLib || moment)(now || Date.now()).format('YYYY-MM-DD')
    return `${dateLabel}: ${buildUserMemoryCore({ fact, category, reason })}`
}

function isDuplicateUserMemory(existingContent, { fact, category = '', reason = '' }) {
    const normalizedExisting = normalizeMemoryText(existingContent)
    if (!normalizedExisting) return false

    const normalizedCore = normalizeMemoryText(buildUserMemoryCore({ fact, category, reason }))
    if (normalizedCore && normalizedExisting.includes(normalizedCore)) return true

    const normalizedFact = normalizeMemoryText(fact)
    return !!normalizedFact && normalizedExisting.includes(normalizedFact)
}

async function getNoteService(db, noteService = null) {
    if (noteService) return noteService

    const service = new NoteService({
        database: db,
        moment,
        idGenerator: () => db.collection('_').doc().id,
        enableFeeds: true,
        enableValidation: false,
        isCloudFunction: true,
    })
    await service.initialize()
    return service
}

async function ensureUserMemoryNote({
    db = admin.firestore(),
    projectId,
    requestUserId,
    userData = null,
    feedUser = null,
    noteService = null,
}) {
    if (!projectId || typeof projectId !== 'string') {
        throw new Error('Project ID is required for user memory')
    }

    if (!requestUserId || typeof requestUserId !== 'string') {
        throw new Error('requestUserId is required for user memory')
    }

    const userRef = db.collection('users').doc(requestUserId)
    const userDoc = userData ? { exists: true, data: () => userData } : await userRef.get()
    if (!userDoc.exists) {
        throw new Error(`User ${requestUserId} not found`)
    }

    const user = userDoc.data() || {}
    const existingNoteId = user.noteIdsByProject && user.noteIdsByProject[projectId]
    if (existingNoteId) {
        return { noteId: existingNoteId, created: false, user }
    }

    const finalNoteService = await getNoteService(db, noteService)
    const finalFeedUser = feedUser || (await UserHelper.getFeedUserData(db, requestUserId))
    const displayName = user.displayName || user.name || 'User memory'
    const isPublicFor =
        Array.isArray(user.isPublicFor) && user.isPublicFor.length > 0
            ? user.isPublicFor
            : [FEED_PUBLIC_FOR_ALL, requestUserId]
    const noteTitle = `${displayName} memory`

    const result = await finalNoteService.createAndPersistNote({
        title: noteTitle,
        extendedTitle: noteTitle,
        content: `# ${noteTitle}\n\n`,
        userId: requestUserId,
        projectId,
        isPrivate: !isPublicFor.includes(FEED_PUBLIC_FOR_ALL),
        isPublicFor,
        parentObject: { id: requestUserId, type: 'users' },
        feedUser: finalFeedUser,
    })

    await userRef.update({
        [`noteIdsByProject.${projectId}`]: result.noteId,
        lastEditionDate: Date.now(),
        lastEditorId: requestUserId,
    })

    return { noteId: result.noteId, created: true, user }
}

async function updateUserMemory({
    db = admin.firestore(),
    projectId,
    requestUserId,
    fact,
    category = '',
    reason = '',
    noteService = null,
    feedUser = null,
    userData = null,
    now = null,
}) {
    if (!requestUserId || typeof requestUserId !== 'string') {
        throw new Error('update_user_memory requires requestUserId in runtime context')
    }

    if (!projectId || typeof projectId !== 'string') {
        throw new Error('update_user_memory requires a current project context')
    }

    if (!fact || typeof fact !== 'string' || fact.trim() === '') {
        throw new Error('update_user_memory requires a non-empty fact')
    }

    const finalNoteService = await getNoteService(db, noteService)
    const finalFeedUser = feedUser || (await UserHelper.getFeedUserData(db, requestUserId))
    const noteState = await ensureUserMemoryNote({
        db,
        projectId,
        requestUserId,
        userData,
        feedUser: finalFeedUser,
        noteService: finalNoteService,
    })

    let existingContent = ''
    try {
        existingContent = (await finalNoteService.getStorageContent(projectId, noteState.noteId)) || ''
    } catch (error) {
        console.warn('USER MEMORY: Failed loading existing note content for dedupe', {
            projectId,
            requestUserId,
            noteId: noteState.noteId,
            error: error.message,
        })
    }

    if (existingContent && isDuplicateUserMemory(existingContent, { fact, category, reason })) {
        return {
            success: true,
            skipped: true,
            createdNote: noteState.created,
            noteId: noteState.noteId,
            projectId,
            message: 'User memory already exists in the current project note',
        }
    }

    const entry = buildUserMemoryEntry({ fact, category, reason, now })
    await finalNoteService.addContentToStorage(projectId, noteState.noteId, `${entry}\n`, finalFeedUser)

    return {
        success: true,
        skipped: false,
        createdNote: noteState.created,
        noteId: noteState.noteId,
        projectId,
        entry,
        message: `User memory saved in project "${projectId}"`,
    }
}

async function getUserMemoryContextMessage({
    db = admin.firestore(),
    projectId,
    requestUserId,
    noteService = null,
    userData = null,
}) {
    if (!projectId || !requestUserId) return ''

    const userDoc = userData
        ? { exists: true, data: () => userData }
        : await db.collection('users').doc(requestUserId).get()
    if (!userDoc.exists) return ''

    const user = userDoc.data() || {}
    const noteId = user.noteIdsByProject && user.noteIdsByProject[projectId]
    if (!noteId) return ''

    const finalNoteService = await getNoteService(db, noteService)
    const content = await finalNoteService.getStorageContent(projectId, noteId).catch(() => '')
    const trimmedContent = String(content || '').trim()
    if (!trimmedContent) return ''

    const compactContent =
        trimmedContent.length > USER_MEMORY_CONTEXT_MAX_CHARS
            ? trimmedContent.substring(0, USER_MEMORY_CONTEXT_MAX_CHARS) + '...'
            : trimmedContent

    return `User memory for this project:\n${compactContent}`
}

module.exports = {
    USER_MEMORY_CONTEXT_MAX_CHARS,
    normalizeMemoryText,
    buildUserMemoryCore,
    buildUserMemoryEntry,
    isDuplicateUserMemory,
    ensureUserMemoryNote,
    updateUserMemory,
    getUserMemoryContextMessage,
}
