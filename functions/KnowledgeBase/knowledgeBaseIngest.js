'use strict'

// One ingest run of a project wiki: rebuild the pages that lost a source, rewrite the pages a
// one-time current-state pass is still waiting for (knowledgeCurrentStateRewrite.js), then work
// through what changed since the last run, a prompt-sized chunk at a time, and let the model fold
// it into the pages with three tools of its own (read_page, write_page, archive_page). Runs
// unattended from the runKnowledgeBaseIngest Cloud Tasks worker.
//
// Order matters: rebuilds come first so that the ingest prompts never see a page that still repeats
// a withdrawn source, not even in the index.
//
// Who pays: the member who switched the wiki on (ownerUserId), at the model's normal Gold rate,
// recorded as `knowledge_base_ingest`. A monthly cap on the wiki document bounds it; the counter is
// only ever written by the run holding the lease, so it needs no transaction of its own.
//
// What makes a run stop early, and what happens next:
//   - the wall clock (sized to the Cloud Tasks dispatch ceiling) or more work than one run holds →
//     the next run is scheduled right away and continues from the cursor;
//   - the monthly cap → the wiki pauses until the first of next month (UTC);
//   - the owner is out of Gold → the next nightly slot;
//   - the owner has not used Alldone for 30 days → paused (nextRunAt null) until they are back,
//     which knowledgeBaseDefaults.js notices; nothing is spent on a member who is not there;
//   - the owner has archived the project → paused the same way until they reactivate it (or the
//     default hands the wiki to a member for whom it is active); nothing is spent on it;
//   - nothing changed → no model call at all, the next nightly slot.

const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')
const crypto = require('crypto')

const { HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS } = require('../Assistant/assistantRunLimits')
const {
    advanceKnowledgeCursor,
    buildCorrectionCard,
    chunkKnowledgeSources,
    cleanText,
    collectKnowledgeSources,
    loadKnowledgeSourcesByKeys,
} = require('./collectKnowledgeSources')
const {
    KNOWLEDGE_BASE_MONTHLY_CAP_STOP_REASON,
    KNOWLEDGE_BASE_OWNER_INACTIVE_STOP_REASON,
    KNOWLEDGE_BASE_PROJECT_ARCHIVED_STOP_REASON,
    getKnowledgeBaseMonthKey,
    getKnowledgeBasePath,
    getKnowledgeCorrectionsPath,
    getKnowledgePagePath,
    getKnowledgeRunsPath,
    isKnowledgePageVisible,
    isProjectArchivedForUser,
    normalizeKnowledgePageSlug,
    resolveKnowledgeBaseModel,
    resolveKnowledgeBaseMonthlyGoldCap,
} = require('./knowledgeBaseModel')
const {
    archiveKnowledgePage,
    buildKnowledgeIndex,
    countActivePages,
    loadKnowledgePages,
    writeKnowledgePage,
} = require('./knowledgePageStore')
const { readPendingRewriteSlugs } = require('./knowledgeCurrentStateRewrite')
const { isKnowledgeBaseOwnerActive, nextNightlyRunAt } = require('./knowledgeBaseSchedule')

// The run shares the heartbeat's budget for the same reason: it is delivered through Cloud Tasks,
// whose dispatch deadline tops out at 30 minutes.
const KNOWLEDGE_BASE_INGEST_MAX_RUN_WALL_CLOCK_MS = HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS
const INGEST_LEASE_MS = KNOWLEDGE_BASE_INGEST_MAX_RUN_WALL_CLOCK_MS + 5 * 60 * 1000
// No new conversation starts with less than this left: a chunk that cannot finish is wasted Gold.
const MIN_CONVERSATION_TIME_MS = 3 * 60 * 1000
const CHUNK_MAX_TOKENS = 16000
const MAX_COLLECT_ROUNDS = 4
const MAX_REBUILDS_PER_RUN = 10
const MAX_CURRENT_STATE_REWRITES_PER_RUN = 10
const MAX_TOOL_ROUNDS_PER_CONVERSATION = 40
const MAX_CORRECTIONS_IN_PROMPT = 30
// The project description rides in every conversation of a run, so it is capped like a source card.
const PROJECT_DESCRIPTION_MAX_CHARS = 4000
const CONTINUE_DELAY_MS = 60 * 1000
const INGEST_TEMPERATURE = 'TEMPERATURE_LOW'
const GOLD_SOURCE = 'knowledge_base_ingest'

