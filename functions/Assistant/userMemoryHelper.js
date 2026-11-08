const admin = require('firebase-admin')
const moment = require('moment')

const { isProjectMemberData } = require('../shared/privacyAccess')

// security audit 2026-11 (NV-20): what the assistant remembers about a user is PRIVATE to that
// user. It used to live in the user's per-project profile note, which every project member can
// read and edit, so a teammate could plant instructions into another member's assistant system
// context and facts memorised from private threads were readable by the whole project. It now
// lives in a server-only collection: no client rule exists for it, so Firestore's default deny
// keeps every browser out, and only Cloud Functions read or write it. The profile note is never
// read as memory again. A user may opt in to showing the memory to project members, which is
// served read-only through a callable (getAssistantMemoryForViewer), never copied into the note.
const ASSISTANT_MEMORY_COLLECTION = 'assistantMemories'
const USER_MEMORY_CONTEXT_MAX_CHARS = 10000
// What is stored: a little more than what is injected, so an owner editing the text by hand does
// not lose the oldest lines the moment they cross the context cap.
const USER_MEMORY_STORED_MAX_CHARS = 20000

function buildAssistantMemoryDocId(userId, projectId) {
    return `${userId}__${projectId}`
}

function getAssistantMemoryRef(db, userId, projectId) {
    return db.collection(ASSISTANT_MEMORY_COLLECTION).doc(buildAssistantMemoryDocId(userId, projectId))
}

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

// Keeps the NEWEST text when the memory outgrows the stored cap: whole lines are dropped from the
// top, so an entry is never cut in half.
function capStoredMemory(content) {
    const text = String(content || '')
    if (text.length <= USER_MEMORY_STORED_MAX_CHARS) return text
    const lines = text.split('\n')
    while (lines.length > 1 && lines.join('\n').length > USER_MEMORY_STORED_MAX_CHARS) lines.shift()
    const joined = lines.join('\n')
    return joined.length > USER_MEMORY_STORED_MAX_CHARS ? joined.slice(-USER_MEMORY_STORED_MAX_CHARS) : joined
}

function readMemoryData(doc) {
    const data = doc && doc.exists ? doc.data() || {} : {}
    return {
        content: typeof data.content === 'string' ? data.content : '',
        shareWithProjectMembers: data.shareWithProjectMembers === true,
        updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : null,
    }
}

async function readUserMemory({ db = admin.firestore(), projectId, userId }) {
    if (!projectId || !userId) return readMemoryData(null)
    const doc = await getAssistantMemoryRef(db, userId, projectId).get()
    return readMemoryData(doc)
}

