const { KnowledgeFirestoreDouble } = require('./__fixtures__/knowledgeFirestoreDouble')
const { setKnowledgeBaseSettings, requestKnowledgeBaseRefresh } = require('./knowledgeBaseSettings')

const PROJECT_ID = 'project-a'
const KB_PATH = `knowledgeBases/${PROJECT_ID}`
const NOW = 1_800_000_000_000

function createDb(knowledgeBase, userIds = ['owner', 'teammate']) {
    const documents = { [`projects/${PROJECT_ID}`]: { userIds } }
    if (knowledgeBase) documents[KB_PATH] = knowledgeBase
    return new KnowledgeFirestoreDouble(documents)
}

describe('setKnowledgeBaseSettings', () => {
    it('makes the member who switches the wiki on its owner and schedules the first build now', async () => {
        const db = createDb(null)

        const view = await setKnowledgeBaseSettings({
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
            settings: { enabled: true },
        })

        expect(view).toMatchObject({ enabled: true, ownerUserId: 'owner', nextRunAt: NOW, monthlyGoldCap: 500 })
        expect(db.read(KB_PATH)).toMatchObject({
            enabled: true,
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
            setKnowledgeBaseSettings({ db, userId: 'owner', projectId: PROJECT_ID, settings: { monthlyGoldCap: 1 } })
        ).rejects.toMatchObject({ code: 'invalid-argument' })
        expect(db.read(KB_PATH)).toBeUndefined()
    })

    it('lets only the paying owner change an enabled wiki', async () => {
        const db = createDb({ enabled: true, ownerUserId: 'owner', monthlyGoldCap: 500 })
        await expect(
            setKnowledgeBaseSettings({
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
            db,
            now: NOW,
            userId: 'teammate',
            projectId: PROJECT_ID,
            settings: { monthlyGoldCap: 900 },
        })

        expect(view).toMatchObject({ ownerUserId: 'teammate', monthlyGoldCap: 900, enabled: true })
    })

    it('lets any member edit a wiki that is off without becoming its owner', async () => {
        const db = createDb({ enabled: false, ownerUserId: 'owner', instructions: 'alt' })

        await setKnowledgeBaseSettings({
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

    it('does not reschedule an already enabled wiki on an unrelated edit', async () => {
        const db = createDb({ enabled: true, ownerUserId: 'owner', nextRunAt: NOW + 5000, enabledAt: 1 })

        await setKnowledgeBaseSettings({
            db,
            now: NOW,
            userId: 'owner',
            projectId: PROJECT_ID,
            settings: { instructions: 'neu' },
        })

        expect(db.read(KB_PATH)).toMatchObject({ nextRunAt: NOW + 5000, enabledAt: 1 })
    })
})

describe('requestKnowledgeBaseRefresh', () => {
    it('needs the wiki to be switched on', async () => {
        await expect(
            requestKnowledgeBaseRefresh({ db: createDb(null), userId: 'owner', projectId: PROJECT_ID })
        ).rejects.toMatchObject({ code: 'failed-precondition' })
    })

    it('lets any member ask for a run now', async () => {
        const db = createDb({ enabled: true, ownerUserId: 'owner', nextRunAt: NOW + 3_600_000 })

        const result = await requestKnowledgeBaseRefresh({ db, now: NOW, userId: 'teammate', projectId: PROJECT_ID })

        expect(result).toEqual({ success: true, alreadyRequested: false, nextRunAt: NOW })
        expect(db.read(KB_PATH)).toMatchObject({ nextRunAt: NOW, refreshRequestedBy: 'teammate' })
    })

    it('coalesces repeated presses inside the cooldown', async () => {
        const db = createDb({
            enabled: true,
            ownerUserId: 'owner',
            refreshRequestedAt: NOW - 60_000,
            nextRunAt: NOW - 60_000,
        })

        const result = await requestKnowledgeBaseRefresh({ db, now: NOW, userId: 'owner', projectId: PROJECT_ID })

        expect(result).toEqual({ success: true, alreadyRequested: true, nextRunAt: NOW - 60_000 })
        expect(db.read(KB_PATH).refreshRequestedAt).toBe(NOW - 60_000)
    })

    it('refuses anybody outside the project', async () => {
        await expect(
            requestKnowledgeBaseRefresh({
                db: createDb({ enabled: true, ownerUserId: 'owner' }),
                userId: 'outsider',
                projectId: PROJECT_ID,
            })
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })
})