class KnowledgeBaseRunStop extends Error {
    constructor(reason) {
        super(reason)
        this.reason = reason
    }
}

function startOfNextMonthUtc(now) {
    const date = new Date(now)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}

async function claimIngestLease(db, projectId, leaseId, now) {
    const ref = db.doc(getKnowledgeBasePath(projectId))
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return { claimed: false, reason: 'missing' }
        const knowledgeBase = snapshot.data() || {}
        if (knowledgeBase.enabled !== true) return { claimed: false, reason: 'disabled' }
        if (knowledgeBase.leaseOwner && Number(knowledgeBase.leaseExpiresAt) > now) {
            return { claimed: false, reason: 'busy' }
        }
        transaction.update(ref, { leaseOwner: leaseId, leaseExpiresAt: now + INGEST_LEASE_MS })
        return { claimed: true, knowledgeBase }
    })
}

// Releases the lease and schedules the next run. A refresh or a rebuild requested while this run
// was going (nextRunAt moved past its start) is honoured rather than overwritten. A paused wiki
// (nextRunAt null) keeps such a request too: Math.min(null, x) is 0, which would make it due at once
// and every 15 minutes after.
async function releaseIngestLease(db, projectId, leaseId, startedAt, update, fieldValue) {
    const ref = db.doc(getKnowledgeBasePath(projectId))
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return false
        const current = snapshot.data() || {}
        if (current.leaseOwner !== leaseId) return false
        let nextRunAt = update.nextRunAt
        const requestedAt = Number(current.nextRunAt)
        if (current.enabled !== true) nextRunAt = null
        else if (requestedAt > startedAt)
            nextRunAt = nextRunAt === null ? requestedAt : Math.min(nextRunAt, requestedAt)
        transaction.update(ref, {
            ...update,
            nextRunAt,
            leaseOwner: fieldValue.delete(),
            leaseExpiresAt: fieldValue.delete(),
        })
        return true
    })
}

async function loadRecentCorrections(db, projectId) {
    try {
        const snapshot = await db
            .collection(getKnowledgeCorrectionsPath(projectId))
            .orderBy('createdAt', 'desc')
            .limit(MAX_CORRECTIONS_IN_PROMPT)
            .get()
        // An undone correction no longer speaks for the project; the page already went back.
        return snapshot.docs
            .map(doc => ({ id: doc.id, data: doc.data() || {} }))
            .filter(({ data }) => data.status !== 'reverted')
    } catch (error) {
        console.warn('[knowledge base] Could not read corrections', { projectId, error: error.message })
        return []
    }
}

// The wiki is the project's current state, not its history: the revisions already keep every past
// version of a page, so a page that also narrates how it got there only buries what is true now.
// Alternatives are the one exception, and only while nothing has been decided.
const WIKI_RULES = [
    'Rules:',
    '- Every page describes the current state of its subject: what is true today. It is a reference, not minutes or a changelog, and the wiki keeps older versions of each page on its own. Do not narrate how the project got here ("in the meeting on …", "first …, then …", "was discussed", "originally planned"). A finished task or a past meeting counts for what it changed or decided, not as an event.',
    '- Integrate what is durable and useful for the people working on the project: who is who, customers and partners, decisions and their reasons, terms, how things are done, open questions and risks, milestones. Skip trivia and routine status noise.',
    '- Options belong on a page only while the decision is still open; then the open question and the options still on the table are the current state. Once something is decided, state the decision and its reason and drop the alternatives that were not chosen.',
    '- When a source changes or settles something a page already says, rewrite that statement to the new state and remove the outdated one together with its citation, instead of adding the new version next to the old. Source cards are listed oldest first; a later card describes a more recent state than an earlier one and than what the pages say about the same object.',
    '- Prefer extending an existing page over creating a new one. Keep each page focused on one subject; split a page that grows past about 1500 words and link the parts.',
    '- Read a page with read_page before you replace it. write_page replaces the whole body: keep what is still true, leave out what no longer is, and bring any older passage that still narrates history up to the current state.',
    '- Cite every statement with the token of the source it came from, exactly as given: [[task:ID]], [[goal:ID]], [[note:ID]], [[contact:ID]], [[correction:ID]], [[document:ID]]. List every source you used in sourceKeys.',
    '- A document (a [[document:ID]] card) was added by a project member so that the wiki takes it in: work its substance into the pages it concerns and update what it supersedes, rather than writing a page that only summarizes the document; create a new page only for a subject no page covers yet. When the member said what to take from it, follow that. A long document arrives in parts; each part is a card of its own.',
    '- Link other wiki pages with [[slug]] or [[slug|label]].',
    '- A correction by a project member overrides older sources. Never bring back what a correction rejected.',
    '- Never copy email addresses, phone numbers, passwords, keys or other credentials into a page.',
    '- Write in the language most of the sources are written in. Use markdown headings and lists.',
    "- The summary is one sentence of at most 200 characters; it is the page's line in the wiki index.",
    '- When you are done, answer with one short line describing what you changed (or that nothing was worth adding).',
].join('\n')

