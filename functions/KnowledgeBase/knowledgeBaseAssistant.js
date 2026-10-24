'use strict'

// What a project's assistants get from its wiki: the page index in their prompt, a tool to read a
// page, and — when a project member is talking to them — tools to correct a page and to take a
// correction back.
//
// The tools have no Tools Access toggle, like load_skill: the wiki itself is the access control.
// They are offered exactly when the run's project has a wiki with at least one visible page and the
// person the run answers is a member of that project, because a member may read the whole wiki
// tree anyway (firestore.rules). Two kinds of run never get them:
//   - the email channel is action-only and can reply to people outside the project, and Gmail
//     labeling runs on untrusted mail without anyone asking; neither may read project knowledge;
//   - writing is reserved for runs that answer a member directly (`allowKnowledgeCorrections`,
//     set by the in-app chat, the WhatsApp bridge and the voice calls that pass
//     canCorrectKnowledgeBaseOnChannel). A heartbeat, a recurring task, a delegated assistant or a
//     reply drafted from an email is not a member saying "this is wrong", and writing mode never
//     writes.
//
// A correction is a source of its own (knowledgeBases/{projectId}/corrections/{id}): it is stored
// together with the page revision it produced, the ingest treats it as overriding older sources,
// and undoing it restores the revision before it — as long as nobody changed the page since.

const crypto = require('crypto')
const { FieldValue } = require('firebase-admin/firestore')

const {
    getKnowledgeBasePath,
    getKnowledgeCorrectionsPath,
    getKnowledgePagePath,
    getKnowledgePagesPath,
    isKnowledgePageVisible,
    normalizeKnowledgePageSlug,
} = require('./knowledgeBaseModel')
const { buildKnowledgeIndex, restoreKnowledgePageRevision, writeKnowledgePage } = require('./knowledgePageStore')
const {
    CORRECT_KNOWLEDGE_PAGE_TOOL,
    KNOWLEDGE_BASE_TOOL_NAMES,
    KNOWLEDGE_CORRECTION_MAX_CHARS,
    READ_KNOWLEDGE_PAGE_TOOL,
    UNDO_KNOWLEDGE_CORRECTION_TOOL,
} = require('./knowledgeBaseToolSchemas')

// The index rides in every prompt of the project, so it gets a tighter budget than the ingest's.
const KNOWLEDGE_CONTEXT_INDEX_MAX_CHARS = 6000
// Whether a project has a readable wiki is asked once per model round; only that yes/no is cached,
// never page content, so a withdrawn source cannot linger in a prompt through this cache.
const AVAILABILITY_TTL_MS = 30 * 1000
const NEW_CORRECTION_TOKEN = /\[\[\s*correction:new\s*(\|[^\]]*)?\]\]/g

const ACCESS_NONE = 'none'
const ACCESS_READ = 'read'
const ACCESS_CORRECT = 'correct'

/**
 * How much of the project wiki a run may use, from its runtime context: 'none', 'read' or
 * 'correct'. The same answer decides the prompt context, which tools are offered and whether a
 * tool call is executed.
 */
function resolveKnowledgeBaseAccess(context) {
    // Like load_skill, the wiki comes with an assistant: a bare model call (the writing router)
    // has no tools at all.
    if (!context?.projectId || !context?.requestUserId || !context?.assistantId) return ACCESS_NONE
    if (context.channel === 'email' || context.sourceChannel === 'email' || context.gmailContext) return ACCESS_NONE
    // Writing mode executes read tools only (assistantWritingTools.js).
    if (context.writingDraft) return ACCESS_READ
    return context.allowKnowledgeCorrections === true ? ACCESS_CORRECT : ACCESS_READ
}

// Channels on which the person talking is the account holder as the channel itself verified them:
// a call from inside the app, and WhatsApp messages and calls (the number WhatsApp verified). A phone
// call over the public network is matched to an account by its caller ID alone, which can be
// forged, so it may read the wiki but never change what the whole project sees. The in-app chat
// sets the flag itself.
const KNOWLEDGE_CORRECTION_CHANNELS = ['browser_call', 'whatsapp', 'whatsapp_call']

function canCorrectKnowledgeBaseOnChannel(channel) {
    return KNOWLEDGE_CORRECTION_CHANNELS.includes(channel)
}

function failure(error) {
    return { success: false, error }
}

