const { KnowledgeFirestoreDouble, fieldValue } = require('./__fixtures__/knowledgeFirestoreDouble')
const {
    CONTINUE_DELAY_MS,
    GOLD_SOURCE,
    MAX_CURRENT_STATE_REWRITES_PER_RUN,
    MAX_TRANSIENT_FAILURE_RETRIES,
    TRANSIENT_FAILURE_RETRY_DELAY_MS,
    nextNightlyRunAt,
    runKnowledgeBaseIngest,
    startOfNextMonthUtc,
} = require('./knowledgeBaseIngest')

const PROJECT_ID = 'project-a'
const KB_PATH = `knowledgeBases/${PROJECT_ID}`
const DAY = 24 * 60 * 60 * 1000
// 12:00 UTC; the owner is UTC+2 (the integer-hours shape of users/{uid}.timezone).
const NOW = Date.UTC(2026, 9, 24, 12)
const PUBLIC = [0, 'owner']
const pagePath = slug => `${KB_PATH}/pages/${slug}`
const taskPath = id => `items/${PROJECT_ID}/tasks/${id}`

function createDb(extra = {}, knowledgeBase = {}) {
    return new KnowledgeFirestoreDouble({
        [`projects/${PROJECT_ID}`]: { name: 'Alldone Product', userIds: ['owner', 'teammate'] },
        ['users/owner']: { gold: 1000, timezone: 2, displayName: 'Karsten', lastLogin: NOW - DAY },
        [KB_PATH]: {
            enabled: true,
            ownerUserId: 'owner',
            instructions: 'Eine Seite pro Kunde.',
            nextRunAt: NOW - 1,
            cursor: { tasks: { ms: NOW - 10 * DAY, ids: [] }, tasksCompleted: { ms: NOW - 10 * DAY, ids: [] } },
            // The weekly health check ran just now, so it stays out of the tests about everything
            // else; the `health check` block below sets its own state.
            lint: { lastLlmLintAt: NOW },
            ...knowledgeBase,
        },
        ...extra,
    })
}

// Stands in for the model: each call runs the next scripted turn against the run's REAL wiki tools.
function scriptedModel(...turns) {
    const calls = []
    const runConversation = jest.fn(async ({ messages, localTools, onRoundComplete, assertActive }) => {
        const turn = turns[calls.length] || (async () => {})
        calls.push({ system: messages[0][1], user: messages[1][1], toolNames: Object.keys(localTools) })
        const results = []
        const tools = new Proxy(localTools, {
            get: (target, name) => async args => {
                await assertActive()
                const result = await target[name].execute(args)
                results.push({ name, args, result })
                return result
            },
        })
        await turn(tools)
        await onRoundComplete({ assistantText: 'done', conversation: messages, round: 0 })
        calls[calls.length - 1].results = results
        return { finalResponseText: 'done' }
    })
    return { runConversation, calls }
}

function run(db, options = {}) {
    let time = NOW
    const clock = options.clock || (() => time)
    return runKnowledgeBaseIngest({
        projectId: PROJECT_ID,
        db,
        clock,
        leaseId: 'run-1',
        fieldValue,
        measureRound: () => ({ tokens: 4000, gold: 2 }),
        charge: jest.fn(async () => ({ success: true })),
        readNoteContent: async () => '',
        resolveUserNames: async () => ({ owner: 'Karsten' }),
        notifyCapReached: jest.fn(async () => ({ notified: true })),
        ...options,
    })
}

describe('scheduling helpers', () => {
    it("schedules the next run for 03:00 in the owner's own day", () => {
        // 12:00 UTC is 14:00 in UTC+2, so the next 03:00 local is tomorrow, 01:00 UTC.
        expect(nextNightlyRunAt(NOW, { timezone: 2 })).toBe(Date.UTC(2026, 9, 25, 1))
        // 00:30 UTC is 02:30 local: tonight's 03:00 is still ahead.
        expect(nextNightlyRunAt(Date.UTC(2026, 9, 24, 0, 30), { timezone: 2 })).toBe(Date.UTC(2026, 9, 24, 1))
    })

    it('pauses a capped wiki until the first of next month', () => {
        expect(startOfNextMonthUtc(Date.UTC(2026, 11, 31, 23))).toBe(Date.UTC(2027, 0, 1))
    })
})