// The project description frames the wiki but is never one of its sources. It is free text that any
// member, or an assistant acting for one, writes without a visibility filter, and it has no source
// key: a statement copied from it could not be cited, and knowledgeSourceInvalidation.js, which
// finds text only through the sources a page cites, could never take it back out of a page.
const PROJECT_DESCRIPTION_RULE =
    'Use it to judge what belongs in this wiki and how to frame its pages. It is not a source: never cite it and never copy a statement from it into a page; everything on a page comes from a source card or a correction. It can be out of date, so where it disagrees with a source card or a correction, those win.'

function buildSystemPrompt({ projectName, projectDescription, instructions, index, corrections, task }) {
    return [
        `You maintain the wiki of the project "${projectName}" in Alldone: a small set of markdown pages that capture what the project knows. Project members read it, and the project's assistants use it as context.`,
        ...(projectDescription
            ? [
                  '',
                  'Project description, as the project members wrote it:',
                  projectDescription,
                  PROJECT_DESCRIPTION_RULE,
              ]
            : []),
        '',
        task,
        '',
        WIKI_RULES,
        '',
        `Instructions from the project members: ${instructions || '(none)'}`,
        '',
        'Current wiki index:',
        index || '(the wiki is empty)',
        '',
        'Corrections by project members (newest first):',
        corrections.length
            ? corrections.map(({ id, data }) => buildCorrectionCard(id, data).text).join('\n')
            : '(none)',
    ].join('\n')
}

function buildWikiToolSchemas() {
    const schema = (name, description, properties, required) => ({
        type: 'function',
        function: { name, description, parameters: { type: 'object', properties, required } },
    })
    return {
        read_page: schema(
            'read_page',
            'Read a wiki page with its current revision. Required before replacing or archiving it.',
            { slug: { type: 'string', description: 'The page slug from the index, e.g. "kunden".' } },
            ['slug']
        ),
        write_page: schema(
            'write_page',
            'Create a page or replace the whole body of an existing one (read it first).',
            {
                slug: { type: 'string', description: 'Lowercase slug; derived from the title when omitted.' },
                title: { type: 'string' },
                summary: { type: 'string', description: 'One sentence, at most 200 characters.' },
                body: { type: 'string', description: 'The complete markdown body, at most 20000 characters.' },
                sourceKeys: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Every source key used, e.g. "task:abc".',
                },
                reason: { type: 'string', description: 'Why the page changed, in a few words.' },
            },
            ['title', 'summary', 'body', 'sourceKeys', 'reason']
        ),
        archive_page: schema(
            'archive_page',
            'Remove a page that is obsolete or merged into another one (read it first).',
            { slug: { type: 'string' }, reason: { type: 'string' } },
            ['slug', 'reason']
        ),
    }
}

/**
 * The three tools of one conversation. They never throw for a refused write: the model gets the
 * reason back and can fix its call, because one refused write must not end the whole run.
 */