async function isProjectMember(db, projectId, userId) {
    const snapshot = await db.doc(`projects/${projectId}`).get()
    if (!snapshot.exists) return null
    const project = snapshot.data() || {}
    const userIds = Array.isArray(project.userIds) ? project.userIds : []
    return userIds.includes(userId) ? project : null
}

// Only the fields the index needs: a page body is up to 20,000 characters and there may be 150.
async function loadIndexPages(db, projectId) {
    const snapshot = await db
        .collection(getKnowledgePagesPath(projectId))
        .select('title', 'summary', 'archived', 'needsRebuild')
        .get()
    const pages = new Map()
    snapshot.docs.forEach(doc => {
        const page = { ...(doc.data() || {}), slug: doc.id }
        if (isKnowledgePageVisible(page)) pages.set(doc.id, page)
    })
    return pages
}

function buildKnowledgeBaseContextMessage({ projectName, pages, access }) {
    const index = buildKnowledgeIndex(pages, { maxChars: KNOWLEDGE_CONTEXT_INDEX_MAX_CHARS })
    const truncated = index.includes('more pages')
    const lines = [
        `Project wiki of "${projectName}":`,
        "- Context rule: The wiki is compiled automatically from the project's shared tasks, goals, notes and contacts and updated about once a day. Use it as background knowledge about the project. It can be out of date: when it disagrees with the conversation or with a task, note or goal you look up, those win.",
        `- To use a page, call ${READ_KNOWLEDGE_PAGE_TOOL} with its slug${
            truncated ? `; call it without a slug for the full list of pages` : ''
        }. Name pages by their title, never by [[...]] tokens.`,
    ]
    if (access === ACCESS_CORRECT) {
        lines.push(
            `- When the user says something in the wiki is wrong or missing, read the page, then call ${CORRECT_KNOWLEDGE_PAGE_TOOL} with their correction in their own words and the corrected page. Change only what they asked for, and never put anything into the wiki that you know from private tasks, notes or chats. To take a correction back, call ${UNDO_KNOWLEDGE_CORRECTION_TOOL}.`
        )
    }
    lines.push('Pages:', index)
    return lines.join('\n')
}

/**
 * The wiki block of an assistant's system prompt, or '' when the run may not use the wiki or the
 * project has none. Read fresh every time: it carries page titles and summaries, and a page that
 * lost a source must disappear from the next prompt, not from one a cache decides on.
 */
async function getKnowledgeBaseContextMessage({ db, context }) {
    const access = resolveKnowledgeBaseAccess(context)
    if (access === ACCESS_NONE) return ''
    const knowledgeBase = await db.doc(getKnowledgeBasePath(context.projectId)).get()
    if (!knowledgeBase.exists) return ''
    const project = await isProjectMember(db, context.projectId, context.requestUserId)
    if (!project) return ''
    const pages = await loadIndexPages(db, context.projectId)
    if (!pages.size) return ''
    return buildKnowledgeBaseContextMessage({ projectName: project.name || context.projectId, pages, access })
}

const availabilityCache = new Map()

async function hasReadableKnowledgeBase({ db, projectId, userId, now = Date.now() }) {
    const cacheKey = `${projectId}|${userId}`
    const cached = availabilityCache.get(cacheKey)
    if (cached && cached.expiresAt > now) return cached.available

    let available = false
    const knowledgeBase = await db.doc(getKnowledgeBasePath(projectId)).get()
    if (knowledgeBase.exists && (await isProjectMember(db, projectId, userId))) {
        const visible = await db
            .collection(getKnowledgePagesPath(projectId))
            .where('archived', '==', false)
            .where('needsRebuild', '==', false)
            .limit(1)
            .get()
        available = !visible.empty
    }
    availabilityCache.set(cacheKey, { available, expiresAt: now + AVAILABILITY_TTL_MS })
    return available
}

function toolNamesForAccess(access) {
    if (access === ACCESS_CORRECT) return [...KNOWLEDGE_BASE_TOOL_NAMES]
    if (access === ACCESS_READ) return [READ_KNOWLEDGE_PAGE_TOOL]
    return []
}

/** The wiki tools to offer a run, added to the assistant's own tools like load_skill. */
async function getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext, now }) {
    const access = resolveKnowledgeBaseAccess(toolRuntimeContext)
    if (access === ACCESS_NONE) return []
    const available = await hasReadableKnowledgeBase({
        db,
        projectId: toolRuntimeContext.projectId,
        userId: toolRuntimeContext.requestUserId,
        now,
    })
    return available ? toolNamesForAccess(access) : []
}

