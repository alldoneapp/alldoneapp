'use strict'

// What a project's assistants get from its wiki: the page index in their prompt, a tool to read a
// page, and — when a project member is talking to them — tools to correct a page, to take a
// correction back, and to add a document they sent to the wiki or take it out again
// (knowledgeDocuments.js), and — only when they ask for it — to save knowledge from the
// conversation (knowledgeContributions.js). Every member run can also search the pages' text
// (knowledgeSearch.js).
//
// The tools have no Tools Access toggle, like load_skill: the wiki itself is the access control.
// Reading is offered to member runs even when the conversation's project has no wiki: a question
// can concern another project. Every read checks membership of its target project. Correction
// tools need visible pages in the conversation's project; document tools need a wiki that is
// switched on, not one that has pages, because a deck is often the first thing a new wiki gets.
// Two kinds of run never get them:
//   - the email channel is action-only and can reply to people outside the project, and Gmail
//     labeling runs on untrusted mail without anyone asking; neither may read project knowledge;
//   - writing is reserved for runs that answer a member directly (`allowKnowledgeCorrections`,
//     set by the in-app chat, the WhatsApp bridge and the voice calls that pass
//     canCorrectKnowledgeBaseOnChannel). A heartbeat, a recurring task, a delegated assistant or a
//     reply drafted from an email is not a member saying "this is wrong", and writing mode never
//     writes.
// An MCP client (Claude, Codex, any agent signed in through OAuth) is the one caller without an
// assistant: it acts for the signed-in member directly, so it may read and correct. Each of the
// three tools can be switched off on its own under Settings → MCP, which mcpServerSimple enforces
// before a call ever reaches this module. The document tools are not served there: an MCP client
// has no conversation to take a file from, and addKnowledgeDocument refuses without one.
//
// A correction is a source of its own (knowledgeBases/{projectId}/corrections/{id}): it is stored
// together with the page revision it produced, the ingest treats it as overriding older sources,
// and undoing it restores the revision before it — as long as nobody changed the page since.

const crypto = require('crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { buildMcpActorMarker, MCP_CHANNEL } = require('../shared/mcpActor')

const {
    getKnowledgeBaseLastSuccessfulRunAt,
    getKnowledgeBasePath,
    getKnowledgeCorrectionsPath,
    getKnowledgePagePath,
    getKnowledgePagesPath,
    isKnowledgeBasePausedAtMonthlyCap,
    isKnowledgeBasePausedForArchivedProject,
    isKnowledgeBasePausedForInactiveOwner,
    isKnowledgePageVisible,
    normalizeKnowledgePageSlug,
    splitKnowledgePageSources,
} = require('./knowledgeBaseModel')
const { buildKnowledgeIndex, restoreKnowledgePageRevision, writeKnowledgePage } = require('./knowledgePageStore')
const { addKnowledgeDocument, listKnowledgeDocuments, removeKnowledgeDocument } = require('./knowledgeDocuments')
const {
    getOwnedKnowledgeContributionDraft,
    loadPendingKnowledgeContributionDrafts,
    listKnowledgeContributions,
    removeKnowledgeContribution,
    saveKnowledgeContribution,
} = require('./knowledgeContributions')
const { searchKnowledgeBase } = require('./knowledgeSearch')
const {
    ADD_KNOWLEDGE_DOCUMENT_TOOL,
    CORRECT_KNOWLEDGE_PAGE_TOOL,
    KNOWLEDGE_CORRECTION_MAX_CHARS,
    READ_KNOWLEDGE_PAGE_TOOL,
    REMOVE_KNOWLEDGE_CONTRIBUTION_TOOL,
    REMOVE_KNOWLEDGE_DOCUMENT_TOOL,
    SAVE_KNOWLEDGE_CONTRIBUTION_TOOL,
    SEARCH_KNOWLEDGE_TOOL,
    UNDO_KNOWLEDGE_CORRECTION_TOOL,
} = require('./knowledgeBaseToolSchemas')

// The index rides in every prompt of the project, so it gets a tighter budget than the ingest's.
const KNOWLEDGE_CONTEXT_INDEX_MAX_CHARS = 6000
// Whether a project has a readable wiki is asked once per model round; only that yes/no (and
// whether the wiki is switched on) is cached, never page content, so a withdrawn source cannot
// linger in a prompt through this cache.
const AVAILABILITY_TTL_MS = 30 * 1000
const NEW_CORRECTION_TOKEN = /\[\[\s*correction:new\s*(\|[^\]]*)?\]\]/g