describe('runKnowledgeBaseIngest', () => {
    it('spends nothing when nothing changed', async () => {
        const db = createDb()
        const { runConversation } = scriptedModel()

        const result = await run(db, { runConversation })

        expect(runConversation).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'completed', runId: null, goldSpent: 0 })
        const knowledgeBase = db.read(KB_PATH)
        expect(knowledgeBase.nextRunAt).toBe(nextNightlyRunAt(NOW, { timezone: 2 }))
        expect(knowledgeBase).not.toHaveProperty('leaseOwner')
        expect(db.read(`${KB_PATH}/runs/run-1`)).toBeUndefined()
    })

    it('folds a changed task into a page, keeps only real citations and bills the owner', async () => {
        const db = createDb({
            [taskPath('t1')]: { name: 'Acme als Pilotkunde gewinnen', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
        })
        const charge = jest.fn(async () => ({ success: true }))
        const { runConversation, calls } = scriptedModel(async tools => {
            await tools.write_page({
                title: 'Kunden',
                summary: 'Kunden und Piloten des Projekts.',
                body: 'Acme wird Pilotkunde [[task:t1]]. Angeblich auch [[task:invented]].',
                sourceKeys: ['task:t1', 'task:invented'],
                reason: 'Neuer Pilotkunde',
            })
        })

        const result = await run(db, { runConversation, charge })

        expect(calls).toHaveLength(1)
        expect(calls[0].toolNames).toEqual(['read_page', 'write_page', 'archive_page'])
        expect(calls[0].system).toContain('Alldone Product')
        expect(calls[0].system).toContain('Eine Seite pro Kunde.')
        expect(calls[0].system).not.toContain('Project description')
        expect(calls[0].user).toContain('[[task:t1]] "Acme als Pilotkunde gewinnen"')

        expect(db.read(pagePath('kunden'))).toMatchObject({
            body: 'Acme wird Pilotkunde [[task:t1]]. Angeblich auch .',
            sourceKeys: ['task:t1'],
            sourceLabels: { 'task:t1': 'Acme als Pilotkunde gewinnen' },
            revision: 1,
            lastRunId: 'run-1',
        })
        expect(charge).toHaveBeenCalledWith({
            userId: 'owner',
            gold: 2,
            idempotencyKey: `${GOLD_SOURCE}:run-1:ingest-0-0:0`,
            projectId: PROJECT_ID,
            model: 'MODEL_DEEPSEEK_V4_FLASH',
        })
        expect(result).toMatchObject({ status: 'completed', runId: 'run-1', goldSpent: 2, sources: 1 })

        const knowledgeBase = db.read(KB_PATH)
        expect(knowledgeBase.cursor.tasks).toEqual({ ms: NOW - DAY, ids: ['t1'] })
        expect(knowledgeBase.monthlyGold).toEqual({ month: '2026-10', spent: 2 })
        expect(knowledgeBase).toMatchObject({ lastRunId: 'run-1', lastRunStatus: 'completed' })
        expect(db.read(`${KB_PATH}/runs/run-1`)).toMatchObject({
            status: 'completed',
            changes: [{ type: 'created', slug: 'kunden' }],
            goldSpent: 2,
        })
    })

    it('never shows the model a private object', async () => {
        const db = createDb({
            [taskPath('private')]: {
                name: 'Gehaltsverhandlung Daniela',
                isPublicFor: ['owner'],
                lastEditionDate: NOW - DAY,
            },
            [taskPath('public')]: { name: 'Release planen', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
        })
        const { runConversation, calls } = scriptedModel()

        await run(db, { runConversation })

        expect(calls).toHaveLength(1)
        expect(JSON.stringify(calls)).not.toContain('Gehaltsverhandlung')
    })

    it('rebuilds a page that lost a source without showing the model its old text', async () => {
        const db = createDb({
            [taskPath('t1')]: { name: 'Acme Pilot', isPublicFor: PUBLIC, lastEditionDate: NOW - 30 * DAY },
            [pagePath('kunden')]: {
                slug: 'kunden',
                title: 'Kunden',
                summary: 'Kunden.',
                body: 'Acme [[task:t1]]. Der Rabatt ist GEHEIM-42 [[note:n1]].',
                revision: 2,
                sourceKeys: ['task:t1'],
                removedSourceKeys: ['note:n1'],
                needsRebuild: true,
                needsRebuildReason: 'privacy',
            },
        })
        const { runConversation, calls } = scriptedModel(async tools => {
            await tools.write_page({
                slug: 'kunden',
                title: 'Kunden',
                summary: 'Kunden.',
                body: 'Acme ist Pilotkunde [[task:t1]].',
                sourceKeys: ['task:t1'],
                reason: 'Neu aufgebaut',
            })
        })

        const result = await run(db, { runConversation })

        expect(calls).toHaveLength(1)
        expect(calls[0].system).toContain('Rebuild the page [[kunden]]')
        expect(JSON.stringify(calls)).not.toContain('GEHEIM-42')
        expect(calls[0].user).toContain('[[task:t1]] "Acme Pilot"')
        const page = db.read(pagePath('kunden'))
        expect(page).toMatchObject({ needsRebuild: false, body: 'Acme ist Pilotkunde [[task:t1]].', revision: 3 })
        expect(page).not.toHaveProperty('removedSourceKeys')
        expect(result.rebuilt).toBe(1)
    })

    it('asks for the current state, not the history, and lists sources oldest first in both modes', async () => {
        const db = createDb({
            [taskPath('decided')]: { name: 'Hosting: Cloud Run', isPublicFor: PUBLIC, lastEditionDate: NOW - 20 * DAY },
            [taskPath('options')]: {
                name: 'Hosting: App Engine oder Cloud Run?',
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - 30 * DAY,
            },
            [taskPath('changed')]: { name: 'Acme Pilot', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
            [pagePath('hosting')]: {
                slug: 'hosting',
                title: 'Hosting',
                body: 'Hosting [[task:decided]] [[task:options]] [[note:gone]].',
                revision: 1,
                // Newest first on purpose: the prompt must not inherit the page's own order.
                sourceKeys: ['task:decided', 'task:options'],
                removedSourceKeys: ['note:gone'],
                needsRebuild: true,
            },
        })
        const { runConversation, calls } = scriptedModel()

        await run(db, { runConversation })

        expect(calls).toHaveLength(2)
        for (const call of calls) {
            expect(call.system).toContain('Every page describes the current state of its subject')
            expect(call.system).toContain('Options belong on a page only while the decision is still open')
            expect(call.system).toContain('remove the outdated one together with its citation')
        }
        expect(calls[0].user).toMatch(/^Source cards for \[\[hosting\]\], oldest first:/)
        expect(calls[0].user.indexOf('[[task:options]]')).toBeLessThan(calls[0].user.indexOf('[[task:decided]]'))
        expect(calls[1].user).toMatch(/^Source cards, oldest first:/)
    })

    it('frames every conversation with the project description, which is never a source', async () => {
        const db = createDb(
            {
                [`projects/${PROJECT_ID}`]: {
                    name: 'Alldone Product',
                    userIds: ['owner', 'teammate'],
                    description: 'Alldone baut ein AI-Execution-OS.\n\n\n\nKunden und Piloten gehören hierher.',
                },
                [taskPath('decided')]: {
                    name: 'Hosting: Cloud Run',
                    isPublicFor: PUBLIC,
                    lastEditionDate: NOW - 20 * DAY,
                },
                [taskPath('changed')]: { name: 'Acme Pilot', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
                [pagePath('hosting')]: {
                    slug: 'hosting',
                    title: 'Hosting',
                    body: 'Hosting [[task:decided]] [[note:gone]].',
                    revision: 1,
                    sourceKeys: ['task:decided'],
                    removedSourceKeys: ['note:gone'],
                    needsRebuild: true,
                },
                [pagePath('betrieb')]: {
                    slug: 'betrieb',
                    title: 'Betrieb',
                    body: 'Läuft auf Cloud Run [[task:decided]].',
                    revision: 1,
                    sourceKeys: ['task:decided'],
                },
            },
            { currentStateRewrite: { requestedAt: NOW - 1000, pendingSlugs: ['betrieb'] } }
        )
        const { runConversation, calls } = scriptedModel()

        await run(db, { runConversation })

        // Rebuild, current-state rewrite and delta: the description frames all three.
        expect(calls.map(call => call.system.match(/^(Rebuild|Bring|The next message)/m)?.[1])).toEqual([
            'Rebuild',
            'Bring',
            'The next message',
        ])
        for (const call of calls) {
            expect(call.system).toContain(
                'Project description, as the project members wrote it:\nAlldone baut ein AI-Execution-OS.\n\nKunden und Piloten gehören hierher.'
            )
            expect(call.system).toContain('It is not a source: never cite it and never copy a statement from it')
            expect(call.system.indexOf('Project description')).toBeLessThan(call.system.indexOf('Rules:'))
            expect(call.user).not.toContain('AI-Execution-OS')
        }
    })

    it('caps a long project description', async () => {
        const db = createDb({
            [`projects/${PROJECT_ID}`]: { name: 'Alldone Product', userIds: ['owner'], description: 'x'.repeat(9000) },
            [taskPath('changed')]: { name: 'Acme Pilot', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
        })
        const { runConversation, calls } = scriptedModel()

        await run(db, { runConversation })

        expect(calls[0].system).toContain(`${'x'.repeat(4000)} […]`)
        expect(calls[0].system).not.toContain('x'.repeat(4001))
    })

    it('does not hand the page it is rebuilding back through read_page', async () => {
        const db = createDb({
            [taskPath('t1')]: { name: 'Acme Pilot', isPublicFor: PUBLIC, lastEditionDate: NOW - 30 * DAY },
            [pagePath('kunden')]: {
                slug: 'kunden',
                title: 'Kunden',
                body: 'Acme [[task:t1]]. Der Rabatt ist GEHEIM-42 [[note:n1]].',
                revision: 2,
                sourceKeys: ['task:t1'],
                removedSourceKeys: ['note:n1'],
                needsRebuild: true,
            },
        })
        const { runConversation, calls } = scriptedModel(async tools => {
            await tools.read_page({ slug: 'kunden' })
        })

        await run(db, { runConversation })

        expect(calls[0].results[0].result).toMatchObject({ success: false, error: expect.stringMatching(/rebuilt/) })
        expect(JSON.stringify(calls)).not.toContain('GEHEIM-42')
    })

    it('reads a page as it is now, not as it was when the run started', async () => {
        const db = createDb({
            [taskPath('t1')]: { name: 'Acme Pilot', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
            [pagePath('kunden')]: {
                slug: 'kunden',
                title: 'Kunden',
                body: 'Der Rabatt ist GEHEIM-42 [[note:n1]].',
                revision: 1,
                sourceKeys: ['note:n1'],
            },
        })
        const { runConversation, calls } = scriptedModel(async tools => {
            // The note is made private while the run is working (knowledgeSourceInvalidation).
            db.update(pagePath('kunden'), { needsRebuild: true, body: fieldValue.delete(), sourceKeys: [] })
            await tools.read_page({ slug: 'kunden' })
        })

        await run(db, { runConversation })

        expect(calls[0].results[0].result).toMatchObject({ success: false })
        expect(JSON.stringify(calls[0].results)).not.toContain('GEHEIM-42')
    })

    it('no longer tells the model about a correction that was undone', async () => {
        const db = createDb({
            [taskPath('t1')]: { name: 'Acme Pilot', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
            [`${KB_PATH}/corrections/k1`]: { text: 'Acme bleibt Kunde.', authorName: 'Karsten', createdAt: NOW - DAY },
            [`${KB_PATH}/corrections/k2`]: {
                text: 'Acme hat gekündigt.',
                authorName: 'Karsten',
                status: 'reverted',
                createdAt: NOW - DAY,
            },
        })
        const { runConversation, calls } = scriptedModel()

        await run(db, { runConversation })

        expect(calls[0].system).toContain('Acme bleibt Kunde.')
        expect(calls[0].system).not.toContain('Acme hat gekündigt.')
    })

    it('keeps a rebuild from touching any other page', async () => {
        const db = createDb({
            [taskPath('t1')]: { name: 'Acme Pilot', isPublicFor: PUBLIC, lastEditionDate: NOW - 30 * DAY },
            [pagePath('kunden')]: {
                slug: 'kunden',
                title: 'Kunden',
                revision: 1,
                sourceKeys: ['task:t1'],
                needsRebuild: true,
            },
            [pagePath('glossar')]: {
                slug: 'glossar',
                title: 'Glossar',
                body: 'unverändert',
                revision: 1,
                sourceKeys: [],
            },
        })
        const { runConversation, calls } = scriptedModel(async tools => {
            await tools.write_page({
                slug: 'glossar',
                title: 'Glossar',
                summary: 's',
                body: 'überschrieben',
                sourceKeys: [],
                reason: 'x',
            })
        })

        await run(db, { runConversation })

        expect(calls[0].results[0].result).toMatchObject({
            success: false,
            error: expect.stringMatching(/Only the page "kunden"/),
        })
        expect(db.read(pagePath('glossar')).body).toBe('unverändert')
        // The model wrote nothing for kunden, so it stays gone rather than coming back as it was.
        expect(db.read(pagePath('kunden'))).toMatchObject({ archived: true, needsRebuild: false })
    })

    it('archives a page with no sources left without asking the model', async () => {
        const db = createDb({
            [pagePath('geheim')]: {
                slug: 'geheim',
                title: 'Geheim',
                body: 'nur aus einer jetzt privaten Notiz [[note:n1]]',
                revision: 1,
                sourceKeys: [],
                removedSourceKeys: ['note:n1'],
                needsRebuild: true,
            },
        })
        const { runConversation } = scriptedModel()

        const result = await run(db, { runConversation })

        expect(runConversation).not.toHaveBeenCalled()
        expect(db.read(pagePath('geheim'))).toMatchObject({ archived: true, needsRebuild: false })
        expect(result.rebuildArchived).toBe(1)
    })

    it('leaves pages being rebuilt out of the index an ingest prompt carries', async () => {
        const db = createDb(
            {
                [taskPath('t2')]: { name: 'Neue Aufgabe', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
                [pagePath('kunden')]: {
                    slug: 'kunden',
                    title: 'Kunden',
                    summary: 'Rabatt GEHEIM-42',
                    revision: 1,
                    sourceKeys: [],
                    needsRebuild: true,
                },
            },
            {}
        )
        const { runConversation, calls } = scriptedModel()

        // With no sources left the page is archived unseen; the ingest after it must not carry its summary either.
        await run(db, { runConversation, loadSourcesByKeys: async () => [] })

        expect(calls).toHaveLength(1)
        expect(calls[0].system).not.toContain('GEHEIM-42')
    })

    it('pauses until next month once the monthly cap is spent, before calling the model', async () => {
        const db = createDb(
            { [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } },
            { monthlyGoldCap: 100, monthlyGold: { month: '2026-10', spent: 100 } }
        )
        const { runConversation } = scriptedModel()
        const notifyCapReached = jest.fn(async () => ({ notified: true }))

        const result = await run(db, { runConversation, notifyCapReached })

        expect(runConversation).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'stopped', stopReason: 'monthly_cap' })
        expect(db.read(KB_PATH).nextRunAt).toBe(Date.UTC(2026, 10, 1))
        // The payer is told, after the stop is recorded, with what the notice needs to say.
        expect(notifyCapReached).toHaveBeenCalledTimes(1)
        expect(notifyCapReached).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: PROJECT_ID,
                ownerUserId: 'owner',
                ownerData: expect.objectContaining({ displayName: 'Karsten' }),
                month: '2026-10',
                spent: 100,
                goldCap: 100,
                resumesAt: Date.UTC(2026, 10, 1),
            })
        )
    })

    it('tells the payer when a run spends the last of the monthly cap mid-run', async () => {
        const db = createDb(
            { [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } },
            { monthlyGoldCap: 100, monthlyGold: { month: '2026-10', spent: 99 } }
        )
        const { runConversation } = scriptedModel()
        const notifyCapReached = jest.fn(async () => ({ notified: true }))

        const result = await run(db, { runConversation, notifyCapReached })

        expect(result).toMatchObject({ status: 'stopped', stopReason: 'monthly_cap' })
        expect(notifyCapReached).toHaveBeenCalledWith(expect.objectContaining({ spent: 101, goldCap: 100 }))
    })

    // AT-2880: the payer raised the cap while a run was going. The run had read the old cap when it
    // claimed its lease and, before the fix, stopped at it and paused the wiki until the 1st, with a
    // cap far above what it had spent and a settings form that offered nothing left to save.
    describe('a cap raised while the run is going (AT-2880)', () => {
        const capped = { monthlyGoldCap: 100, monthlyGold: { month: '2026-10', spent: 99 } }
        const changedTask = { [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } }

        it('keeps running instead of stopping at the old cap', async () => {
            const db = createDb(changedTask, capped)
            const { runConversation } = scriptedModel(async () => {
                // The settings save lands while the model is still working on the first chunk.
                db.update(KB_PATH, { monthlyGoldCap: 1000 })
            })
            const notifyCapReached = jest.fn(async () => ({ notified: true }))
            const enqueueRun = jest.fn(async () => 'enqueued')

            const result = await run(db, { runConversation, notifyCapReached, enqueueRun })

            expect(result).toMatchObject({ status: 'completed', stopReason: null })
            expect(notifyCapReached).not.toHaveBeenCalled()
            const knowledgeBase = db.read(KB_PATH)
            expect(knowledgeBase).toMatchObject({
                monthlyGoldCap: 1000,
                monthlyGold: { month: '2026-10', spent: 101 },
                lastRunStopReason: null,
                nextRunAt: nextNightlyRunAt(NOW, { timezone: 2 }),
            })
        })

        it('does not pause the wiki when the cap is raised just before the stop is recorded', async () => {
            const db = createDb(changedTask, capped)
            // The run's own re-read still sees the old cap (the save lands right after it), and only
            // the release, which records the stop, sees the raised one.
            const realDoc = db.doc.bind(db)
            let staleReads = 0
            db.doc = path => {
                const ref = realDoc(path)
                if (path !== KB_PATH) return ref
                return {
                    ...ref,
                    get: async () => {
                        staleReads += 1
                        const snapshot = await ref.get()
                        db.update(KB_PATH, { monthlyGoldCap: 1000 })
                        return { ...snapshot, data: () => ({ ...snapshot.data(), monthlyGoldCap: 100 }) }
                    },
                }
            }
            const { runConversation } = scriptedModel()
            const notifyCapReached = jest.fn(async () => ({ notified: true }))
            const enqueueRun = jest.fn(async () => 'enqueued')

            const result = await run(db, { runConversation, notifyCapReached, enqueueRun })

            expect(staleReads).toBeGreaterThan(0)
            // The run did stop at the cap it knew about, and says so in its own record ...
            expect(result).toMatchObject({ stopReason: 'monthly_cap', capRaisedDuringRun: true, nextRunAt: NOW })
            // ... but the wiki is not paused until the 1st, and nobody is told the Gold ran out.
            const knowledgeBase = db.read(KB_PATH)
            expect(knowledgeBase.lastRunStopReason).toBeNull()
            expect(knowledgeBase.nextRunAt).toBe(NOW)
            expect(knowledgeBase).not.toHaveProperty('leaseOwner')
            expect(notifyCapReached).not.toHaveBeenCalled()
            expect(enqueueRun).toHaveBeenCalledWith({ projectId: PROJECT_ID, dueAt: NOW, trigger: 'cap_raised' })
        })

        it('still stops when the raised cap is not above what this month has spent', async () => {
            const db = createDb(changedTask, capped)
            const { runConversation } = scriptedModel(async () => {
                db.update(KB_PATH, { monthlyGoldCap: 101 })
            })
            const notifyCapReached = jest.fn(async () => ({ notified: true }))
            const enqueueRun = jest.fn()

            const result = await run(db, { runConversation, notifyCapReached, enqueueRun })

            expect(result).toMatchObject({ status: 'stopped', stopReason: 'monthly_cap' })
            expect(db.read(KB_PATH)).toMatchObject({
                lastRunStopReason: 'monthly_cap',
                nextRunAt: Date.UTC(2026, 10, 1),
            })
            expect(notifyCapReached).toHaveBeenCalledWith(expect.objectContaining({ spent: 101, goldCap: 101 }))
            expect(enqueueRun).not.toHaveBeenCalled()
        })

        it('keeps the old cap when it cannot re-read it', async () => {
            const db = createDb(changedTask, { ...capped, monthlyGold: { month: '2026-10', spent: 100 } })
            const realDoc = db.doc.bind(db)
            db.doc = path => {
                const ref = realDoc(path)
                if (path !== KB_PATH) return ref
                return {
                    ...ref,
                    get: async () => {
                        throw new Error('unavailable')
                    },
                }
            }
            const { runConversation } = scriptedModel()

            const result = await run(db, { runConversation })

            expect(runConversation).not.toHaveBeenCalled()
            expect(result).toMatchObject({ status: 'stopped', stopReason: 'monthly_cap' })
        })
    })

    it('starts a new month with a fresh budget', async () => {
        const db = createDb(
            { [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } },
            { monthlyGoldCap: 100, monthlyGold: { month: '2026-09', spent: 100 } }
        )
        const { runConversation } = scriptedModel()

        const result = await run(db, { runConversation })

        expect(runConversation).toHaveBeenCalledTimes(1)
        expect(result.status).toBe('completed')
        expect(db.read(KB_PATH).monthlyGold).toEqual({ month: '2026-10', spent: 2 })
    })

    // AT-2893: an archived project keeps its wiki, built and kept current like any other.
    it('builds the wiki of a project its payer has archived', async () => {
        const db = createDb({
            ['users/owner']: {
                gold: 1000,
                timezone: 2,
                lastLogin: NOW - DAY,
                archivedProjectIds: [PROJECT_ID],
            },
            [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
        })
        const { runConversation } = scriptedModel()

        const result = await run(db, { runConversation })

        expect(runConversation).toHaveBeenCalledTimes(1)
        expect(result.status).toBe('completed')
        expect(Number.isFinite(result.nextRunAt)).toBe(true)
        expect(db.read(KB_PATH).lastRunStopReason).not.toBe('project_archived')
        expect(Number.isFinite(db.read(KB_PATH).nextRunAt)).toBe(true)
    })

    it('spends nothing on an archived project in which nothing changed', async () => {
        const db = createDb({
            ['users/owner']: {
                gold: 1000,
                timezone: 2,
                lastLogin: NOW - DAY,
                archivedProjectIds: [PROJECT_ID],
            },
        })
        const { runConversation } = scriptedModel()
        const charge = jest.fn()

        const result = await run(db, { runConversation, charge })

        expect(runConversation).not.toHaveBeenCalled()
        expect(charge).not.toHaveBeenCalled()
        expect(result.status).toBe('completed')
        expect(Number.isFinite(result.nextRunAt)).toBe(true)
    })

    it('still pauses an archived project whose payer stopped using Alldone', async () => {
        const db = createDb({
            ['users/owner']: {
                gold: 1000,
                timezone: 2,
                lastLogin: NOW - 31 * DAY,
                archivedProjectIds: [PROJECT_ID],
            },
            [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
        })
        const { runConversation } = scriptedModel()

        const result = await run(db, { runConversation })

        expect(runConversation).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'stopped', stopReason: 'owner_inactive', nextRunAt: null })
    })

    it('stops when the owner has no Gold left', async () => {
        const db = createDb({
            ['users/owner']: { gold: 0, timezone: 2, lastLogin: NOW - DAY },
            [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
        })
        const { runConversation } = scriptedModel()
        const notifyCapReached = jest.fn()

        const result = await run(db, { runConversation, notifyCapReached })

        expect(runConversation).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'stopped', stopReason: 'insufficient_gold' })
        expect(notifyCapReached).not.toHaveBeenCalled()
    })

    it('pauses instead of spending Gold when the owner has not used Alldone for 30 days', async () => {
        const db = createDb({
            ['users/owner']: { gold: 1000, timezone: 2, lastLogin: NOW - 31 * DAY },
            [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
        })
        const { runConversation } = scriptedModel()

        const result = await run(db, { runConversation })

        expect(runConversation).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'stopped', stopReason: 'owner_inactive', nextRunAt: null, runId: null })
        expect(db.read(KB_PATH)).toMatchObject({
            enabled: true,
            nextRunAt: null,
            lastRunStatus: 'stopped',
            lastRunStopReason: 'owner_inactive',
        })
        expect(db.read(KB_PATH)).not.toHaveProperty('leaseOwner')
    })

    it('keeps a refresh requested while a paused run was going, instead of making it due forever', async () => {
        const db = createDb({ ['users/owner']: { gold: 1000, timezone: 2, lastLogin: NOW - 31 * DAY } })
        let ticks = 0
        // The second reading of the clock is the end of the run: a member pressed "refresh now" meanwhile.
        const clock = () => {
            ticks += 1
            if (ticks === 2) db.write(KB_PATH, { nextRunAt: NOW + 1000 }, { merge: true })
            return NOW
        }

        await run(db, { clock, runConversation: scriptedModel().runConversation })

        expect(db.read(KB_PATH).nextRunAt).toBe(NOW + 1000)
    })

    it('stops at a refused charge instead of running on unpaid', async () => {
        const documents = {}
        for (let index = 0; index < 3; index++) {
            documents[taskPath(`t${index}`)] = {
                name: `Aufgabe ${index}`,
                description: 'x'.repeat(5000),
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - DAY + index,
            }
        }
        const db = createDb(documents)
        const charge = jest.fn(async () => ({ success: false, message: 'Insufficient gold' }))
        const { runConversation } = scriptedModel()

        const result = await run(db, { runConversation, charge, measureRound: () => ({ tokens: 1, gold: 1 }) })

        expect(runConversation).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({ status: 'stopped', stopReason: 'insufficient_gold' })
    })

    it('hands what is left to the next run when the wall clock runs out', async () => {
        // Descriptions are cut to 1500 characters per card, so it takes many tasks to fill two chunks.
        const documents = {}
        for (let index = 0; index < 80; index++) {
            documents[taskPath(`t${String(index).padStart(2, '0')}`)] = {
                name: `Aufgabe ${index}`,
                description: 'y'.repeat(3000),
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - DAY + index,
            }
        }
        const db = createDb(documents)
        let time = NOW
        const { runConversation, calls } = scriptedModel(async () => {
            time += 24 * 60 * 1000
        })

        const result = await run(db, { runConversation, clock: () => time })

        expect(runConversation).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({ status: 'partial', stopReason: 'time' })
        const knowledgeBase = db.read(KB_PATH)
        expect(knowledgeBase.nextRunAt).toBe(time + CONTINUE_DELAY_MS)
        // Only the chunk that was handled moved the cursor: up to its last card, not past the rest.
        const handled = calls[0].user.match(/\[\[task:/g).length
        expect(handled).toBeLessThan(80)
        expect(knowledgeBase.cursor.tasks).toEqual({
            ms: NOW - DAY + handled - 1,
            ids: [`t${String(handled - 1).padStart(2, '0')}`],
        })
    })

    it('honours a refresh requested while it was running', async () => {
        const db = createDb({ [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } })
        const { runConversation } = scriptedModel(async () => {
            await db.doc(KB_PATH).update({ nextRunAt: NOW + 1 })
        })

        await run(db, { runConversation })

        expect(db.read(KB_PATH).nextRunAt).toBe(NOW + 1)
    })

    it('does not run a wiki another run is working on, or one that was switched off', async () => {
        const busy = createDb({}, { leaseOwner: 'other-run', leaseExpiresAt: NOW + 60_000 })
        await expect(run(busy, { runConversation: jest.fn() })).resolves.toEqual({ status: 'skipped', reason: 'busy' })

        const off = createDb({}, { enabled: false })
        await expect(run(off, { runConversation: jest.fn() })).resolves.toEqual({
            status: 'skipped',
            reason: 'disabled',
        })
    })

    it('takes over a lease its previous holder abandoned', async () => {
        const db = createDb({}, { leaseOwner: 'crashed-run', leaseExpiresAt: NOW - 1 })
        const result = await run(db, { runConversation: jest.fn() })
        expect(result.status).toBe('completed')
        expect(db.read(KB_PATH)).not.toHaveProperty('leaseOwner')
    })

    it('records a failure and still releases the lease', async () => {
        const db = createDb({ [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } })
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
        const runConversation = jest.fn(async () => {
            throw new Error('model unavailable')
        })

        const result = await run(db, { runConversation })

        expect(result.status).toBe('failed')
        expect(db.read(`${KB_PATH}/runs/run-1`)).toMatchObject({ status: 'failed', error: 'model unavailable' })
        const knowledgeBase = db.read(KB_PATH)
        expect(knowledgeBase).not.toHaveProperty('leaseOwner')
        expect(knowledgeBase.nextRunAt).toBe(nextNightlyRunAt(NOW, { timezone: 2 }))
        // The chunk that failed is read again next time.
        expect(knowledgeBase.cursor.tasks).toEqual({ ms: NOW - 10 * DAY, ids: [] })
        expect(knowledgeBase).not.toHaveProperty('transientFailureRetries')
        errorLog.mockRestore()
    })
})

describe('a run that fails on a transient model error (AT-2870)', () => {
    // The production failure: OpenRouter reported a lost upstream connection INSIDE an HTTP 200
    // stream, which the OpenAI SDK throws as an APIError with no status, code 502 and that message.
    const lostConnection = () => Object.assign(new Error('Network connection lost.'), { code: 502, status: undefined })
    const RETRY_AT = NOW + TRANSIENT_FAILURE_RETRY_DELAY_MS
    let errorLog
    let warnLog
    beforeEach(() => {
        errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
        warnLog = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
        errorLog.mockRestore()
        warnLog.mockRestore()
    })

    // Enough tasks for two chunks, so one block can finish before the next one breaks off.
    function twoChunkTasks() {
        const documents = {}
        for (let index = 0; index < 80; index++) {
            documents[taskPath(`t${String(index).padStart(2, '0')}`)] = {
                name: `Aufgabe ${index}`,
                description: 'y'.repeat(3000),
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - DAY + index,
            }
        }
        return documents
    }

    it('keeps the finished block, retries in minutes rather than tonight, and enqueues that run itself', async () => {
        const db = createDb(twoChunkTasks())
        const enqueueRun = jest.fn(async () => 'enqueued')
        const { runConversation, calls } = scriptedModel(
            async tools => {
                await tools.write_page({
                    title: 'Aufgaben',
                    summary: 'Was gerade ansteht.',
                    body: 'Aufgabe 0 steht an [[task:t00]].',
                    sourceKeys: ['task:t00'],
                    reason: 'Neu',
                })
            },
            async () => {
                throw lostConnection()
            }
        )

        const result = await run(db, { runConversation, enqueueRun })

        expect(calls).toHaveLength(2)
        expect(result).toMatchObject({ status: 'failed', nextRunAt: RETRY_AT })
        expect(db.read(`${KB_PATH}/runs/run-1`)).toMatchObject({ status: 'failed', error: 'Network connection lost.' })
        const knowledgeBase = db.read(KB_PATH)
        expect(knowledgeBase).toMatchObject({
            nextRunAt: RETRY_AT,
            transientFailureRetries: 1,
            lastRunStatus: 'failed',
        })
        expect(knowledgeBase).not.toHaveProperty('leaseOwner')
        // The finished block stays written and its cursor stays advanced; the broken one is read again.
        expect(db.read(pagePath('aufgaben'))).toMatchObject({ revision: 1 })
        const handled = calls[0].user.match(/\[\[task:/g).length
        expect(knowledgeBase.cursor.tasks).toEqual({
            ms: NOW - DAY + handled - 1,
            ids: [`t${String(handled - 1).padStart(2, '0')}`],
        })
        // Without waiting up to 15 minutes for the dispatcher, under the id the dispatcher would use.
        expect(enqueueRun).toHaveBeenCalledTimes(1)
        expect(enqueueRun).toHaveBeenCalledWith({ projectId: PROJECT_ID, dueAt: RETRY_AT, trigger: 'transient_retry' })
        expect(TRANSIENT_FAILURE_RETRY_DELAY_MS).toBeGreaterThanOrEqual(5 * 60 * 1000)
        expect(TRANSIENT_FAILURE_RETRY_DELAY_MS).toBeLessThanOrEqual(10 * 60 * 1000)
    })

    it.each([
        ['a rate limit', Object.assign(new Error('Rate limit exceeded'), { status: 429 })],
        ['a provider 503', Object.assign(new Error('503 Service Unavailable'), { status: 503 })],
        ['a dropped socket', Object.assign(new TypeError('terminated'), { cause: { code: 'UND_ERR_SOCKET' } })],
    ])('treats %s as transient too', async (_label, error) => {
        const db = createDb({ [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } })
        const enqueueRun = jest.fn(async () => 'enqueued')
        const runConversation = jest.fn(async () => {
            throw error
        })

        await run(db, { runConversation, enqueueRun })

        expect(db.read(KB_PATH).nextRunAt).toBe(RETRY_AT)
        expect(enqueueRun).toHaveBeenCalledTimes(1)
    })

    it.each([
        ['a refused request', Object.assign(new Error('400 Bad request'), { status: 400 })],
        ['missing credits', Object.assign(new Error('Insufficient credits'), { code: 402 })],
        [
            'an answer cut off by the token limit',
            new Error('OpenRouter returned an empty response (finish_reason: length)'),
        ],
    ])('keeps the nightly slot for %s', async (_label, error) => {
        const db = createDb(
            { [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } },
            { transientFailureRetries: 2 }
        )
        const enqueueRun = jest.fn()
        const runConversation = jest.fn(async () => {
            throw error
        })

        await run(db, { runConversation, enqueueRun })

        const knowledgeBase = db.read(KB_PATH)
        expect(knowledgeBase.nextRunAt).toBe(nextNightlyRunAt(NOW, { timezone: 2 }))
        expect(knowledgeBase).not.toHaveProperty('transientFailureRetries')
        expect(enqueueRun).not.toHaveBeenCalled()
    })

    it('stops retrying soon after a bounded number of transient failures in a row', async () => {
        const db = createDb(
            { [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } },
            { transientFailureRetries: MAX_TRANSIENT_FAILURE_RETRIES }
        )
        const enqueueRun = jest.fn()
        const runConversation = jest.fn(async () => {
            throw lostConnection()
        })

        const result = await run(db, { runConversation, enqueueRun })

        expect(result.status).toBe('failed')
        const knowledgeBase = db.read(KB_PATH)
        expect(knowledgeBase.nextRunAt).toBe(nextNightlyRunAt(NOW, { timezone: 2 }))
        // The nightly run starts a fresh series of quick retries.
        expect(knowledgeBase).not.toHaveProperty('transientFailureRetries')
        expect(enqueueRun).not.toHaveBeenCalled()
    })

    it('counts consecutive retries and forgets them after a run that does not fail', async () => {
        const db = createDb(
            { [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } },
            { transientFailureRetries: 1 }
        )
        const failing = jest.fn(async () => {
            throw lostConnection()
        })
        await run(db, { runConversation: failing, enqueueRun: jest.fn() })
        expect(db.read(KB_PATH).transientFailureRetries).toBe(2)

        await run(db, { runConversation: scriptedModel().runConversation, leaseId: 'run-2' })

        expect(db.read(KB_PATH)).not.toHaveProperty('transientFailureRetries')
        expect(db.read(KB_PATH).lastRunStatus).toBe('completed')
    })

    it('still honours an earlier refresh and survives an enqueue that fails', async () => {
        const db = createDb({ [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } })
        const enqueueRun = jest.fn(async () => {
            throw new Error('queue unavailable')
        })
        const runConversation = jest.fn(async () => {
            await db.doc(KB_PATH).update({ nextRunAt: NOW + 1 })
            throw lostConnection()
        })

        const result = await run(db, { runConversation, enqueueRun })

        expect(result.status).toBe('failed')
        expect(db.read(KB_PATH).nextRunAt).toBe(NOW + 1)
        expect(enqueueRun).toHaveBeenCalledWith({ projectId: PROJECT_ID, dueAt: NOW + 1, trigger: 'transient_retry' })
        expect(db.read(KB_PATH)).not.toHaveProperty('leaseOwner')
    })

    it('lets the transport hold back and retry each model answer, since nobody watches it stream', async () => {
        const db = createDb({ [taskPath('t1')]: { name: 'X', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY } })
        const { runConversation } = scriptedModel()

        await run(db, { runConversation })

        expect(runConversation.mock.calls[0][0].runtime).toMatchObject({ bufferModelOutput: true })
    })
})

describe('the one-time current-state pass', () => {
    const rewriteRequest = pendingSlugs => ({ currentStateRewrite: { requestedAt: NOW - 1000, pendingSlugs } })

    it('rewrites a pending page from the sources it cites, oldest first, and then clears the request', async () => {
        const db = createDb(
            {
                [`projects/${PROJECT_ID}`]: {
                    name: 'Alldone Product',
                    userIds: ['owner', 'teammate'],
                    description: 'Alldone baut ein AI-Execution-OS.',
                },
                [taskPath('options')]: {
                    name: 'Hosting: A oder B?',
                    isPublicFor: PUBLIC,
                    lastEditionDate: NOW - 30 * DAY,
                },
                [taskPath('decided')]: { name: 'Hosting: B', isPublicFor: PUBLIC, lastEditionDate: NOW - 20 * DAY },
                [pagePath('hosting')]: {
                    slug: 'hosting',
                    title: 'Hosting',
                    summary: 'Hosting.',
                    body: 'Im Meeting wurden A und B diskutiert [[task:options]]. Entschieden: B [[task:decided]].',
                    revision: 2,
                    sourceKeys: ['task:decided', 'task:options'],
                },
                [pagePath('kunden')]: { slug: 'kunden', title: 'Kunden', body: 'Acme.', revision: 1, sourceKeys: [] },
            },
            rewriteRequest(['hosting'])
        )
        const { runConversation, calls } = scriptedModel(async tools => {
            await tools.read_page({ slug: 'hosting' })
            await tools.write_page({
                slug: 'kunden',
                title: 'Kunden',
                summary: 'Kunden.',
                body: 'Etwas anderes.',
                sourceKeys: [],
                reason: 'Nebenbei',
            })
            await tools.write_page({
                slug: 'hosting',
                title: 'Hosting',
                summary: 'Das Projekt läuft auf B.',
                body: 'Das Projekt läuft auf B [[task:decided]].',
                sourceKeys: ['task:decided'],
                reason: 'Aktueller Stand',
            })
        })

        const result = await run(db, { runConversation })

        expect(calls).toHaveLength(1)
        expect(calls[0].system).toContain('Bring the page [[hosting]] up to the current state')
        expect(calls[0].system).toContain(
            'Project description, as the project members wrote it:\nAlldone baut ein AI-Execution-OS.'
        )
        expect(calls[0].system).toContain('Every page describes the current state of its subject')
        expect(calls[0].user).toMatch(/^Source cards for \[\[hosting\]\], oldest first:/)
        expect(calls[0].user.indexOf('[[task:options]]')).toBeLessThan(calls[0].user.indexOf('[[task:decided]]'))
        expect(calls[0].results[1].result).toMatchObject({ success: false, error: expect.stringMatching(/hosting/) })
        expect(db.read(pagePath('kunden')).body).toBe('Acme.')
        expect(db.read(pagePath('hosting'))).toMatchObject({
            body: 'Das Projekt läuft auf B [[task:decided]].',
            revision: 3,
        })
        expect(db.read(`${pagePath('hosting')}/revisions/000003`)).toMatchObject({ mode: 'ingest', runId: 'run-1' })
        expect(result).toMatchObject({ status: 'completed', rewritten: 1, rewriteUnchanged: 0 })
        expect(db.read(KB_PATH)).not.toHaveProperty('currentStateRewrite')
    })

    it('drops pages with nothing to rewrite without asking the model, and counts a page left as it was', async () => {
        const db = createDb(
            {
                [taskPath('t1')]: { name: 'Acme Pilot', isPublicFor: PUBLIC, lastEditionDate: NOW - 30 * DAY },
                [pagePath('alt')]: { slug: 'alt', title: 'Alt', revision: 4, archived: true, sourceKeys: ['task:t1'] },
                [pagePath('ohne-quellen')]: {
                    slug: 'ohne-quellen',
                    title: 'Ohne',
                    revision: 1,
                    sourceKeys: ['task:gone'],
                },
                [pagePath('aktuell')]: {
                    slug: 'aktuell',
                    title: 'Aktuell',
                    body: 'Acme [[task:t1]].',
                    revision: 2,
                    sourceKeys: ['task:t1'],
                },
            },
            rewriteRequest(['alt', 'fehlt', 'ohne-quellen', 'aktuell'])
        )
        const { runConversation, calls } = scriptedModel(async tools => {
            await tools.read_page({ slug: 'aktuell' })
        })

        const result = await run(db, { runConversation })

        expect(calls).toHaveLength(1)
        expect(calls[0].system).toContain('Bring the page [[aktuell]]')
        expect(db.read(pagePath('aktuell')).revision).toBe(2)
        expect(result).toMatchObject({ rewritten: 0, rewriteUnchanged: 1 })
        expect(db.read(KB_PATH)).not.toHaveProperty('currentStateRewrite')
    })

    it('does not rewrite again a page this run has just rebuilt', async () => {
        const db = createDb(
            {
                [taskPath('t1')]: { name: 'Acme Pilot', isPublicFor: PUBLIC, lastEditionDate: NOW - 30 * DAY },
                [pagePath('kunden')]: {
                    slug: 'kunden',
                    title: 'Kunden',
                    body: 'Acme [[task:t1]] [[note:n1]].',
                    revision: 2,
                    sourceKeys: ['task:t1'],
                    removedSourceKeys: ['note:n1'],
                    needsRebuild: true,
                },
            },
            rewriteRequest(['kunden'])
        )
        const { runConversation, calls } = scriptedModel(async tools => {
            await tools.write_page({
                slug: 'kunden',
                title: 'Kunden',
                summary: 'Kunden.',
                body: 'Acme ist Pilotkunde [[task:t1]].',
                sourceKeys: ['task:t1'],
                reason: 'Neu aufgebaut',
            })
        })

        const result = await run(db, { runConversation })

        expect(calls).toHaveLength(1)
        expect(calls[0].system).toContain('Rebuild the page [[kunden]]')
        expect(result).toMatchObject({ rebuilt: 1, rewritten: 0, rewriteUnchanged: 0 })
        expect(db.read(KB_PATH)).not.toHaveProperty('currentStateRewrite')
    })

    it('rewrites a bounded number of pages per run and continues with the rest soon', async () => {
        const slugs = Array.from(
            { length: MAX_CURRENT_STATE_REWRITES_PER_RUN + 2 },
            (_, index) => `seite-${index + 10}`
        )
        const pageDocs = Object.fromEntries(
            slugs.map(slug => [
                pagePath(slug),
                { slug, title: slug, body: 'Acme [[task:t1]].', revision: 1, sourceKeys: ['task:t1'] },
            ])
        )
        const db = createDb(
            { [taskPath('t1')]: { name: 'Acme', isPublicFor: PUBLIC, lastEditionDate: NOW - 30 * DAY }, ...pageDocs },
            rewriteRequest(slugs)
        )
        const { runConversation, calls } = scriptedModel()

        const result = await run(db, { runConversation })

        expect(calls).toHaveLength(MAX_CURRENT_STATE_REWRITES_PER_RUN)
        expect(result.status).toBe('partial')
        const knowledgeBase = db.read(KB_PATH)
        expect(knowledgeBase.currentStateRewrite).toEqual({
            requestedAt: NOW - 1000,
            pendingSlugs: slugs.slice(MAX_CURRENT_STATE_REWRITES_PER_RUN),
        })
        expect(knowledgeBase.nextRunAt).toBe(NOW + CONTINUE_DELAY_MS)
    })

    it('keeps a page pending when the run stops during its conversation', async () => {
        const db = createDb(
            {
                [taskPath('t1')]: { name: 'Acme', isPublicFor: PUBLIC, lastEditionDate: NOW - 30 * DAY },
                [pagePath('kunden')]: {
                    slug: 'kunden',
                    title: 'Kunden',
                    body: 'Acme [[task:t1]].',
                    revision: 1,
                    sourceKeys: ['task:t1'],
                },
            },
            rewriteRequest(['kunden'])
        )
        const { runConversation } = scriptedModel()

        const result = await run(db, { runConversation, charge: jest.fn(async () => ({ success: false })) })

        expect(result).toMatchObject({ status: 'stopped', stopReason: 'insufficient_gold' })
        expect(db.read(KB_PATH).currentStateRewrite.pendingSlugs).toEqual(['kunden'])
    })
})

describe('the weekly health check', () => {
    const lintPage = (slug, data = {}) => ({
        title: slug,
        summary: `About ${slug}.`,
        body: `About ${slug} [[task:${slug}-source]].`,
        sourceKeys: [`task:${slug}-source`],
        revision: 1,
        archived: false,
        needsRebuild: false,
        updatedAt: NOW - DAY,
        ...data,
    })
    const lintDb = (pages, knowledgeBase = {}, extra = {}) =>
        createDb(
            {
                ...Object.fromEntries(Object.entries(pages).map(([slug, data]) => [pagePath(slug), data])),
                ...extra,
            },
            { lint: {}, ...knowledgeBase }
        )

    it('fixes what it can prove, leaves recently corrected pages alone and records why in the history', async () => {
        const db = lintDb(
            { preise: lintPage('preise'), team: lintPage('team'), vertrieb: lintPage('vertrieb') },
            {},
            {
                [`${KB_PATH}/corrections/k1`]: {
                    text: 'Das Team ist kleiner.',
                    pageSlug: 'team',
                    status: 'applied',
                    createdAt: NOW - 2 * DAY,
                },
            }
        )
        const { runConversation, calls } = scriptedModel(async tools => {
            await tools.read_page({ slug: 'preise' })
            await tools.write_page({
                slug: 'preise',
                title: 'preise',
                summary: 'About preise.',
                body: 'About preise [[task:preise-source]], sold by [[vertrieb]].\n\n## Open questions\n\n- Team size [[task:team-source]]?',
                sourceKeys: ['task:preise-source', 'task:team-source', 'task:invented'],
                reason: 'linked the sales page',
            })
            await tools.read_page({ slug: 'team' })
            await tools.write_page({
                slug: 'team',
                title: 'team',
                summary: 'x',
                body: 'Changed.',
                sourceKeys: [],
                reason: 'x',
            })
        })

        const result = await run(db, { runConversation })

        expect(calls).toHaveLength(1)
        expect(calls[0].system).toContain('Health check of the wiki (today is 2026-10-24)')
        expect(calls[0].system).toContain('must not be changed: [[team]]')
        expect(calls[0].user).toContain('=== [[preise]]')
        const refused = calls[0].results.find(entry => entry.name === 'write_page' && entry.args.slug === 'team')
        expect(refused.result).toMatchObject({
            success: false,
            error: expect.stringMatching(/corrected by a project member/),
        })

        expect(db.read(pagePath('preise'))).toMatchObject({
            revision: 2,
            sourceKeys: ['task:preise-source', 'task:team-source'],
        })
        expect(db.read(`${pagePath('preise')}/revisions/000002`)).toMatchObject({
            mode: 'lint',
            reason: 'lint: linked the sales page',
        })
        expect(db.read(pagePath('team')).revision).toBe(1)
        expect(result).toMatchObject({ status: 'completed', lintEdits: 1 })
        const knowledgeBase = db.read(KB_PATH)
        expect(knowledgeBase.lint).toMatchObject({ lastLlmLintAt: NOW, lastLlmLintRunId: 'run-1', lastLlmLintEdits: 1 })
        expect(knowledgeBase.lintReport).toMatchObject({ pageCount: 3, counts: expect.any(Object) })
        expect(knowledgeBase.lastSuccessfulRunAt).toBe(NOW)
    })

    it('stops at its share of the monthly cap and never spends the reserve', async () => {
        const pages = { preise: lintPage('preise'), team: lintPage('team') }
        const reserved = lintDb(pages, { monthlyGoldCap: 100, monthlyGold: { month: '2026-10', spent: 80 } })
        const { runConversation } = scriptedModel()

        const result = await run(reserved, { runConversation })

        expect(runConversation).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'completed', lintStop: 'budget', stopReason: null })
        expect(reserved.read(KB_PATH).lint).toEqual({})

        // A pass that crosses its share mid-way ends there; the run itself is not stopped.
        const crossing = lintDb(
            Object.fromEntries(
                Array.from({ length: 6 }, (_, index) => [
                    `p${index}`,
                    lintPage(`p${index}`, { body: 'x '.repeat(9000) }),
                ])
            ),
            { monthlyGoldCap: 100, monthlyGold: { month: '2026-10', spent: 70 } }
        )
        const scripted = scriptedModel()
        const crossed = await run(crossing, {
            runConversation: scripted.runConversation,
            measureRound: () => ({ tokens: 1, gold: 15 }),
        })
        expect(scripted.calls).toHaveLength(1)
        expect(crossed).toMatchObject({ status: 'completed', stopReason: null, lintStop: 'budget' })
        expect(crossing.read(KB_PATH).monthlyGold.spent).toBe(85)
    })

    it('changes at most ten pages in one pass', async () => {
        const slugs = Array.from({ length: 12 }, (_, index) => `seite-${index}`)
        const db = lintDb(Object.fromEntries(slugs.map(slug => [slug, lintPage(slug)])))
        const { runConversation, calls } = scriptedModel(async tools => {
            for (const slug of slugs) {
                await tools.read_page({ slug })
                await tools.write_page({
                    slug,
                    title: slug,
                    summary: 's',
                    body: `Linked [[task:${slug}-source]] [[seite-0]].`,
                    sourceKeys: [],
                    reason: 'links',
                })
            }
        })

        const result = await run(db, { runConversation })

        const writes = calls[0].results.filter(entry => entry.name === 'write_page')
        expect(writes.filter(entry => entry.result.success)).toHaveLength(10)
        expect(writes[10].result.error).toMatch(/at most 10 pages/)
        expect(result.lintEdits).toBe(10)
    })

    it('waits a week after a pass, and does not run while the wiki is still catching up', async () => {
        const pages = { preise: lintPage('preise', { updatedAt: NOW }), team: lintPage('team') }
        const recent = lintDb(pages, { lint: { lastLlmLintAt: NOW - 3 * DAY } })
        const { runConversation } = scriptedModel()
        await run(recent, { runConversation })
        expect(runConversation).not.toHaveBeenCalled()

        // More pages waiting for a rebuild than one run takes: the next run continues right away.
        const rebuilding = Object.fromEntries(
            Array.from({ length: 11 }, (_, index) => [
                `alt-${index}`,
                lintPage(`alt-${index}`, { needsRebuild: true, sourceKeys: [] }),
            ])
        )
        const catchingUp = lintDb({ ...pages, ...rebuilding })
        const second = scriptedModel()
        const result = await run(catchingUp, { runConversation: second.runConversation })
        expect(result.status).toBe('partial')
        expect(second.runConversation).not.toHaveBeenCalled()
    })

    it('records when the wiki last caught up only for a run that did', async () => {
        const db = createDb({}, { lastSuccessfulRunAt: NOW - 3 * DAY })
        const failing = jest.fn(async () => {
            throw new Error('boom')
        })
        db.write(taskPath('t1'), { name: 'Neu', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY })

        const result = await run(db, { runConversation: failing })

        expect(result.status).toBe('failed')
        expect(db.read(KB_PATH).lastSuccessfulRunAt).toBe(NOW - 3 * DAY)
    })
})
