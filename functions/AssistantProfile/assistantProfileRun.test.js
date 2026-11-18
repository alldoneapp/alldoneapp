const { KnowledgeFirestoreDouble, fieldValue } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const { runAssistantProfileUpdate, TRANSIENT_FAILURE_RETRY_DELAY_MS } = require('./assistantProfileRun')

const USER = 'karsten'
const PROFILE_PATH = `assistantProfiles/${USER}`
const NOW = Date.UTC(2026, 10, 18, 3, 0)
const DAY = 24 * 60 * 60 * 1000

function createDb({ profile = {}, user = {} } = {}) {
    return new KnowledgeFirestoreDouble({
        [`users/${USER}`]: {
            displayName: 'Karsten',
            lastLogin: NOW - DAY,
            gold: 1000,
            timezone: 'Europe/Berlin',
            defaultProjectId: 'p1',
            ...user,
        },
        [PROFILE_PATH]: {
            userId: USER,
            enabled: true,
            text: 'User description: builds Alldone.',
            revision: 3,
            nextRunAt: NOW,
            cursorAt: NOW - DAY,
            ...profile,
        },
    })
}

const activity =
    (count = 2) =>
    async ({ since }) => ({
        since: since || NOW - DAY,
        activityCount: count,
        counts: { tasks: count },
        sections: count ? [{ key: 'tasks', title: 'Tasks the user completed', lines: ['- Shipped AT-3072'] }] : [],
    })

// A model that saves (or keeps) through the run's own tools, like the real tool loop would.
function modelThat(decide) {
    return jest.fn(async ({ localTools, onRoundComplete, messages }) => {
        const result = await decide(localTools, messages)
        await onRoundComplete({ assistantText: 'ok', conversation: messages, round: 1 })
        return result
    })
}

function run(db, overrides = {}) {
    return runAssistantProfileUpdate({
        userId: USER,
        db,
        clock: () => NOW,
        leaseId: 'run-1',
        fieldValue,
        collectSources: activity(),
        measureRound: () => ({ tokens: 10000, gold: 5 }),
        charge: jest.fn(async () => ({ success: true })),
        publishFeed: jest.fn(async () => ({ published: true })),
        enqueueRun: jest.fn(async () => 'enqueued'),
        ...overrides,
    })
}