const ACCESS_NONE = 'none'
const ACCESS_READ = 'read'
const ACCESS_CORRECT = 'correct'

const KNOWLEDGE_RESEARCH_INSTRUCTIONS = [
    'PROJECT KNOWLEDGE — WIKI FIRST:',
    '- Questions about a project, customer, event, decision or who worked on something require looking up stored knowledge, even when the user does not explicitly say "search".',
    "- Choose the project that the question is ABOUT, using its name and description and the conversation. The project hosting this chat and the user's default project do not determine the subject. If the target project ID is not already known, call get_user_projects and use its names and descriptions to select it. Never invent a project ID.",
    "- Before searching tasks, notes, chats or contacts for project knowledge, call read_knowledge_page in the relevant project. For a different project, first call it with that projectId and no slug to get its index, then read the relevant page(s) with the SAME projectId and their returned slugs. When the index does not show which page covers the question, call search_knowledge with a few words; it quotes matching passages. A page index, summary or search passage alone is not a page read. For this chat's project you may use the index below, but still read the relevant page.",
    "- Answer from the wiki when it is sufficient. Then use the original tasks, notes or chats only for missing details, an explicitly requested original record, or to verify newer or conflicting information. Keep those lookups scoped to the same relevant project. If the topic changes to another project, read that project's wiki first; for a comparison, consult each relevant project.",
    "- If the selected project has no wiki, no relevant page, a rebuilding page or a read error, continue with the available original sources in that project. An absent wiki in the chat project says nothing about another project's wiki. Never claim a wiki was read when it was unavailable.",
    '- Routine greetings, general knowledge, direct changes, task-ID lookups and task/calendar listings do not need a wiki detour. Respect an explicit request to use or skip particular sources.',
].join('\n')

/**
 * How much of the project wiki a run may use, from its runtime context: 'none', 'read' or
 * 'correct'. The same answer decides the prompt context, which tools are offered and whether a
 * tool call is executed.
 */