function createWikiTools({
    db,
    projectId,
    pages,
    runId,
    mode,
    targetSlug = null,
    allowedSourceKeys,
    sourceLabels = {},
    now,
    fieldValue,
    onChange,
}) {
    const readRevisions = new Map()
    const schemas = buildWikiToolSchemas()
    const outOfScope = slug =>
        (mode === 'rebuild' || mode === 'rewrite') && slug !== targetSlug
            ? `Only the page "${targetSlug}" may be changed in this run.`
            : null
    // A current-state rewrite is an ordinary edit as far as the store is concerned: the page was
    // read first and keeps the sources it had. Only a rebuild replaces them.
    const storeMode = mode === 'rewrite' ? 'ingest' : mode

    return {
        read_page: {
            schema: schemas.read_page,
            // Read fresh rather than from the copy loaded when the run started: a source may have
            // been withdrawn since, and a page that lost one must never be read back — not even by
            // the run rebuilding it, whose prompt promises that its previous text is withheld.
            execute: async ({ slug } = {}) => {
                const key = normalizeKnowledgePageSlug(slug)
                const snapshot = key ? await db.doc(getKnowledgePagePath(projectId, key)).get() : null
                const page = snapshot?.exists ? { ...(snapshot.data() || {}), slug: key } : null
                if (page) pages.set(key, page)
                if (!page || page.archived === true) return { success: false, error: `There is no page "${key}".` }
                if (!isKnowledgePageVisible(page)) {
                    return { success: false, error: `The page "${key}" is being rebuilt and cannot be read now.` }
                }
                readRevisions.set(key, Number(page.revision) || 0)
                return {
                    success: true,
                    slug: key,
                    title: page.title,
                    summary: page.summary,
                    body: page.body,
                    revision: Number(page.revision) || 0,
                }
            },
        },
        write_page: {
            schema: schemas.write_page,
            execute: async (args = {}) => {
                const slug = normalizeKnowledgePageSlug(args.slug || args.title)
                const refusal = outOfScope(slug)
                if (refusal) return { success: false, error: refusal }
                const existing = pages.get(slug)
                const result = await writeKnowledgePage({
                    db,
                    projectId,
                    slug,
                    title: args.title,
                    summary: args.summary,
                    body: args.body,
                    sourceKeys: args.sourceKeys,
                    allowedSourceKeys,
                    sourceLabels,
                    expectedRevision:
                        mode === 'rebuild'
                            ? Number(existing?.revision) || 0
                            : readRevisions.has(slug)
                              ? readRevisions.get(slug)
                              : existing && existing.archived !== true
                                ? null
                                : Number(existing?.revision) || 0,
                    mode: storeMode,
                    runId,
                    reason: args.reason,
                    now: now(),
                    activePageCount: countActivePages(pages),
                    fieldValue,
                })
                if (!result.success) return result
                pages.set(result.slug, { ...result.page })
                readRevisions.set(result.slug, result.revision)
                onChange({ type: result.created ? 'created' : 'updated', slug: result.slug })
                return {
                    success: true,
                    slug: result.slug,
                    revision: result.revision,
                    removedSourceReferences: result.removedSourceReferences,
                }
            },
        },
        archive_page: {
            schema: schemas.archive_page,
            execute: async ({ slug, reason } = {}) => {
                const key = normalizeKnowledgePageSlug(slug)
                const refusal = outOfScope(key)
                if (refusal) return { success: false, error: refusal }
                const result = await archiveKnowledgePage({
                    db,
                    projectId,
                    slug: key,
                    expectedRevision: readRevisions.has(key) ? readRevisions.get(key) : null,
                    mode: storeMode,
                    runId,
                    reason,
                    now: now(),
                    fieldValue,
                })
                if (!result.success) return result
                pages.set(key, { ...(pages.get(key) || {}), archived: true, revision: result.revision })
                onChange({ type: 'archived', slug: key })
                return { success: true, slug: key, archived: true }
            },
        },
    }
}

// The production conversation: the shared assistant transport and tool loop, with no Alldone
// tools at all — only the three wiki tools this run defines.
async function runModelConversation({ messages, modelKey, localTools, runtime, onRoundComplete, assertActive }) {
    const helper = require('../Assistant/assistantHelper')
    runtime.additionalToolSchemas = Object.values(localTools).map(tool => tool.schema)
    const stream = await helper.interactWithChatStream(messages, modelKey, INGEST_TEMPERATURE, [], runtime)
    return helper.collectAssistantTextWithToolCalls({
        stream,
        conversationHistory: messages,
        modelKey,
        temperatureKey: INGEST_TEMPERATURE,
        allowedTools: [],
        toolRuntimeContext: runtime,
        localTools,
        assertActive,
        onRoundComplete,
    })
}

function measureRoundGold({ assistantText, conversation, modelKey }) {
    const helper = require('../Assistant/assistantHelper')
    const tokens = helper.calculateTokens(assistantText, conversation, modelKey)
    return { tokens, gold: helper.calculateGoldCostFromTokens(tokens, modelKey) }
}