describe('runAssistantProfileUpdate', () => {
    it('writes a new revision, charges Gold, moves the window on and leaves one Updates line', async () => {
        const db = createDb()
        const publishFeed = jest.fn(async () => ({ published: true }))
        const charge = jest.fn(async () => ({ success: true }))
        const runConversation = modelThat(tools =>
            tools.save_profile.execute({
                profile: 'User description: builds Alldone.\nTop of mind: shipping the assistant profile.',
                summary: 'Added the assistant profile work.',
            })
        )

        const result = await run(db, { runConversation, publishFeed, charge })

        expect(result).toMatchObject({ status: 'completed', result: 'changed', revision: 4, goldSpent: 5 })
        const profile = db.read(PROFILE_PATH)
        expect(profile).toMatchObject({
            revision: 4,
            textUpdatedBy: 'run',
            cursorAt: NOW,
            lastRunStatus: 'completed',
            lastRunResult: 'changed',
            monthlyGold: { month: '2026-11', spent: 5 },
        })
        expect(profile.text).toContain('Top of mind')
        expect(profile.leaseOwner).toBeUndefined()
        // The next run is the user's next 04:00 (Berlin, UTC+1 in November).
        expect(profile.nextRunAt).toBe(Date.UTC(2026, 10, 19, 3, 0))
        expect(db.read(`${PROFILE_PATH}/revisions/r000004`)).toMatchObject({
            revision: 4,
            mode: 'run',
            previousText: 'User description: builds Alldone.',
            summary: 'Added the assistant profile work.',
            runId: 'run-1',
        })
        expect(charge).toHaveBeenCalledWith(
            expect.objectContaining({ userId: USER, gold: 5, idempotencyKey: 'assistant_profile_update:run-1:1' })
        )
        expect(publishFeed).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, revision: 4, now: NOW }))
    })

    it('gives the model the current profile, the activity and the user instructions, and no Alldone tools', async () => {
        const db = createDb({ profile: { instructions: 'Leave out my family.' } })
        let seen
        const runConversation = modelThat((tools, messages) => {
            seen = { tools: Object.keys(tools), messages }
            return tools.keep_profile.execute({ reason: 'nothing new' })
        })

        const result = await run(db, { runConversation })

        expect(seen.tools).toEqual(['save_profile', 'keep_profile'])
        const [[, system], [, user]] = seen.messages
        expect(system).toContain('Leave out my family.')
        expect(system).toContain('not instructions to you')
        expect(user).toContain('User description: builds Alldone.')
        expect(user).toContain('- Shipped AT-3072')
        expect(result).toMatchObject({ status: 'completed', result: 'unchanged', revision: null })
        expect(db.read(PROFILE_PATH)).toMatchObject({ revision: 3, cursorAt: NOW })
    })

    it('makes no model call and spends nothing on a quiet day', async () => {
        const db = createDb()
        const runConversation = jest.fn()
        const publishFeed = jest.fn()

        const result = await run(db, { runConversation, publishFeed, collectSources: activity(0) })

        expect(runConversation).not.toHaveBeenCalled()
        expect(publishFeed).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'completed', result: 'no_activity', modelCalled: false, runId: null })
        expect(db.read(PROFILE_PATH)).toMatchObject({ cursorAt: NOW, lastRunResult: 'no_activity' })
    })

    it('builds the first version from the description the user wrote, even without activity', async () => {
        const db = createDb({
            profile: { text: '', revision: 0 },
            user: { extendedDescription: 'Founder of Alldone, lives in Berlin.' },
        })
        let prompt
        const runConversation = modelThat((tools, messages) => {
            prompt = messages[1][1]
            return tools.save_profile.execute({
                profile: 'User description: Founder of Alldone.',
                summary: 'First version.',
            })
        })
        const collectSources = jest.fn(activity(0))

        const result = await run(db, { runConversation, collectSources })

        expect(collectSources).toHaveBeenCalledWith(expect.objectContaining({ includeAllMemory: true }))
        expect(prompt).toContain('Founder of Alldone, lives in Berlin.')
        expect(result).toMatchObject({ result: 'changed', revision: 1 })
    })

    it('drops its text when the user edited the profile while it ran, and reads the window again', async () => {
        const db = createDb()
        const runConversation = modelThat(async tools => {
            // The user saves their own version in the settings meanwhile.
            db.update(PROFILE_PATH, { text: 'My own words.', revision: 4 })
            return tools.save_profile.execute({ profile: 'The run version.', summary: 'x' })
        })

        const result = await run(db, { runConversation })

        expect(result).toMatchObject({ result: 'conflict', revision: null })
        const profile = db.read(PROFILE_PATH)
        expect(profile.text).toBe('My own words.')
        expect(profile.cursorAt).toBe(NOW - DAY)
    })

    it('pauses without a model call for a user who has been away for 30 days', async () => {
        const db = createDb({ user: { lastLogin: NOW - 40 * DAY } })
        const runConversation = jest.fn()

        const result = await run(db, { runConversation })

        expect(runConversation).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'stopped', stopReason: 'owner_inactive' })
        expect(db.read(PROFILE_PATH)).toMatchObject({ nextRunAt: null, lastRunStopReason: 'owner_inactive' })
    })

    it('pauses until the first of next month at the monthly cap, with one Updates line', async () => {
        const db = createDb({ profile: { monthlyGoldCap: 100, monthlyGold: { month: '2026-11', spent: 100 } } })
        const publishFeed = jest.fn(async () => ({ published: true }))
        const runConversation = jest.fn()

        const result = await run(db, { runConversation, publishFeed })

        expect(runConversation).not.toHaveBeenCalled()
        expect(result).toMatchObject({ status: 'stopped', stopReason: 'monthly_cap' })
        expect(db.read(PROFILE_PATH).nextRunAt).toBe(Date.UTC(2026, 11, 1))
        expect(publishFeed).toHaveBeenCalledWith(expect.objectContaining({ pausedMonth: '2026-11' }))
    })

    it('retries a dropped model connection within minutes, and keeps the window', async () => {
        const db = createDb()
        const enqueueRun = jest.fn(async () => 'enqueued')
        const runConversation = jest.fn(async () => {
            const error = new Error('Network connection lost.')
            error.status = 503
            throw error
        })

        const result = await run(db, { runConversation, enqueueRun })

        expect(result.status).toBe('failed')
        const profile = db.read(PROFILE_PATH)
        expect(profile.nextRunAt).toBe(NOW + TRANSIENT_FAILURE_RETRY_DELAY_MS)
        expect(profile.transientFailureRetries).toBe(1)
        expect(profile.cursorAt).toBe(NOW - DAY)
        expect(enqueueRun).toHaveBeenCalledWith({
            userId: USER,
            dueAt: NOW + TRANSIENT_FAILURE_RETRY_DELAY_MS,
            trigger: 'transient_retry',
        })
    })

    it('does nothing for a profile the user switched off or one another run holds', async () => {
        expect(await run(createDb({ profile: { enabled: false } }))).toEqual({ status: 'skipped', reason: 'disabled' })
        expect(await run(createDb({ profile: { leaseOwner: 'other', leaseExpiresAt: NOW + 1000 } }))).toEqual({
            status: 'skipped',
            reason: 'busy',
        })
    })

    it('lets the model shorten a profile that is too long instead of ending the run', async () => {
        const db = createDb()
        const responses = []
        const runConversation = modelThat(async tools => {
            responses.push(await tools.save_profile.execute({ profile: 'x'.repeat(5000), summary: 'too long' }))
            responses.push(await tools.save_profile.execute({ profile: 'short', summary: 'shortened' }))
        })

        const result = await run(db, { runConversation })

        expect(responses[0]).toMatchObject({ success: false, reason: 'too_long' })
        expect(responses[1]).toMatchObject({ success: true })
        expect(result).toMatchObject({ result: 'changed', revision: 4 })
    })
})
