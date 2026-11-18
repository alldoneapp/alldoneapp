const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const {
    requestAssistantProfileRefresh,
    restoreAssistantProfileRevision,
    setAssistantProfileSettings,
} = require('./assistantProfileSettings')
const { normalizeAssistantProfileSettingsInput } = require('./assistantProfileModel')

const USER = 'karsten'
const PROFILE_PATH = `assistantProfiles/${USER}`
const NOW = Date.UTC(2026, 10, 18, 10, 0)

let enqueue
beforeEach(() => {
    enqueue = jest.fn(async () => 'enqueued')
})

function createDb(profile) {
    const documents = { [`users/${USER}`]: { timezone: 'Europe/Berlin', lastLogin: NOW } }
    if (profile) documents[PROFILE_PATH] = profile
    return new KnowledgeFirestoreDouble(documents)
}

describe('setAssistantProfileSettings', () => {
    it('keeps a profile the default has not reached yet on, and starts its first run now', async () => {
        const db = createDb(null)

        const view = await setAssistantProfileSettings({
            userId: USER,
            settings: { instructions: 'Keep it short.' },
            db,
            now: NOW,
            enqueue,
        })

        expect(view).toMatchObject({ enabled: true, enabledByDefault: true, instructions: 'Keep it short.' })
        expect(db.read(PROFILE_PATH)).toMatchObject({
            enabled: true,
            enabledBy: 'default',
            nextRunAt: NOW,
            revision: 0,
        })
        expect(enqueue).toHaveBeenCalledWith({ userId: USER, dueAt: NOW, trigger: 'enabled' })
    })

    it("records switching off as the user's choice and stops scheduling", async () => {
        const db = createDb({ enabled: true, enabledBy: 'default', nextRunAt: NOW + 1000 })

        const view = await setAssistantProfileSettings({
            userId: USER,
            settings: { enabled: false },
            db,
            now: NOW,
            enqueue,
        })

        expect(view.enabled).toBe(false)
        expect(db.read(PROFILE_PATH)).toMatchObject({
            enabled: false,
            enabledBy: 'user',
            nextRunAt: null,
            disabledAt: NOW,
        })
        expect(enqueue).not.toHaveBeenCalled()
    })

    it('stores a manual edit as a revision of its own', async () => {
        const db = createDb({ enabled: true, text: 'Old text', revision: 2, nextRunAt: NOW + 1000 })

        const view = await setAssistantProfileSettings({
            userId: USER,
            settings: { text: '  New text  ' },
            db,
            now: NOW,
            enqueue,
        })

        expect(view).toMatchObject({ text: 'New text', revision: 3 })
        expect(db.read(`${PROFILE_PATH}/revisions/r000003`)).toMatchObject({
            mode: 'user',
            text: 'New text',
            previousText: 'Old text',
        })
    })

    it('resumes a profile paused at the monthly cap once the cap is above what the month spent', async () => {
        const db = createDb({
            enabled: true,
            monthlyGoldCap: 100,
            monthlyGold: { month: '2026-11', spent: 100 },
            lastRunStopReason: 'monthly_cap',
            nextRunAt: Date.UTC(2026, 11, 1),
        })

        await setAssistantProfileSettings({ userId: USER, settings: { monthlyGoldCap: 200 }, db, now: NOW, enqueue })

        expect(db.read(PROFILE_PATH)).toMatchObject({ monthlyGoldCap: 200, nextRunAt: NOW })
        expect(enqueue).toHaveBeenCalledWith({ userId: USER, dueAt: NOW, trigger: 'enabled' })
    })

    it('merges source switches and refuses invalid input', async () => {
        const db = createDb({ enabled: true, sources: { chats: false }, nextRunAt: NOW + 1000 })
        const view = await setAssistantProfileSettings({
            userId: USER,
            settings: { sources: { notes: false } },
            db,
            now: NOW,
            enqueue,
        })
        expect(view.sources).toMatchObject({ chats: false, notes: false, tasks: true, memory: true })

        await expect(
            setAssistantProfileSettings({ userId: USER, settings: { monthlyGoldCap: 1 }, db, now: NOW, enqueue })
        ).rejects.toMatchObject({ code: 'invalid-argument' })
        await expect(
            setAssistantProfileSettings({ userId: USER, settings: { text: 'x'.repeat(4001) }, db, now: NOW, enqueue })
        ).rejects.toMatchObject({ code: 'invalid-argument' })
        await expect(setAssistantProfileSettings({ userId: null, settings: {}, db })).rejects.toMatchObject({
            code: 'unauthenticated',
        })
    })
})

describe('requestAssistantProfileRefresh', () => {
    it('schedules a run now, once per cooldown', async () => {
        const db = createDb({ enabled: true, nextRunAt: NOW + 1000 })

        expect(await requestAssistantProfileRefresh({ userId: USER, db, now: NOW, enqueue })).toMatchObject({
            alreadyRequested: false,
            nextRunAt: NOW,
        })
        expect(await requestAssistantProfileRefresh({ userId: USER, db, now: NOW + 1000, enqueue })).toMatchObject({
            alreadyRequested: true,
        })
        expect(enqueue).toHaveBeenCalledTimes(1)
    })

    it('refuses a profile that is switched off', async () => {
        await expect(
            requestAssistantProfileRefresh({ userId: USER, db: createDb({ enabled: false }), now: NOW, enqueue })
        ).rejects.toMatchObject({ code: 'failed-precondition' })
    })
})

describe('restoreAssistantProfileRevision', () => {
    it('puts an older version back as a new revision', async () => {
        const db = createDb({ enabled: true, text: 'Version two', revision: 2 })
        db.write(`${PROFILE_PATH}/revisions/r000001`, { revision: 1, text: 'Version one' })

        const result = await restoreAssistantProfileRevision({ userId: USER, revision: 1, db, now: NOW })

        expect(result).toMatchObject({ success: true, revision: 3 })
        expect(db.read(PROFILE_PATH)).toMatchObject({ text: 'Version one', revision: 3, textUpdatedBy: 'restore' })
        expect(db.read(`${PROFILE_PATH}/revisions/r000003`)).toMatchObject({ mode: 'restore', restoredFromRevision: 1 })
    })

    it('refuses a revision that does not exist', async () => {
        await expect(
            restoreAssistantProfileRevision({ userId: USER, revision: 9, db: createDb({ enabled: true }), now: NOW })
        ).rejects.toMatchObject({ code: 'not-found' })
    })
})

describe('normalizeAssistantProfileSettingsInput', () => {
    it('ignores unknown fields and unknown sources', () => {
        expect(normalizeAssistantProfileSettingsInput({ foo: 1, sources: { tasks: false, bogus: true } })).toEqual({
            sources: { tasks: false },
        })
    })

    it('refuses a model that is not on the menu', () => {
        expect(() => normalizeAssistantProfileSettingsInput({ model: 'MODEL_FREE_FOREVER' })).toThrow('model')
    })
})