async function isKnowledgeBaseToolAllowed({ db, toolName, toolRuntimeContext, now }) {
    return (await getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext, now })).includes(toolName)
}

async function loadAuthorName(db, userId) {
    const snapshot = await db.doc(`users/${userId}`).get()
    const user = snapshot.exists ? snapshot.data() || {} : {}
    return String(user.displayName || user.name || '').trim() || 'a project member'
}

function toIso(value) {
    const millis = Number(value)
    return Number.isFinite(millis) && millis > 0 ? new Date(millis).toISOString() : null
}

async function readKnowledgePage({ db, projectId, slug }) {
    if (!slug) {
        const pages = await loadIndexPages(db, projectId)
        return {
            success: true,
            projectId,
            pages: [...pages.values()]
                .sort((left, right) => String(left.title || left.slug).localeCompare(String(right.title || right.slug)))
                .map(page => ({ slug: page.slug, title: page.title || page.slug, summary: page.summary || '' })),
        }
    }
    const key = normalizeKnowledgePageSlug(slug)
    const snapshot = key ? await db.doc(getKnowledgePagePath(projectId, key)).get() : null
    const page = snapshot?.exists ? snapshot.data() || {} : null
    if (!page || page.archived === true) return failure(`There is no wiki page "${key || slug}".`)
    if (!isKnowledgePageVisible(page)) {
        return failure(`The wiki page "${key}" is being rebuilt because one of its sources changed. Try again later.`)
    }
    const labels = page.sourceLabels || {}
    return {
        success: true,
        projectId,
        slug: key,
        title: page.title || key,
        summary: page.summary || '',
        body: page.body || '',
        revision: Number(page.revision) || 0,
        updatedAt: toIso(page.updatedAt),
        sources: (Array.isArray(page.sourceKeys) ? page.sourceKeys : []).map(sourceKey => ({
            key: sourceKey,
            label: labels[sourceKey] || '',
        })),
        note: 'Tokens such as [[task:ID]] cite the project objects a statement comes from, and [[slug]] links another page. Keep them when you correct the page; never show them to the user.',
    }
}

async function correctKnowledgePage({ db, projectId, userId, assistantId, args, toolRuntimeContext, now, fieldValue }) {
    const slug = normalizeKnowledgePageSlug(args.slug)
    if (!slug) return failure('correct_knowledge_page needs the slug of the page to correct.')
    const text = String(args.correction || '').trim()
    if (!text) return failure("correct_knowledge_page needs the user's correction in their own words.")
    if (text.length > KNOWLEDGE_CORRECTION_MAX_CHARS) {
        return failure(`The correction is ${text.length} characters; keep it under ${KNOWLEDGE_CORRECTION_MAX_CHARS}.`)
    }
    const expectedRevision = Number(args.revision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        return failure(`Read the page with ${READ_KNOWLEDGE_PAGE_TOOL} first and pass the revision it returned.`)
    }

    const snapshot = await db.doc(getKnowledgePagePath(projectId, slug)).get()
    const current = snapshot.exists ? snapshot.data() || {} : null
    if (!current || current.archived === true) return failure(`There is no wiki page "${slug}" to correct.`)
    if (!isKnowledgePageVisible(current)) {
        return failure(`The wiki page "${slug}" is being rebuilt right now and cannot be corrected. Try again later.`)
    }

    const correctionId = crypto.randomBytes(10).toString('hex')
    const correctionKey = `correction:${correctionId}`
    const authorName = await loadAuthorName(db, userId)
    const body = String(args.body || '').replace(NEW_CORRECTION_TOKEN, (match, label) =>
        label ? `[[${correctionKey}${label}]]` : `[[${correctionKey}]]`
    )
    const correctionRef = db.doc(`${getKnowledgeCorrectionsPath(projectId)}/${correctionId}`)

    const result = await writeKnowledgePage({
        db,
        projectId,
        slug,
        title: args.title || current.title,
        summary: args.summary === undefined ? current.summary : args.summary,
        body,
        sourceKeys: [correctionKey],
        allowedSourceKeys: new Set([correctionKey]),
        sourceLabels: { [correctionKey]: `Correction by ${authorName}` },
        expectedRevision,
        mode: 'correction',
        author: { type: 'user', userId, name: authorName, correctionId, assistantId: assistantId || null },
        reason: text,
        now,
        fieldValue,
        onWrite: (transaction, { revision, previousRevision }) =>
            transaction.set(correctionRef, {
                text,
                authorUserId: userId,
                authorName,
                assistantId: assistantId || null,
                pageSlug: slug,
                status: 'applied',
                revisionBefore: previousRevision,
                revisionAfter: revision,
                objectType: toolRuntimeContext?.objectType || null,
                objectId: toolRuntimeContext?.objectId || null,
                createdAt: now,
            }),
    })
    if (!result.success) return result
    return {
        success: true,
        projectId,
        slug,
        revision: result.revision,
        correctionId,
        removedSourceReferences: result.removedSourceReferences,
        note: `The correction is applied and visible to everyone in the project. It can be undone with ${UNDO_KNOWLEDGE_CORRECTION_TOOL} while the page is unchanged.`,
    }
}

