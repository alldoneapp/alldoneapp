const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const {
    applyAssistantProfileDefaultForUser,
    applyAssistantProfileDefaultsForActiveUsers,
} = require('./assistantProfileDefaults')

const NOW = Date.UTC(2026, 10, 18, 10, 0)
const DAY = 24 * 60 * 60 * 1000
const active = { lastLogin: NOW - DAY, timezone: 'Europe/Berlin' }

describe('assistant profile default', () => {
    it('switches the profile on for an active user who has none, first run at their next 04:00', async () => {
        const db = new KnowledgeFirestoreDouble({ 'users/u1': active })

        expect(await applyAssistantProfileDefaultForUser({ db, userId: 'u1', userData: active, now: NOW })).toBe(
            'enabled'
        )
        expect(db.read('assistantProfiles/u1')).toMatchObject({
            enabled: true,
            enabledBy: 'default',
            text: '',
            revision: 0,
            model: 'MODEL_DEEPSEEK_V4_FLASH',
            monthlyGoldCap: 300,
            // 04:00 in Berlin on the 19th is 03:00 UTC.
            nextRunAt: Date.UTC(2026, 10, 19, 3, 0),
        })
    })

    it('never switches back on a profile the user switched off', async () => {
        const db = new KnowledgeFirestoreDouble({ 'assistantProfiles/u1': { enabled: false, enabledBy: 'user' } })
        expect(await applyAssistantProfileDefaultForUser({ db, userId: 'u1', userData: active, now: NOW })).toBe(
            'exists'
        )
        expect(db.read('assistantProfiles/u1')).toEqual({ enabled: false, enabledBy: 'user' })
    })

    it('resumes a profile paused while its user was away', async () => {
        const db = new KnowledgeFirestoreDouble({
            'assistantProfiles/u1': { enabled: true, nextRunAt: null, lastRunStopReason: 'owner_inactive' },
        })
        expect(await applyAssistantProfileDefaultForUser({ db, userId: 'u1', userData: active, now: NOW })).toBe(
            'resumed'
        )
        expect(db.read('assistantProfiles/u1')).toMatchObject({
            nextRunAt: Date.UTC(2026, 10, 19, 3, 0),
            lastRunStopReason: null,
        })
    })

    it('leaves users alone who have not used Alldone for 30 days', async () => {
        const db = new KnowledgeFirestoreDouble({})
        const away = { lastLogin: NOW - 40 * DAY }
        expect(await applyAssistantProfileDefaultForUser({ db, userId: 'u1', userData: away, now: NOW })).toBe(
            'inactive'
        )
        expect(db.read('assistantProfiles/u1')).toBeUndefined()
    })

    it('sweeps the active users', async () => {
        const db = new KnowledgeFirestoreDouble({
            'users/u1': active,
            'users/u2': { lastLogin: NOW - 40 * DAY },
            'users/u3': active,
            'assistantProfiles/u3': { enabled: false },
        })
        const stats = await applyAssistantProfileDefaultsForActiveUsers({ db, now: NOW })
        expect(stats).toMatchObject({ activeUsers: 2, enabled: 1, exists: 1 })
        expect(db.read('assistantProfiles/u2')).toBeUndefined()
    })
})
