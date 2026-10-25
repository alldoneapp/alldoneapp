'use strict'

// One ingest run of a project wiki: rebuild the pages that lost a source, then work through what
// changed since the last run, a prompt-sized chunk at a time, and let the model fold it into the
// pages with three tools of its own (read_page, write_page, archive_page). Runs unattended from the
// runKnowledgeBaseIngest Cloud Tasks worker.
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
//   - nothing changed → no model call at all, the next nightly slot.

const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')
const crypto = require('crypto')

const { HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS } = require('../Assistant/assistantRunLimits')
const { getUserLocalDayStart } = require('../GoogleCalendar/calendarUserDay')
const {
    advanceKnowledgeCursor,
    buildCorrectionCard,
    chunkKnowledgeSources,
    collectKnowledgeSources,
    loadKnowledgeSourcesByKeys,
} = require('./collectKnowledgeSources')
const {
    getKnowledgeBasePath,
    getKnowledgeCorrectionsPath,
    getKnowledgePagePath,
    getKnowledgeRunsPath,
    isKnowledgePageVisible,
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

// The run shares the heartbeat's budget for the same reason: it is delivered through Cloud Tasks,
// whose dispatch deadline tops out at 30 minutes.
const KNOWLEDGE_BASE_INGEST_MAX_RUN_WALL_CLOCK_MS = HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS
const INGEST_LEASE_MS = KNOWLEDGE_BASE_INGEST_MAX_RUN_WALL_CLOCK_MS + 5 * 60 * 1000
// No new conversation starts with less than this left: a chunk that cannot finish is wasted Gold.
const MIN_CONVERSATION_TIME_MS = 3 * 60 * 1000
const CHUNK_MAX_TOKENS = 16000
const MAX_COLLECT_ROUNDS = 4
const MAX_REBUILDS_PER_RUN = 10
const MAX_TOOL_ROUNDS_PER_CONVERSATION = 40
const MAX_CORRECTIONS_IN_PROMPT = 30
const CONTINUE_DELAY_MS = 60 * 1000
const NIGHTLY_HOUR = 3
const INGEST_TEMPERATURE = 'TEMPERATURE_LOW'
const GOLD_SOURCE = 'knowledge_base_ingest'

class KnowledgeBaseRunStop extends Error {
    constructor(reason) {
        super(reason)
        this.reason = reason
    }
}

function monthKey(now) {
    return new Date(now).toISOString().slice(0, 7)
}

function startOfNextMonthUtc(now) {
    const date = new Date(now)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}

// The next 03:00 in the owner's own day, so a wiki is rebuilt while its project sleeps.
function nextNightlyRunAt(now, ownerData = {}) {
    const dayStart = getUserLocalDayStart(ownerData, now)
    const tonight = dayStart.clone().add(NIGHTLY_HOUR, 'hours').valueOf()
    return tonight > now ? tonight : dayStart.clone().add(1, 'day').add(NIGHTLY_HOUR, 'hours').valueOf()
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
// was going (nextRunAt moved past its start) is honoured rather than overwritten.
async function releaseIngestLease(db, projectId, leaseId, startedAt, update, fieldValue) {
    const ref = db.doc(getKnowledgeBasePath(projectId))
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return false
        const current = snapshot.data() || {}
        if (current.leaseOwner !== leaseId) return false
        let nextRunAt = update.nextRunAt
        if (current.enabled !== true) nextRunAt = null
        else if (Number(current.nextRunAt) > startedAt) nextRunAt = Math.min(nextRunAt, Number(current.nextRunAt))
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

const WIKI_RULES = [
    'Rules:',
    '- Integrate what is durable and useful for the people working on the project: who is who, customers and partners, decisions and their reasons, terms, how things are done, open questions and risks, milestones. Skip trivia and routine status noise.',
    '- Prefer extending an existing page over creating a new one. Keep each page focused on one subject; split a page that grows past about 1500 words and link the parts.',
    '- Read a page with read_page before you replace it. write_page replaces the whole body, so keep what is still true.',
    '- Cite every statement with the token of the source it came from, exactly as given: [[task:ID]], [[goal:ID]], [[note:ID]], [[contact:ID]], [[correction:ID]], [[document:ID]]. List every source you used in sourceKeys.',
    '- A document (a [[document:ID]] card) was added by a project member so that the wiki takes it in: work its substance into the pages it concerns and update what it supersedes, rather than writing a page that only summarizes the document; create a new page only for a subject no page covers yet. When the member said what to take from it, follow that. A long document arrives in parts; each part is a card of its own.',
    '- Link other wiki pages with [[slug]] or [[slug|label]].',
    '- A correction by a project member overrides older sources. Never bring back what a correction rejected.',
    '- Never copy email addresses, phone numbers, passwords, keys or other credentials into a page.',
    '- Write in the language most of the sources are written in. Use markdown headings and lists.',
    "- The summary is one sentence of at most 200 characters; it is the page's line in the wiki index.",
    '- When you are done, answer with one short line describing what you changed (or that nothing was worth adding).',
].join('\n')

function buildSystemPrompt({ projectName, instructions, index, corrections, task }) {
    return [
        `You maintain the wiki of the project "${projectName}" in Alldone: a small set of markdown pages that capture what the project knows. Project members read it, and the project's assistants use it as context.`,
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
        mode === 'rebuild' && slug !== targetSlug ? `Only the page "${targetSlug}" may be changed in this run.` : null

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
                    mode,
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
                    mode,
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
}) {
    if (!projectId) throw new Error('projectId is required')
    const startedAt = clock()
    const claim = await claimIngestLease(db, projectId, leaseId, startedAt)
    if (!claim.claimed) return { status: 'skipped', reason: claim.reason }

    const knowledgeBase = claim.knowledgeBase
    const ownerUserId = knowledgeBase.ownerUserId
    const modelKey = resolveKnowledgeBaseModel(knowledgeBase.model)
    const goldCap = resolveKnowledgeBaseMonthlyGoldCap(knowledgeBase.monthlyGoldCap)
    const currentMonth = monthKey(startedAt)
    const monthlyGold = {
        month: currentMonth,
        spent: knowledgeBase.monthlyGold?.month === currentMonth ? Number(knowledgeBase.monthlyGold.spent) || 0 : 0,
    }
    const deadline = startedAt + maxRunWallClockMs
    const runRef = db.doc(`${getKnowledgeRunsPath(projectId)}/${leaseId}`)
    const changes = []
    const stats = { sources: 0, chunks: 0, rebuilt: 0, rebuildArchived: 0, goldSpent: 0, truncated: [] }
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
        if (monthlyGold.spent >= goldCap) throw new KnowledgeBaseRunStop('monthly_cap')
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
                if (monthlyGold.spent >= goldCap) throw new KnowledgeBaseRunStop('monthly_cap')
            },
        })
    }

    try {
        if (!ownerUserId) throw new KnowledgeBaseRunStop('no_owner')
        const ownerSnapshot = await db.doc(`users/${ownerUserId}`).get()
        ownerData = ownerSnapshot.exists ? ownerSnapshot.data() || {} : {}
        if (!ownerSnapshot.exists || !(Number(ownerData.gold) > 0)) throw new KnowledgeBaseRunStop('insufficient_gold')
        if (monthlyGold.spent >= goldCap) throw new KnowledgeBaseRunStop('monthly_cap')

        const projectSnapshot = await db.doc(`projects/${projectId}`).get()
        const projectName = (projectSnapshot.exists && projectSnapshot.data()?.name) || projectId
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
            const sources = await loadSourcesByKeys({ db, projectId, keys: remainingKeys, ...sourceOptions })
            if (sources.length) {
                await conversation({
                    label: `rebuild-${page.slug}`,
                    systemPrompt: buildSystemPrompt({
                        projectName,
                        instructions: knowledgeBase.instructions,
                        index: buildKnowledgeIndex(pages),
                        corrections,
                        task: `Rebuild the page [[${page.slug}]] from scratch, using ONLY the source cards in the next message. Its previous text is withheld on purpose: a source it relied on is no longer available, and nothing that source said may come back. Keep the slug "${page.slug}". If the remaining sources do not support a useful page, call archive_page.`,
                    }),
                    userPrompt: `Source cards for [[${page.slug}]]:\n\n${sources.map(source => source.text).join('\n\n')}`,
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

        // 2. Fold in what changed since the last run.
        for (let round = 0; round < MAX_COLLECT_ROUNDS; round++) {
            const collected = await collectSources({ db, projectId, cursor, now: clock(), ...sourceOptions })
            stats.truncated.push(...collected.stats.truncated)
            const chunks = chunkKnowledgeSources(collected.sources, { maxTokens: CHUNK_MAX_TOKENS })
            for (const [chunkIndex, chunk] of chunks.entries()) {
                await conversation({
                    label: `ingest-${round}-${chunkIndex}`,
                    systemPrompt: buildSystemPrompt({
                        projectName,
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
        stopReason === 'monthly_cap'
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

    return { status, stopReason, runId: runDocWritten ? leaseId : null, nextRunAt, changes, ...stats }
}

module.exports = {
    KNOWLEDGE_BASE_INGEST_MAX_RUN_WALL_CLOCK_MS,
    INGEST_LEASE_MS,
    CHUNK_MAX_TOKENS,
    MAX_REBUILDS_PER_RUN,
    CONTINUE_DELAY_MS,
    GOLD_SOURCE,
    nextNightlyRunAt,
    startOfNextMonthUtc,
    buildSystemPrompt,
    createWikiTools,
    runKnowledgeBaseIngest,
}