/**
 * Takes a correction back by restoring the page revision before it. Shared by the assistant tool
 * and the wiki history's Undo button, so both apply the same rules.
 */
async function undoKnowledgeCorrection({
    db,
    projectId,
    userId,
    correctionId,
    now = Date.now(),
    fieldValue = FieldValue,
}) {
    if (!projectId || !userId || !correctionId) return failure('An undo needs the project and the correction.')
    if (!(await isProjectMember(db, projectId, userId))) return failure('You are not a member of this project.')
    const correctionRef = db.doc(`${getKnowledgeCorrectionsPath(projectId)}/${correctionId}`)
    const snapshot = await correctionRef.get()
    const correction = snapshot.exists ? snapshot.data() || {} : null
    if (!correction) return failure(`There is no correction "${correctionId}".`)
    if (correction.status === 'reverted') return failure('This correction was already undone.')

    const authorName = await loadAuthorName(db, userId)
    const result = await restoreKnowledgePageRevision({
        db,
        projectId,
        slug: correction.pageSlug,
        expectedRevision: correction.revisionAfter,
        targetRevision: correction.revisionBefore,
        author: { type: 'user', userId, name: authorName, undoneCorrectionId: correctionId },
        reason: `Undid the correction: ${correction.text || ''}`,
        now,
        fieldValue,
        onWrite: (transaction, { revision }) =>
            transaction.set(
                correctionRef,
                { status: 'reverted', revertedAt: now, revertedBy: userId, revertRevision: revision },
                { merge: true }
            ),
    })
    return result.success ? { ...result, projectId, correctionId } : result
}

/**
 * Runs one wiki tool call. The access decision is taken again here rather than trusted from the
 * caller, and a `projectId` the model passes is checked for membership like the run's own.
 */
async function executeKnowledgeBaseTool({
    db,
    toolName,
    args = {},
    assistantId = null,
    toolRuntimeContext,
    now = Date.now(),
    fieldValue = FieldValue,
}) {
    const access = resolveKnowledgeBaseAccess(toolRuntimeContext)
    if (!toolNamesForAccess(access).includes(toolName)) return failure(`Tool not permitted here: ${toolName}`)
    const userId = toolRuntimeContext.requestUserId
    const projectId =
        typeof args.projectId === 'string' && args.projectId ? args.projectId : toolRuntimeContext.projectId
    if (!(await isProjectMember(db, projectId, userId))) {
        return failure('The wiki of that project is only available to its members.')
    }

    switch (toolName) {
        case READ_KNOWLEDGE_PAGE_TOOL:
            return readKnowledgePage({ db, projectId, slug: args.slug })
        case CORRECT_KNOWLEDGE_PAGE_TOOL:
            return correctKnowledgePage({
                db,
                projectId,
                userId,
                assistantId,
                args,
                toolRuntimeContext,
                now,
                fieldValue,
            })
        case UNDO_KNOWLEDGE_CORRECTION_TOOL:
            return undoKnowledgeCorrection({ db, projectId, userId, correctionId: args.correctionId, now, fieldValue })
        default:
            return failure(`Unknown wiki tool: ${toolName}`)
    }
}

module.exports = {
    resolveKnowledgeBaseAccess,
    canCorrectKnowledgeBaseOnChannel,
    buildKnowledgeBaseContextMessage,
    getKnowledgeBaseContextMessage,
    getKnowledgeBaseToolNamesForRun,
    isKnowledgeBaseToolAllowed,
    executeKnowledgeBaseTool,
    undoKnowledgeCorrection,
    _resetKnowledgeBaseAvailabilityCacheForTests: () => availabilityCache.clear(),
}