async function updateUserMemory({
    db = admin.firestore(),
    projectId,
    requestUserId,
    fact,
    category = '',
    reason = '',
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

    const ref = getAssistantMemoryRef(db, requestUserId, projectId)
    const entry = buildUserMemoryEntry({ fact, category, reason, now })

    const outcome = await db.runTransaction(async transaction => {
        const doc = await transaction.get(ref)
        const { content } = readMemoryData(doc)
        if (content && isDuplicateUserMemory(content, { fact, category, reason })) {
            return { skipped: true }
        }
        const base = content && !content.endsWith('\n') ? `${content}\n` : content
        transaction.set(
            ref,
            {
                userId: requestUserId,
                projectId,
                content: capStoredMemory(`${base}${entry}\n`),
                updatedAt: Date.now(),
                updatedBy: 'assistant',
            },
            { merge: true }
        )
        return { skipped: false }
    })

    if (outcome.skipped) {
        return {
            success: true,
            skipped: true,
            projectId,
            message: 'This is already in the private user memory for the current project',
        }
    }

    return {
        success: true,
        skipped: false,
        projectId,
        entry,
        message: `Saved to the user's private memory for project "${projectId}"`,
    }
}

async function getUserMemoryContextMessage({ db = admin.firestore(), projectId, requestUserId }) {
    if (!projectId || !requestUserId) return ''

    const { content } = await readUserMemory({ db, projectId, userId: requestUserId })
    const trimmedContent = String(content || '').trim()
    if (!trimmedContent) return ''

    // The newest lines matter most: an over-long memory keeps its tail, not its head.
    const compactContent =
        trimmedContent.length > USER_MEMORY_CONTEXT_MAX_CHARS
            ? '...' + trimmedContent.slice(-USER_MEMORY_CONTEXT_MAX_CHARS)
            : trimmedContent

    return `User memory for this project:\n${compactContent}`
}

class AssistantMemoryAccessError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

async function loadProjectForMember(db, projectId, userId) {
    if (!projectId || typeof projectId !== 'string') {
        throw new AssistantMemoryAccessError('invalid-argument', 'A projectId is required.')
    }
    const projectDoc = await db.collection('projects').doc(projectId).get()
    if (!projectDoc.exists || !isProjectMemberData(projectDoc.data(), userId)) {
        throw new AssistantMemoryAccessError('permission-denied', 'You are not a member of this project.')
    }
    return projectDoc.data() || {}
}

// What a person may see of somebody's assistant memory. The owner always sees (and may edit) their
// own; another member sees it only when the owner chose to share it with the project, and then
// read-only. Everyone else - a non-member, a viewer of a link-shared project - sees nothing, and
// "not shared" and "no memory" answer the same way so nothing leaks about whether one exists.
async function getAssistantMemoryForViewer({ db = admin.firestore(), projectId, userId, viewerId }) {
    if (!viewerId) throw new AssistantMemoryAccessError('unauthenticated', 'Authentication required.')
    if (!userId || typeof userId !== 'string') {
        throw new AssistantMemoryAccessError('invalid-argument', 'A userId is required.')
    }
    const project = await loadProjectForMember(db, projectId, viewerId)
    const isOwner = userId === viewerId
    if (!isOwner && !isProjectMemberData(project, userId)) {
        return { isOwner: false, visible: false, content: '', shareWithProjectMembers: false }
    }
    const memory = await readUserMemory({ db, projectId, userId })
    if (isOwner) {
        return { isOwner: true, visible: true, ...memory }
    }
    if (!memory.shareWithProjectMembers) {
        return { isOwner: false, visible: false, content: '', shareWithProjectMembers: false }
    }
    return { isOwner: false, visible: true, content: memory.content, shareWithProjectMembers: true }
}

// Only the owner changes their memory, and only for a project they belong to.
async function updateOwnAssistantMemory({
    db = admin.firestore(),
    projectId,
    userId,
    content,
    shareWithProjectMembers,
}) {
    if (!userId) throw new AssistantMemoryAccessError('unauthenticated', 'Authentication required.')
    await loadProjectForMember(db, projectId, userId)

    const changes = {}
    if (content !== undefined) {
        if (typeof content !== 'string') {
            throw new AssistantMemoryAccessError('invalid-argument', 'Memory content must be text.')
        }
        if (content.length > USER_MEMORY_STORED_MAX_CHARS) {
            throw new AssistantMemoryAccessError(
                'invalid-argument',
                `Memory content may be at most ${USER_MEMORY_STORED_MAX_CHARS} characters.`
            )
        }
        changes.content = content
    }
    if (shareWithProjectMembers !== undefined) {
        if (typeof shareWithProjectMembers !== 'boolean') {
            throw new AssistantMemoryAccessError('invalid-argument', 'shareWithProjectMembers must be true or false.')
        }
        changes.shareWithProjectMembers = shareWithProjectMembers
    }
    if (Object.keys(changes).length === 0) {
        throw new AssistantMemoryAccessError('invalid-argument', 'Nothing to change.')
    }

    await getAssistantMemoryRef(db, userId, projectId).set(
        { userId, projectId, ...changes, updatedAt: Date.now(), updatedBy: 'user' },
        { merge: true }
    )
    const memory = await readUserMemory({ db, projectId, userId })
    return { isOwner: true, visible: true, ...memory }
}

module.exports = {
    ASSISTANT_MEMORY_COLLECTION,
    USER_MEMORY_CONTEXT_MAX_CHARS,
    USER_MEMORY_STORED_MAX_CHARS,
    AssistantMemoryAccessError,
    buildAssistantMemoryDocId,
    normalizeMemoryText,
    buildUserMemoryCore,
    buildUserMemoryEntry,
    isDuplicateUserMemory,
    capStoredMemory,
    readUserMemory,
    updateUserMemory,
    getUserMemoryContextMessage,
    getAssistantMemoryForViewer,
    updateOwnAssistantMemory,
}