function resolveKnowledgeBaseAccess(context) {
    // The MCP server builds this context itself for the OAuth-authenticated user, so the channel
    // cannot be claimed by a model. Membership is still checked per call.
    if (context?.sourceChannel === 'mcp') {
        return context.projectId && context.requestUserId ? ACCESS_CORRECT : ACCESS_NONE
    }
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

function formatAge(ms) {
    const hours = Math.floor(ms / (60 * 60 * 1000))
    if (hours < 1) return 'less than an hour ago'
    if (hours < 48) return `about ${hours} hour${hours === 1 ? '' : 's'} ago`
    return `about ${Math.floor(hours / 24)} days ago`
}

/**
 * How current the wiki is, for a model: when it last caught up with its sources, and that anything
 * after that is not in it yet. `lastUpdatedAt` is an ISO time or null.
 */
function describeKnowledgeBaseFreshness(knowledgeBase = {}, now = Date.now()) {
    const lastSuccessfulRunAt = getKnowledgeBaseLastSuccessfulRunAt(knowledgeBase)
    const sentences = []
    if (Number.isFinite(lastSuccessfulRunAt)) {
        sentences.push(
            `It last caught up with its sources at ${new Date(lastSuccessfulRunAt).toISOString()} (${formatAge(
                Math.max(0, now - lastSuccessfulRunAt)
            )}); changes made in the project after that may not be included yet.`
        )
    } else {
        sentences.push('When it last caught up with its sources is not known; recent changes may be missing.')
    }
    if (knowledgeBase.enabled !== true) {
        sentences.push('It is switched off and is not being updated.')
    } else if (
        isKnowledgeBasePausedAtMonthlyCap(knowledgeBase, now) ||
        isKnowledgeBasePausedForInactiveOwner(knowledgeBase) ||
        isKnowledgeBasePausedForArchivedProject(knowledgeBase)
    ) {
        sentences.push('Its updates are paused at the moment.')
    } else {
        sentences.push(
            'It is updated every night, and within minutes when a member adds a document or saved knowledge or a source is withdrawn.'
        )
    }
    return {
        lastUpdatedAt: Number.isFinite(lastSuccessfulRunAt) ? new Date(lastSuccessfulRunAt).toISOString() : null,
        text: sentences.join(' '),
    }
}

function buildKnowledgeBaseContextMessage({
    projectId,
    projectName,
    pages,
    access,
    knowledgeBase = {},
    now = Date.now(),
}) {
    const index = buildKnowledgeIndex(pages, { maxChars: KNOWLEDGE_CONTEXT_INDEX_MAX_CHARS })
    const truncated = index.includes('more pages')
    const freshness = describeKnowledgeBaseFreshness(knowledgeBase, now)
    const lines = [
        `Project wiki of "${projectName}":`,
        `- Project ID: ${projectId}. This index belongs to the chat project; use it only when that project is relevant to the question.`,
        "- Context rule: The wiki is compiled automatically from the project's shared tasks, goals, notes, contacts, comment threads and artifacts, from documents and knowledge members added to it, and from member corrections. Use it as background knowledge about the project. It can be out of date: when it disagrees with the conversation or with a task, note or goal you look up, those win.",
        `- Freshness: ${freshness.text} For anything recent, check the original sources too.`,
        `- To use a page, call ${READ_KNOWLEDGE_PAGE_TOOL} with its slug${
            truncated ? `; call it without a slug for the full list of pages` : ''
        }. To find pages by their text, call ${SEARCH_KNOWLEDGE_TOOL}. Name pages by their title, never by [[...]] tokens.`,
    ]
    if (access === ACCESS_CORRECT) {
        lines.push(
            `- When the user says something in the wiki is wrong or missing, read the page, then call ${CORRECT_KNOWLEDGE_PAGE_TOOL} with their correction in their own words and the corrected page. Change only what they asked for, and never put anything into the wiki that you know from private tasks, notes or chats. To take a correction back, call ${UNDO_KNOWLEDGE_CORRECTION_TOOL}.`,
            `- When the user asks to put a file they sent (a deck, a spreadsheet, a document) into the wiki, call ${ADD_KNOWLEDGE_DOCUMENT_TOOL}; the wiki then integrates it into its pages itself. Do not copy the file into a correction.`,
            `- Only when the user explicitly asks to save something from this conversation to the wiki, call ${SAVE_KNOWLEDGE_CONTRIBUTION_TOOL} with the exact text to share. Never save on your own initiative. If it returns a draft, show the user its exact text and save only after they confirm. ${REMOVE_KNOWLEDGE_CONTRIBUTION_TOOL} takes it out again.`
        )
    }
    lines.push('Pages:', index)
    return lines.join('\n')
}

/**
 * Wiki-first research instructions and the chat project's index when it has one; '' for ineligible
 * runs. Read the index fresh: a page that lost a source must disappear from the next prompt.
 */
async function getKnowledgeBaseContextMessage({ db, context, now = Date.now() }) {
    const access = resolveKnowledgeBaseAccess(context)
    if (access === ACCESS_NONE) return ''
    const project = await isProjectMember(db, context.projectId, context.requestUserId)
    if (!project) return ''
    const sections = [KNOWLEDGE_RESEARCH_INSTRUCTIONS]
    if (access === ACCESS_CORRECT) {
        const pending = await loadPendingKnowledgeContributionDrafts({
            db,
            userId: context.requestUserId,
            context,
            now,
        })
        const readable = []
        for (const draft of pending.slice(0, 5)) {
            if (await isProjectMember(db, draft.projectId, context.requestUserId)) {
                readable.push({ draftId: draft.draftId, projectId: draft.projectId, textToShare: draft.text })
            }
        }
        if (readable.length)
            sections.push(
                `Pending wiki drafts for this conversation (NOT saved): ${JSON.stringify(readable)}\nIf the user agrees to the exact text and destination, confirm the existing draft with draftId, projectId and confirmed: true. Do not create another draft. If they change the text, create a new draft and wait for confirmation.`
            )
    }
    const knowledgeBase = await db.doc(getKnowledgeBasePath(context.projectId)).get()
    if (!knowledgeBase.exists) return sections.join('\n\n')
    const pages = await loadIndexPages(db, context.projectId)
    if (!pages.size) return sections.join('\n\n')
    return [
        ...sections,
        buildKnowledgeBaseContextMessage({
            projectId: context.projectId,
            projectName: project.name || context.projectId,
            pages,
            access,
            knowledgeBase: knowledgeBase.data() || {},
            now,
        }),
    ].join('\n\n')
}

const availabilityCache = new Map()

// The current project's membership and wiki availability. Target membership is rechecked per read.
async function getKnowledgeBaseAvailability({ db, projectId, userId, now = Date.now() }) {
    const cacheKey = `${projectId}|${userId}`
    const cached = availabilityCache.get(cacheKey)
    if (cached && cached.expiresAt > now) return cached.availability

    const availability = { isMember: !!(await isProjectMember(db, projectId, userId)), hasPages: false, enabled: false }
    const knowledgeBase = availability.isMember ? await db.doc(getKnowledgeBasePath(projectId)).get() : null
    if (knowledgeBase?.exists) {
        const visible = await db
            .collection(getKnowledgePagesPath(projectId))
            .where('archived', '==', false)
            .where('needsRebuild', '==', false)
            .limit(1)
            .get()
        availability.hasPages = !visible.empty
        availability.enabled = knowledgeBase.data()?.enabled === true
    }
    availabilityCache.set(cacheKey, { availability, expiresAt: now + AVAILABILITY_TTL_MS })
    return availability
}

const READ_TOOLS = [READ_KNOWLEDGE_PAGE_TOOL, SEARCH_KNOWLEDGE_TOOL]
const PAGE_TOOLS_BY_ACCESS = {
    [ACCESS_CORRECT]: [...READ_TOOLS, CORRECT_KNOWLEDGE_PAGE_TOOL, UNDO_KNOWLEDGE_CORRECTION_TOOL],
    [ACCESS_READ]: READ_TOOLS,
}
// Tools that add to the wiki's sources: offered as soon as the wiki is switched on, not only once it
// has pages, because what a new wiki gets first is often a deck or a piece of saved knowledge.
const DOCUMENT_TOOLS = [
    ADD_KNOWLEDGE_DOCUMENT_TOOL,
    REMOVE_KNOWLEDGE_DOCUMENT_TOOL,
    SAVE_KNOWLEDGE_CONTRIBUTION_TOOL,
    REMOVE_KNOWLEDGE_CONTRIBUTION_TOOL,
]

function toolNamesForAccess(access) {
    if (access === ACCESS_CORRECT) return [...PAGE_TOOLS_BY_ACCESS[ACCESS_CORRECT], ...DOCUMENT_TOOLS]
    return [...(PAGE_TOOLS_BY_ACCESS[access] || [])]
}

/** The wiki tools to offer a run, added to the assistant's own tools like load_skill. */
async function getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext, now }) {
    const access = resolveKnowledgeBaseAccess(toolRuntimeContext)
    if (access === ACCESS_NONE) return []
    const { isMember, hasPages, enabled } = await getKnowledgeBaseAvailability({
        db,
        projectId: toolRuntimeContext.projectId,
        userId: toolRuntimeContext.requestUserId,
        now,
    })
    if (!isMember) return []
    return [
        ...(hasPages ? PAGE_TOOLS_BY_ACCESS[access] || [] : READ_TOOLS),
        ...(enabled && access === ACCESS_CORRECT ? DOCUMENT_TOOLS : []),
    ]
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

async function readKnowledgeBaseFreshness(db, projectId, now) {
    const snapshot = await db.doc(getKnowledgeBasePath(projectId)).get()
    return describeKnowledgeBaseFreshness(snapshot.exists ? snapshot.data() || {} : {}, now)
}

// A page read returns the sources its body cites and only the COUNT of the others. The full list
// stays on the page document, where the privacy withdrawal needs it (knowledgeSourceInvalidation.js):
// a page can keep a sentence after its citation was dropped, so the list only ever grows. Returned
// whole, it made a read several times larger than the page it described (on the reporting wiki 57%
// of the listed sources were no longer cited, 187 KB of source lists against 104 KB of text).
async function readKnowledgePage({ db, projectId, slug, now = Date.now() }) {
    if (!slug) {
        const [pages, documents, contributions, freshness] = await Promise.all([
            loadIndexPages(db, projectId),
            listKnowledgeDocuments(db, projectId),
            listKnowledgeContributions(db, projectId),
            readKnowledgeBaseFreshness(db, projectId, now),
        ])
        return {
            success: true,
            projectId,
            wikiLastUpdatedAt: freshness.lastUpdatedAt,
            freshness: freshness.text,
            pages: [...pages.values()]
                .sort((left, right) => String(left.title || left.slug).localeCompare(String(right.title || right.slug)))
                .map(page => ({ slug: page.slug, title: page.title || page.slug, summary: page.summary || '' })),
            documents,
            contributions,
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
    const { citedSourceKeys, otherSourceKeys } = splitKnowledgePageSources(page)
    const freshness = await readKnowledgeBaseFreshness(db, projectId, now)
    return {
        success: true,
        projectId,
        slug: key,
        title: page.title || key,
        summary: page.summary || '',
        body: page.body || '',
        revision: Number(page.revision) || 0,
        updatedAt: toIso(page.updatedAt),
        wikiLastUpdatedAt: freshness.lastUpdatedAt,
        sources: citedSourceKeys.map(sourceKey => ({ key: sourceKey, label: labels[sourceKey] || '' })),
        otherSourceCount: otherSourceKeys.length,
        note: `Tokens such as [[task:ID]] cite the project objects a statement comes from, and [[slug]] links another page. Keep them when you correct the page; never show them to the user. \`sources\` are the sources this text cites${
            otherSourceKeys.length
                ? `; the page was also compiled from ${otherSourceKeys.length} other source(s) it no longer cites`
                : ''
        }. ${freshness.text}`,
    }
}

// A change an MCP client made in the user's name says so on the revision, which is what the history and
// the Updates feed read (shared/mcpActor.js).
function getMcpAuthorFields(toolRuntimeContext) {
    return toolRuntimeContext?.sourceChannel === MCP_CHANNEL ? buildMcpActorMarker(toolRuntimeContext.mcpClient) : {}
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
        author: {
            type: 'user',
            userId,
            name: authorName,
            correctionId,
            assistantId: assistantId || null,
            ...getMcpAuthorFields(toolRuntimeContext),
        },
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
                sourceChannel: toolRuntimeContext?.sourceChannel || null,
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
    authorFields = {},
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
        author: { type: 'user', userId, name: authorName, undoneCorrectionId: correctionId, ...authorFields },
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
    readChatAttachment,
    extractText,
    enqueue,
    loadTypesense,
    now = Date.now(),
    fieldValue = FieldValue,
}) {
    const access = resolveKnowledgeBaseAccess(toolRuntimeContext)
    if (!toolNamesForAccess(access).includes(toolName)) return failure(`Tool not permitted here: ${toolName}`)
    const userId = toolRuntimeContext.requestUserId
    let projectId = typeof args.projectId === 'string' && args.projectId ? args.projectId : toolRuntimeContext.projectId
    if (toolName === SAVE_KNOWLEDGE_CONTRIBUTION_TOOL && args.draftId) {
        const draft = await getOwnedKnowledgeContributionDraft(db, userId, args.draftId)
        if (!draft) return failure('There is no such draft to confirm. Save it again to make a new one.')
        // A draft's audience is immutable. An omitted target means the draft's project, not
        // the chat's project; an explicit conflicting target is refused by confirmDraft.
        if (!args.projectId) projectId = draft.projectId
    }
    if (!(await isProjectMember(db, projectId, userId))) {
        return failure('The wiki of that project is only available to its members.')
    }

    switch (toolName) {
        case READ_KNOWLEDGE_PAGE_TOOL:
            return readKnowledgePage({ db, projectId, slug: args.slug, now })
        case SEARCH_KNOWLEDGE_TOOL:
            return searchKnowledgeBase({
                db,
                userId,
                projectId,
                query: args.query,
                allProjects: args.allProjects === true,
                limit: args.limit,
                ...(loadTypesense ? { loadTypesense } : {}),
            })
        case SAVE_KNOWLEDGE_CONTRIBUTION_TOOL:
            return saveKnowledgeContribution({
                db,
                projectId,
                userId,
                assistantId,
                args,
                toolRuntimeContext,
                ...(enqueue ? { enqueue } : {}),
                now,
            })
        case REMOVE_KNOWLEDGE_CONTRIBUTION_TOOL:
            return removeKnowledgeContribution({
                db,
                projectId,
                userId,
                contributionId: args.contributionId,
                now,
                fieldValue,
            })
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
            return undoKnowledgeCorrection({
                db,
                projectId,
                userId,
                correctionId: args.correctionId,
                authorFields: getMcpAuthorFields(toolRuntimeContext),
                now,
                fieldValue,
            })
        case ADD_KNOWLEDGE_DOCUMENT_TOOL:
            return addKnowledgeDocument({
                db,
                projectId,
                userId,
                assistantId,
                args,
                toolRuntimeContext,
                readChatAttachment,
                ...(extractText ? { extractText } : {}),
                ...(enqueue ? { enqueue } : {}),
                now,
            })
        case REMOVE_KNOWLEDGE_DOCUMENT_TOOL:
            return removeKnowledgeDocument({ db, projectId, userId, documentId: args.documentId, now, fieldValue })
        default:
            return failure(`Unknown wiki tool: ${toolName}`)
    }
}

module.exports = {
    resolveKnowledgeBaseAccess,
    canCorrectKnowledgeBaseOnChannel,
    buildKnowledgeBaseContextMessage,
    describeKnowledgeBaseFreshness,
    getKnowledgeBaseContextMessage,
    getKnowledgeBaseToolNamesForRun,
    isKnowledgeBaseToolAllowed,
    executeKnowledgeBaseTool,
    undoKnowledgeCorrection,
    _resetKnowledgeBaseAvailabilityCacheForTests: () => availabilityCache.clear(),
}