async function chargeIngestGold({ userId, gold, idempotencyKey, projectId, model }) {
    const { deductGold } = require('../Gold/goldHelper')
    return deductGold(userId, gold, {
        source: GOLD_SOURCE,
        channel: 'assistant',
        projectId,
        objectId: projectId,
        objectType: 'knowledgeBase',
        model,
        idempotencyKey,
    })
}

async function runKnowledgeBaseIngest({
    projectId,
    trigger = 'scheduled',
    db = admin.firestore(),
    clock = () => Date.now(),
    leaseId = crypto.randomUUID(),
    fieldValue = FieldValue,
    runConversation = runModelConversation,
    measureRound = measureRoundGold,
    charge = chargeIngestGold,
    collectSources = collectKnowledgeSources,
    loadSourcesByKeys = loadKnowledgeSourcesByKeys,
    readNoteContent,
    resolveUserNames,
    maxRunWallClockMs = KNOWLEDGE_BASE_INGEST_MAX_RUN_WALL_CLOCK_MS,
    notifyCapReached = args => require('./knowledgeBaseCapNotice').notifyKnowledgeBaseCapReached(args),
}) {
    if (!projectId) throw new Error('projectId is required')
    const startedAt = clock()
    const claim = await claimIngestLease(db, projectId, leaseId, startedAt)
    if (!claim.claimed) return { status: 'skipped', reason: claim.reason }

    const knowledgeBase = claim.knowledgeBase
    const ownerUserId = knowledgeBase.ownerUserId
    const modelKey = resolveKnowledgeBaseModel(knowledgeBase.model)
    const goldCap = resolveKnowledgeBaseMonthlyGoldCap(knowledgeBase.monthlyGoldCap)
    const currentMonth = getKnowledgeBaseMonthKey(startedAt)
    const monthlyGold = {
        month: currentMonth,
        spent: knowledgeBase.monthlyGold?.month === currentMonth ? Number(knowledgeBase.monthlyGold.spent) || 0 : 0,
    }
    const deadline = startedAt + maxRunWallClockMs
    const runRef = db.doc(`${getKnowledgeRunsPath(projectId)}/${leaseId}`)
    const changes = []
    const stats = {
        sources: 0,
        chunks: 0,
        rebuilt: 0,
        rebuildArchived: 0,
        rewritten: 0,
        rewriteUnchanged: 0,
        goldSpent: 0,
        truncated: [],
    }
    let cursor = knowledgeBase.cursor || {}
    let stopReason = null
    let moreWork = false
    let runDocWritten = false
    let ownerData = {}
    let failure = null

    const ensureRunDoc = async () => {
        if (runDocWritten) return
        runDocWritten = true
        await runRef.set({ status: 'running', trigger, startedAt, model: modelKey, ownerUserId })
    }

    const conversation = async ({ systemPrompt, userPrompt, tools, label }) => {
        if (clock() + MIN_CONVERSATION_TIME_MS > deadline) throw new KnowledgeBaseRunStop('time')
        if (monthlyGold.spent >= goldCap) throw new KnowledgeBaseRunStop(KNOWLEDGE_BASE_MONTHLY_CAP_STOP_REASON)
        await ensureRunDoc()
        const assertActive = async () => {
            if (clock() > deadline) throw new KnowledgeBaseRunStop('time')
        }
        await runConversation({
            messages: [
                ['system', systemPrompt],
                ['user', userPrompt],
            ],
            modelKey,
            localTools: tools,
            assertActive,
            runtime: {
                projectId,
                requestUserId: ownerUserId,
                maxToolCallIterations: MAX_TOOL_ROUNDS_PER_CONVERSATION,
                maxRunWallClockMs: Math.max(0, deadline - clock()),
            },
            onRoundComplete: async ({ assistantText, conversation: history, round }) => {
                const { gold } = measureRound({ assistantText, conversation: history, modelKey })
                if (gold > 0) {
                    const result = await charge({
                        userId: ownerUserId,
                        gold,
                        idempotencyKey: `${GOLD_SOURCE}:${leaseId}:${label}:${round}`,
                        projectId,
                        model: modelKey,
                    })
                    if (!result || result.success === false) throw new KnowledgeBaseRunStop('insufficient_gold')
                    if (!result.alreadyProcessed) {
                        monthlyGold.spent += gold
                        stats.goldSpent += gold
                    }
                }
                if (monthlyGold.spent >= goldCap) throw new KnowledgeBaseRunStop(KNOWLEDGE_BASE_MONTHLY_CAP_STOP_REASON)
            },
        })
    }

    try {
        if (!ownerUserId) throw new KnowledgeBaseRunStop('no_owner')
        const ownerSnapshot = await db.doc(`users/${ownerUserId}`).get()
        ownerData = ownerSnapshot.exists ? ownerSnapshot.data() || {} : {}
        if (ownerSnapshot.exists && !isKnowledgeBaseOwnerActive(ownerData, startedAt)) {
            throw new KnowledgeBaseRunStop(KNOWLEDGE_BASE_OWNER_INACTIVE_STOP_REASON)
        }
        if (isProjectArchivedForUser(ownerData, projectId)) {
            throw new KnowledgeBaseRunStop(KNOWLEDGE_BASE_PROJECT_ARCHIVED_STOP_REASON)
        }
        if (!ownerSnapshot.exists || !(Number(ownerData.gold) > 0)) throw new KnowledgeBaseRunStop('insufficient_gold')
        if (monthlyGold.spent >= goldCap) throw new KnowledgeBaseRunStop(KNOWLEDGE_BASE_MONTHLY_CAP_STOP_REASON)

        const projectSnapshot = await db.doc(`projects/${projectId}`).get()
        const projectData = (projectSnapshot.exists && projectSnapshot.data()) || {}
        const projectName = projectData.name || projectId
        const projectDescription =
            typeof projectData.description === 'string'
                ? cleanText(projectData.description, PROJECT_DESCRIPTION_MAX_CHARS)
                : ''
        const pages = await loadKnowledgePages(db, projectId)
        const corrections = await loadRecentCorrections(db, projectId)
        const correctionKeys = corrections.map(({ id }) => `correction:${id}`)
        const correctionLabels = Object.fromEntries(
            corrections.map(({ id, data }) => [`correction:${id}`, buildCorrectionCard(id, data).title])
        )
        const labelsOf = sources => Object.fromEntries(sources.map(source => [source.key, source.title]))
        const sourceOptions = {
            ...(readNoteContent ? { readNoteContent } : {}),
            ...(resolveUserNames ? { resolveUserNames } : {}),
        }
        const onChange = change => changes.push(change)

        // 1. Rebuild the pages that lost a source, from the sources they still have.
        const pendingRebuilds = [...pages.values()].filter(page => page.needsRebuild === true && page.archived !== true)
        for (const page of pendingRebuilds.slice(0, MAX_REBUILDS_PER_RUN)) {
            const remainingKeys = (Array.isArray(page.sourceKeys) ? page.sourceKeys : []).filter(
                key => !(page.removedSourceKeys || []).includes(key)
            )
            // Oldest first, like the delta: when two sources disagree, the later one is the current state.
            const sources = (await loadSourcesByKeys({ db, projectId, keys: remainingKeys, ...sourceOptions })).sort(
                (left, right) => left.updatedAt - right.updatedAt || (left.key < right.key ? -1 : 1)
            )
            if (sources.length) {
                await conversation({
                    label: `rebuild-${page.slug}`,
                    systemPrompt: buildSystemPrompt({
                        projectName,
                        projectDescription,
                        instructions: knowledgeBase.instructions,
                        index: buildKnowledgeIndex(pages),
                        corrections,
                        task: `Rebuild the page [[${page.slug}]] from scratch, using ONLY the source cards in the next message. Its previous text is withheld on purpose: a source it relied on is no longer available, and nothing that source said may come back. Keep the slug "${page.slug}". If the remaining sources do not support a useful page, call archive_page.`,
                    }),
                    userPrompt: `Source cards for [[${page.slug}]], oldest first:\n\n${sources.map(source => source.text).join('\n\n')}`,
                    tools: createWikiTools({
                        db,
                        projectId,
                        pages,
                        runId: leaseId,
                        mode: 'rebuild',
                        targetSlug: page.slug,
                        allowedSourceKeys: new Set([...sources.map(source => source.key), ...correctionKeys]),
                        sourceLabels: { ...correctionLabels, ...labelsOf(sources) },
                        now: clock,
                        fieldValue,
                        onChange,
                    }),
                })
            }
            const after = pages.get(page.slug)
            if (after?.needsRebuild === true && after.archived !== true) {
                // Nothing left to rebuild from, or the model declined: the page stays gone rather than
                // coming back with what the withdrawn source said.
                await archiveKnowledgePage({
                    db,
                    projectId,
                    slug: page.slug,
                    mode: 'rebuild',
                    runId: leaseId,
                    reason: sources.length ? 'Rebuild produced no page' : 'No remaining sources',
                    now: clock(),
                    fieldValue,
                })
                pages.set(page.slug, { ...after, archived: true, needsRebuild: false })
                changes.push({ type: 'archived', slug: page.slug })
                stats.rebuildArchived += 1
            } else {
                stats.rebuilt += 1
            }
        }
        if (pendingRebuilds.length > MAX_REBUILDS_PER_RUN) moreWork = true

        // 2. The one-time current-state pass (knowledgeCurrentStateRewrite.js), before the delta so
        //    that new sources land on pages that no longer narrate history. A slug leaves the list
        //    once its conversation is over, or straight away when there is nothing to rewrite (the
        //    page is gone, hidden or being rebuilt, or none of its sources is readable any more); a
        //    run that stops mid-conversation leaves it for the next one.
        let pendingRewrites = readPendingRewriteSlugs(knowledgeBase.currentStateRewrite)
        if (pendingRewrites) {
            let conversations = 0
            while (pendingRewrites.length && conversations < MAX_CURRENT_STATE_REWRITES_PER_RUN) {
                const slug = pendingRewrites[0]
                const page = pages.get(slug)
                // A page this run has already written (a rebuild) follows the current rules already.
                const sources =
                    isKnowledgePageVisible(page) && page.lastRunId !== leaseId
                        ? (
                              await loadSourcesByKeys({ db, projectId, keys: page.sourceKeys || [], ...sourceOptions })
                          ).sort((left, right) => left.updatedAt - right.updatedAt || (left.key < right.key ? -1 : 1))
                        : []
                if (sources.length) {
                    const revisionBefore = Number(page.revision) || 0
                    conversations += 1
                    await conversation({
                        label: `rewrite-${slug}`,
                        systemPrompt: buildSystemPrompt({
                            projectName,
                            projectDescription,
                            instructions: knowledgeBase.instructions,
                            index: buildKnowledgeIndex(pages),
                            corrections,
                            task: `Bring the page [[${slug}]] up to the current state. It was written before the rules below and may still narrate history, keep superseded statements next to newer ones, or list options that a decision has since settled. Read it with read_page first, then replace it with write_page. The next message holds the source cards of everything it cites, oldest first; where they show a newer state than the page, the page follows them. Keep the slug "${slug}", its subject and every statement that is still true: the cards may be shortened, so a statement they do not contradict stays. Add nothing the cards and corrections do not support. If the page already describes only the current state, do not write it and answer that nothing needed to change; if nothing on it is still true, call archive_page.`,
                        }),
                        userPrompt: `Source cards for [[${slug}]], oldest first:\n\n${sources.map(source => source.text).join('\n\n')}`,
                        tools: createWikiTools({
                            db,
                            projectId,
                            pages,
                            runId: leaseId,
                            mode: 'rewrite',
                            targetSlug: slug,
                            allowedSourceKeys: new Set([...sources.map(source => source.key), ...correctionKeys]),
                            sourceLabels: { ...correctionLabels, ...labelsOf(sources) },
                            now: clock,
                            fieldValue,
                            onChange,
                        }),
                    })
                    const after = pages.get(slug)
                    if (after?.archived !== true) {
                        if ((Number(after?.revision) || 0) > revisionBefore) stats.rewritten += 1
                        else stats.rewriteUnchanged += 1
                    }
                }
                pendingRewrites = pendingRewrites.slice(1)
                await db.doc(getKnowledgeBasePath(projectId)).update({
                    currentStateRewrite: pendingRewrites.length
                        ? { ...knowledgeBase.currentStateRewrite, pendingSlugs: pendingRewrites }
                        : fieldValue.delete(),
                })
            }
            if (pendingRewrites.length) moreWork = true
        }

        // 3. Fold in what changed since the last run.
        for (let round = 0; round < MAX_COLLECT_ROUNDS; round++) {
            const collected = await collectSources({ db, projectId, cursor, now: clock(), ...sourceOptions })
            stats.truncated.push(...collected.stats.truncated)
            const chunks = chunkKnowledgeSources(collected.sources, { maxTokens: CHUNK_MAX_TOKENS })
            for (const [chunkIndex, chunk] of chunks.entries()) {
                await conversation({
                    label: `ingest-${round}-${chunkIndex}`,
                    systemPrompt: buildSystemPrompt({
                        projectName,
                        projectDescription,
                        instructions: knowledgeBase.instructions,
                        index: buildKnowledgeIndex(pages),
                        corrections,
                        task: 'The next message holds source cards for objects that changed in the project (tasks, goals, notes, contacts) and for documents members added to the wiki. Fold what is worth knowing into the wiki.',
                    }),
                    userPrompt: `Source cards, oldest first:\n\n${chunk.map(source => source.text).join('\n\n')}`,
                    tools: createWikiTools({
                        db,
                        projectId,
                        pages,
                        runId: leaseId,
                        mode: 'ingest',
                        allowedSourceKeys: new Set([...chunk.map(source => source.key), ...correctionKeys]),
                        sourceLabels: { ...correctionLabels, ...labelsOf(chunk) },
                        now: clock,
                        fieldValue,
                        onChange,
                    }),
                })
                stats.chunks += 1
                stats.sources += chunk.length
                cursor = advanceKnowledgeCursor(cursor, chunk)
                await db.doc(getKnowledgeBasePath(projectId)).update({ cursor })
            }
            // Everything read in this round was handled, including the documents it skipped.
            cursor = collected.nextCursor
            await db.doc(getKnowledgeBasePath(projectId)).update({ cursor })
            if (collected.exhausted) break
            if (round === MAX_COLLECT_ROUNDS - 1) moreWork = true
        }
    } catch (error) {
        if (error instanceof KnowledgeBaseRunStop) {
            stopReason = error.reason
            if (error.reason === 'time') moreWork = true
        } else {
            failure = error
            console.error('[knowledge base] Ingest run failed', { projectId, runId: leaseId, error: error.message })
        }
    }

    const finishedAt = clock()
    const status = failure
        ? 'failed'
        : stopReason && stopReason !== 'time'
          ? 'stopped'
          : moreWork
            ? 'partial'
            : 'completed'
    const nextRunAt =
        stopReason === KNOWLEDGE_BASE_OWNER_INACTIVE_STOP_REASON ||
        stopReason === KNOWLEDGE_BASE_PROJECT_ARCHIVED_STOP_REASON
            ? null
            : stopReason === KNOWLEDGE_BASE_MONTHLY_CAP_STOP_REASON
              ? startOfNextMonthUtc(finishedAt)
              : moreWork && !failure
                ? finishedAt + CONTINUE_DELAY_MS
                : nextNightlyRunAt(finishedAt, ownerData)

    if (runDocWritten) {
        await runRef.set(
            {
                status,
                stopReason,
                finishedAt,
                changes,
                ...stats,
                error: failure ? String(failure.message || failure).slice(0, 500) : null,
            },
            { merge: true }
        )
    }

    await releaseIngestLease(
        db,
        projectId,
        leaseId,
        startedAt,
        {
            cursor,
            monthlyGold,
            lastRunAt: finishedAt,
            lastRunStatus: status,
            lastRunStopReason: stopReason,
            ...(runDocWritten ? { lastRunId: leaseId } : {}),
            nextRunAt,
        },
        fieldValue
    )

    // Only after the stop is recorded: the notice links to settings that read it.
    if (stopReason === KNOWLEDGE_BASE_MONTHLY_CAP_STOP_REASON) {
        await notifyCapReached({
            projectId,
            ownerUserId,
            ownerData,
            month: monthlyGold.month,
            spent: monthlyGold.spent,
            goldCap,
            resumesAt: nextRunAt,
            db,
            fieldValue,
            now: finishedAt,
        })
    }

    return { status, stopReason, runId: runDocWritten ? leaseId : null, nextRunAt, changes, ...stats }
}

module.exports = {
    KNOWLEDGE_BASE_INGEST_MAX_RUN_WALL_CLOCK_MS,
    INGEST_LEASE_MS,
    CHUNK_MAX_TOKENS,
    MAX_REBUILDS_PER_RUN,
    MAX_CURRENT_STATE_REWRITES_PER_RUN,
    CONTINUE_DELAY_MS,
    GOLD_SOURCE,
    nextNightlyRunAt,
    startOfNextMonthUtc,
    buildSystemPrompt,
    createWikiTools,
    runKnowledgeBaseIngest,
}
