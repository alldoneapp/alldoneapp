const { KnowledgeFirestoreDouble } = require('./__fixtures__/knowledgeFirestoreDouble')
const { setKnowledgeBaseSettings, requestKnowledgeBaseRefresh } = require('./knowledgeBaseSettings')

const PROJECT_ID = 'project-a'
const KB_PATH = `knowledgeBases/${PROJECT_ID}`
const NOW = 1_800_000_000_000

let enqueue

beforeEach(() => {
    enqueue = jest.fn(async () => 'enqueued')
})

function createDb(knowledgeBase, userIds = ['owner', 'teammate']) {
    const documents = { [`projects/${PROJECT_ID}`]: { userIds } }
    if (knowledgeBase) documents[KB_PATH] = knowledgeBase
    return new KnowledgeFirestoreDouble(documents)
}

describe('setKnowledgeBaseSettings', () => {
    it('makes the member who switches the wiki on its owner and schedules the first build now', async () => {
        const db = createDb(null)

        const view = await setKnowledgeBaseSettings({
            enqueue,
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
            settings: { enabled: true },
        })

        expect(view).toMatchObject({ enabled: true, ownerUserId: 'owner', nextRunAt: NOW, monthlyGoldCap: 500 })
        expect(view).not.toHaveProperty('justEnabled')
        expect(enqueue).toHaveBeenCalledWith({ projectId: PROJECT_ID, dueAt: NOW, trigger: 'enabled' })
        expect(db.read(KB_PATH)).toMatchObject({
            enabled: true,
            enabledBy: 'member',
            ownerUserId: 'owner',
            enabledAt: NOW,
            nextRunAt: NOW,
            createdAt: NOW,
            model: 'MODEL_DEEPSEEK_V4_FLASH',
        })
    })

    it('refuses anybody outside the project', async () => {
        await expect(
            setKnowledgeBaseSettings({
                enqueue,
                db: createDb(null),
                userId: 'outsider',
                projectId: PROJECT_ID,
                settings: { enabled: true },
            })
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    it('reports invalid input as invalid-argument before touching anything', async () => {
        const db = createDb(null)
        await expect(
            setKnowledgeBaseSettings({
                enqueue,
                db,
                userId: 'owner',
                projectId: PROJECT_ID,
                settings: { monthlyGoldCap: 1 },
            })
        ).rejects.toMatchObject({ code: 'invalid-argument' })
        expect(db.read(KB_PATH)).toBeUndefined()
    })

    it('lets only the paying owner change an enabled wiki', async () => {
        const db = createDb({ enabled: true, ownerUserId: 'owner', monthlyGoldCap: 500 })
        await expect(
            setKnowledgeBaseSettings({
                enqueue,
                db,
                userId: 'teammate',
                projectId: PROJECT_ID,
                settings: { monthlyGoldCap: 100000 },
            })
        ).rejects.toMatchObject({ code: 'permission-denied' })
        expect(db.read(KB_PATH).monthlyGoldCap).toBe(500)
    })

    it('lets a member take over a wiki whose owner has left the project', async () => {
        const db = createDb({ enabled: true, ownerUserId: 'departed', monthlyGoldCap: 500 })

        const view = await setKnowledgeBaseSettings({
            enqueue,
            db,
            now: NOW,
            userId: 'teammate',
            projectId: PROJECT_ID,
            settings: { monthlyGoldCap: 900 },
        })

        expect(view).toMatchObject({ ownerUserId: 'teammate', monthlyGoldCap: 900, enabled: true })
        // Their own choice now: the default never hands this wiki on again.
        expect(db.read(KB_PATH).enabledBy).toBe('member')
    })

    it('lets the payer of a wiki the default switched on edit it without making it theirs by choice', async () => {
        const db = createDb({ enabled: true, enabledBy: 'default', ownerUserId: 'owner', nextRunAt: NOW + 5 })

        await setKnowledgeBaseSettings({
            enqueue,
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
            settings: { instructions: 'Eine Seite pro Kunde.' },
        })

        expect(db.read(KB_PATH)).toMatchObject({ enabledBy: 'default', ownerUserId: 'owner', nextRunAt: NOW + 5 })
    })

    it('runs a wiki paused for its inactive payer again as soon as that payer saves it', async () => {
        const db = createDb({
            enabled: true,
            ownerUserId: 'owner',
            nextRunAt: null,
            lastRunStopReason: 'owner_inactive',
        })

        const view = await setKnowledgeBaseSettings({
            enqueue,
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
            settings: { monthlyGoldCap: 800 },
        })

        expect(view).toMatchObject({ nextRunAt: NOW, pausedForInactiveOwner: false })
        expect(db.read(KB_PATH).nextRunAt).toBe(NOW)
    })

    it('runs a wiki paused for an archived project again when its payer saves it', async () => {
        const db = createDb({
            enabled: true,
            ownerUserId: 'owner',
            nextRunAt: null,
            lastRunStopReason: 'project_archived',
        })

        const view = await setKnowledgeBaseSettings({
            enqueue,
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
            settings: { instructions: 'neu' },
        })

        expect(view).toMatchObject({ nextRunAt: NOW, pausedForArchivedProject: false })
    })

    it('lets any member edit a wiki that is off without becoming its owner', async () => {
        const db = createDb({ enabled: false, ownerUserId: 'owner', instructions: 'alt' })

        await setKnowledgeBaseSettings({
            enqueue,
            db,
            now: NOW,
            userId: 'teammate',
            projectId: PROJECT_ID,
            settings: { instructions: 'Eine Seite pro Kunde.' },
        })

        expect(db.read(KB_PATH)).toMatchObject({ ownerUserId: 'owner', instructions: 'Eine Seite pro Kunde.' })
    })

    it('clears the schedule when the owner switches it off and keeps the settings', async () => {
        const db = createDb({ enabled: true, ownerUserId: 'owner', nextRunAt: NOW + 1000, instructions: 'Regeln' })

        await setKnowledgeBaseSettings({
            enqueue,
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
            settings: { enabled: false },
        })

        expect(db.read(KB_PATH)).toMatchObject({
            enabled: false,
            nextRunAt: null,
            disabledAt: NOW,
            instructions: 'Regeln',
        })
    })

    it('resumes a wiki paused at its monthly cap as soon as the payer raises the cap', async () => {
        const nextMonth = Date.UTC(2027, 1, 1)
        const db = createDb({
            enabled: true,
            ownerUserId: 'owner',
            monthlyGoldCap: 500,
            monthlyGold: { month: '2027-01', spent: 506 },
            lastRunStopReason: 'monthly_cap',
            nextRunAt: nextMonth,
        })

        const view = await setKnowledgeBaseSettings({
            enqueue,
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
            settings: { monthlyGoldCap: 1000 },
        })

        expect(view).toMatchObject({ monthlyGoldCap: 1000, nextRunAt: NOW, pausedAtMonthlyCap: false })
        expect(view).not.toHaveProperty('resumedFromCap')
        expect(db.read(KB_PATH).nextRunAt).toBe(NOW)
        expect(enqueue).toHaveBeenCalledWith({ projectId: PROJECT_ID, dueAt: NOW, trigger: 'cap_raised' })
    })

    it('keeps a capped wiki paused while the raised cap is still below this month’s spending', async () => {
        const nextMonth = Date.UTC(2027, 1, 1)
        const db = createDb({
            enabled: true,
            ownerUserId: 'owner',
            monthlyGoldCap: 500,
            monthlyGold: { month: '2027-01', spent: 506 },
            lastRunStopReason: 'monthly_cap',
            nextRunAt: nextMonth,
        })

        const view = await setKnowledgeBaseSettings({
            enqueue,
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
            settings: { monthlyGoldCap: 505 },
        })

        expect(view).toMatchObject({ nextRunAt: nextMonth, pausedAtMonthlyCap: true })
        expect(enqueue).not.toHaveBeenCalled()
    })

    it('does not reschedule an already enabled wiki on an unrelated edit', async () => {
        const db = createDb({ enabled: true, ownerUserId: 'owner', nextRunAt: NOW + 5000, enabledAt: 1 })

        await setKnowledgeBaseSettings({
            enqueue,
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
            settings: { instructions: 'neu' },
        })

        expect(db.read(KB_PATH)).toMatchObject({ nextRunAt: NOW + 5000, enabledAt: 1 })
        expect(enqueue).not.toHaveBeenCalled()
    })
})

describe('requestKnowledgeBaseRefresh', () => {
    it('needs the wiki to be switched on', async () => {
        await expect(
            requestKnowledgeBaseRefresh({ enqueue, db: createDb(null), userId: 'owner', projectId: PROJECT_ID })
        ).rejects.toMatchObject({ code: 'failed-precondition' })
    })

    it('lets any member ask for a run now', async () => {
        const db = createDb({ enabled: true, ownerUserId: 'owner', nextRunAt: NOW + 3_600_000 })

        const result = await requestKnowledgeBaseRefresh({
            enqueue,
            db,
            now: NOW,
            userId: 'teammate',
            projectId: PROJECT_ID,
        })

        expect(result).toEqual({ success: true, alreadyRequested: false, nextRunAt: NOW })
        expect(db.read(KB_PATH)).toMatchObject({ nextRunAt: NOW, refreshRequestedBy: 'teammate' })
        expect(enqueue).toHaveBeenCalledWith({ projectId: PROJECT_ID, dueAt: NOW, trigger: 'manual' })
    })

    it('coalesces repeated presses inside the cooldown', async () => {
        const db = createDb({
            enabled: true,
            ownerUserId: 'owner',
            refreshRequestedAt: NOW - 60_000,
            nextRunAt: NOW - 60_000,
        })

        const result = await requestKnowledgeBaseRefresh({
            enqueue,
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
        })

        expect(result).toEqual({ success: true, alreadyRequested: true, nextRunAt: NOW - 60_000 })
        expect(db.read(KB_PATH).refreshRequestedAt).toBe(NOW - 60_000)
        expect(enqueue).not.toHaveBeenCalled()
    })

    it('refuses anybody outside the project', async () => {
        await expect(
            requestKnowledgeBaseRefresh({
                enqueue,
                db: createDb({ enabled: true, ownerUserId: 'owner' }),
                userId: 'outsider',
                projectId: PROJECT_ID,
            })
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })
})

describe('immediate runs', () => {
    it('keeps a saved setting when the immediate enqueue fails, since the scheduler is the backstop', async () => {
        const db = createDb(null)
        enqueue.mockRejectedValueOnce(new Error('queue unavailable'))
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

        const view = await setKnowledgeBaseSettings({
            enqueue,
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
            settings: { enabled: true },
        })

        expect(view.enabled).toBe(true)
        expect(db.read(KB_PATH)).toMatchObject({ enabled: true, nextRunAt: NOW })
        warn.mockRestore()
    })
})
