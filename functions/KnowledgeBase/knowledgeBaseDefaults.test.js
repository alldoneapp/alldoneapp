const { KnowledgeFirestoreDouble } = require('./__fixtures__/knowledgeFirestoreDouble')
const {
    applyKnowledgeBaseDefault,
    applyKnowledgeBaseDefaultForNewProject,
    applyKnowledgeBaseDefaultsForActiveUsers,
    applyKnowledgeBaseDefaultsForUser,
} = require('./knowledgeBaseDefaults')
const { nextNightlyRunAt } = require('./knowledgeBaseSchedule')

const DAY = 24 * 60 * 60 * 1000
// 12:00 UTC; users are UTC+2, so their next 03:00 is tomorrow 01:00 UTC.
const NOW = Date.UTC(2026, 9, 24, 12)
const TONIGHT = Date.UTC(2026, 9, 25, 1)
const ACTIVE = NOW - 2 * DAY
const INACTIVE = NOW - 31 * DAY
const kbPath = projectId => `knowledgeBases/${projectId}`

function user(lastLogin, projectIds = ['p1']) {
    return { lastLogin, projectIds, timezone: 2 }
}

function project(extra = {}) {
    return {
        name: 'Project',
        active: true,
        isTemplate: false,
        creatorId: 'creator',
        userIds: ['creator', 'member'],
        ...extra,
    }
}

function createDb(documents) {
    return new KnowledgeFirestoreDouble(documents)
}

describe('applyKnowledgeBaseDefaultsForUser', () => {
    it('switches on a project that never had a wiki, paid by its active creator, from tonight', async () => {
        const db = createDb({
            'users/creator': user(ACTIVE),
            'users/member': user(ACTIVE),
            'projects/p1': project(),
        })

        const stats = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'member',
            userData: user(ACTIVE),
            now: NOW,
        })

        expect(stats).toMatchObject({ enabled: 1 })
        expect(db.read(kbPath('p1'))).toEqual({
            projectId: 'p1',
            enabled: true,
            enabledBy: 'default',
            ownerUserId: 'creator',
            instructions: '',
            model: 'MODEL_DEEPSEEK_V4_FLASH',
            monthlyGoldCap: 500,
            createdAt: NOW,
            enabledAt: NOW,
            updatedAt: NOW,
            nextRunAt: TONIGHT,
        })
        expect(TONIGHT).toBe(nextNightlyRunAt(NOW, { timezone: 2 }))
    })

    it('makes the member the payer when the creator is inactive or no longer in the project', async () => {
        const db = createDb({
            'users/creator': user(INACTIVE),
            'users/departed': user(ACTIVE),
            'projects/p1': project(),
            'projects/p2': project({ creatorId: 'departed' }),
        })

        await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'member',
            userData: user(ACTIVE, ['p1', 'p2']),
            now: NOW,
        })

        expect(db.read(kbPath('p1')).ownerUserId).toBe('member')
        expect(db.read(kbPath('p2')).ownerUserId).toBe('member')
    })

    it('leaves guides, templates and archived projects alone', async () => {
        const db = createDb({
            'projects/guide': project({ parentTemplateId: 'template-1' }),
            'projects/template': project({ isTemplate: true }),
            'projects/archived': project({ active: false }),
            'projects/elsewhere': project({ userIds: ['someone-else'] }),
        })

        const stats = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'creator',
            userData: user(ACTIVE, ['guide', 'template', 'archived', 'elsewhere', 'missing']),
            now: NOW,
        })

        expect(stats).toMatchObject({ enabled: 0, ineligible: 5 })
        for (const id of ['guide', 'template', 'archived', 'elsewhere', 'missing']) {
            expect(db.read(kbPath(id))).toBeUndefined()
        }
    })

    it('neither switches on nor pays for a project the member archived, without reading it', async () => {
        const db = createDb({ 'projects/p1': project(), 'projects/p2': project() })
        const member = { ...user(ACTIVE, ['p1', 'p2']), archivedProjectIds: ['p1', 'p2'] }

        const stats = await applyKnowledgeBaseDefaultsForUser({ db, userId: 'creator', userData: member, now: NOW })

        expect(stats).toMatchObject({ enabled: 0, archived: 2 })
        expect(db.read(kbPath('p1'))).toBeUndefined()
        expect(db.read(kbPath('p2'))).toBeUndefined()
    })

    it('lets a member who has the project active pay when its creator archived it', async () => {
        const db = createDb({
            'users/creator': { ...user(ACTIVE), archivedProjectIds: ['p1'] },
            'projects/p1': project(),
        })

        const stats = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'member',
            userData: user(ACTIVE),
            now: NOW,
        })

        expect(stats.enabled).toBe(1)
        expect(db.read(kbPath('p1'))).toMatchObject({ enabled: true, enabledBy: 'default', ownerUserId: 'member' })
    })

    it('resumes a wiki paused for an archived project once its payer reactivates it', async () => {
        const paused = {
            enabled: true,
            enabledBy: 'default',
            ownerUserId: 'creator',
            nextRunAt: null,
            lastRunStopReason: 'project_archived',
        }
        const db = createDb({ 'projects/p1': project(), [kbPath('p1')]: paused })

        const stillArchived = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'creator',
            userData: { ...user(ACTIVE), archivedProjectIds: ['p1'] },
            now: NOW,
        })
        expect(stillArchived).toMatchObject({ archived: 1, resumed: 0 })
        expect(db.read(kbPath('p1')).nextRunAt).toBeNull()

        const reactivated = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'creator',
            userData: { ...user(ACTIVE), archivedProjectIds: [] },
            now: NOW,
        })
        expect(reactivated.resumed).toBe(1)
        expect(db.read(kbPath('p1'))).toMatchObject({ ownerUserId: 'creator', nextRunAt: TONIGHT })
    })

    it('hands a default wiki to a member for whom the project is active once its payer archived it', async () => {
        const db = createDb({
            'users/creator': { ...user(ACTIVE), archivedProjectIds: ['p1'] },
            'projects/p1': project(),
            [kbPath('p1')]: {
                enabled: true,
                enabledBy: 'default',
                ownerUserId: 'creator',
                nextRunAt: null,
                lastRunStopReason: 'project_archived',
            },
        })

        const stats = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'member',
            userData: user(ACTIVE),
            now: NOW,
        })

        expect(stats.taken_over).toBe(1)
        expect(db.read(kbPath('p1'))).toMatchObject({ ownerUserId: 'member', nextRunAt: TONIGHT })
    })

    it('leaves a wiki a member switched on themselves with them while they have it archived', async () => {
        const paused = {
            enabled: true,
            enabledBy: 'member',
            ownerUserId: 'creator',
            nextRunAt: null,
            lastRunStopReason: 'project_archived',
        }
        const db = createDb({
            'users/creator': { ...user(ACTIVE), archivedProjectIds: ['p1'] },
            'projects/p1': project(),
            [kbPath('p1')]: paused,
        })

        const stats = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'member',
            userData: user(ACTIVE),
            now: NOW,
        })

        expect(stats.unchanged).toBe(1)
        expect(db.read(kbPath('p1'))).toEqual(paused)
    })

    it('does nothing for a user who has not used Alldone for 30 days', async () => {
        const db = createDb({ 'projects/p1': project() })

        const stats = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'creator',
            userData: user(INACTIVE),
            now: NOW,
        })

        expect(stats.enabled).toBe(0)
        expect(db.read(kbPath('p1'))).toBeUndefined()
    })

    it('never switches a wiki back on that a member switched off', async () => {
        const switchedOff = { enabled: false, ownerUserId: 'creator', disabledAt: NOW - DAY, nextRunAt: null }
        const db = createDb({ 'projects/p1': project(), [kbPath('p1')]: switchedOff })

        const stats = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'creator',
            userData: user(ACTIVE),
            now: NOW,
        })

        expect(stats.unchanged).toBe(1)
        expect(db.read(kbPath('p1'))).toEqual(switchedOff)
    })

    it('resumes the wiki the user pays for once they are back', async () => {
        const paused = {
            enabled: true,
            enabledBy: 'member',
            ownerUserId: 'creator',
            nextRunAt: null,
            lastRunStopReason: 'owner_inactive',
        }
        const db = createDb({ 'projects/p1': project(), [kbPath('p1')]: paused })

        const stats = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'creator',
            userData: user(ACTIVE),
            now: NOW,
        })

        expect(stats.resumed).toBe(1)
        expect(db.read(kbPath('p1'))).toMatchObject({ ownerUserId: 'creator', nextRunAt: TONIGHT })
    })

    it('hands a wiki the default switched on to an active member once its payer is inactive', async () => {
        const db = createDb({
            'users/creator': user(INACTIVE),
            'projects/p1': project(),
            [kbPath('p1')]: {
                enabled: true,
                enabledBy: 'default',
                ownerUserId: 'creator',
                nextRunAt: null,
                lastRunStopReason: 'owner_inactive',
                instructions: 'Eine Seite pro Kunde.',
            },
        })

        const stats = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'member',
            userData: user(ACTIVE),
            now: NOW,
        })

        expect(stats.taken_over).toBe(1)
        expect(db.read(kbPath('p1'))).toMatchObject({
            enabledBy: 'default',
            ownerUserId: 'member',
            nextRunAt: TONIGHT,
            instructions: 'Eine Seite pro Kunde.',
        })
    })

    it('keeps the schedule of a default wiki it hands over from a member who left', async () => {
        const db = createDb({
            'projects/p1': project({ userIds: ['member'] }),
            [kbPath('p1')]: { enabled: true, enabledBy: 'default', ownerUserId: 'creator', nextRunAt: NOW + 5 },
        })

        await applyKnowledgeBaseDefaultsForUser({ db, userId: 'member', userData: user(ACTIVE), now: NOW })

        expect(db.read(kbPath('p1'))).toMatchObject({ ownerUserId: 'member', nextRunAt: NOW + 5 })
    })

    it('never moves a wiki a member switched on themselves, nor one whose payer is still active', async () => {
        const memberChoice = {
            enabled: true,
            ownerUserId: 'creator',
            nextRunAt: null,
            lastRunStopReason: 'owner_inactive',
        }
        const stillPaid = { enabled: true, enabledBy: 'default', ownerUserId: 'creator', nextRunAt: TONIGHT }
        const db = createDb({
            'users/creator': user(INACTIVE),
            'users/other': user(ACTIVE),
            'projects/p1': project(),
            'projects/p2': project({ creatorId: 'other', userIds: ['other', 'member'] }),
            [kbPath('p1')]: memberChoice,
            [kbPath('p2')]: { ...stillPaid, ownerUserId: 'other' },
        })

        const stats = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'member',
            userData: user(ACTIVE, ['p1', 'p2']),
            now: NOW,
        })

        expect(stats.unchanged).toBe(2)
        expect(db.read(kbPath('p1'))).toEqual(memberChoice)
        expect(db.read(kbPath('p2'))).toEqual({ ...stillPaid, ownerUserId: 'other' })
    })

    it('counts a project it cannot read and carries on with the rest', async () => {
        const db = createDb({ 'projects/p2': project() })
        const original = db.doc.bind(db)
        db.doc = path => {
            if (path === 'projects/p1') return { get: async () => Promise.reject(new Error('unavailable')) }
            return original(path)
        }
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

        const stats = await applyKnowledgeBaseDefaultsForUser({
            db,
            userId: 'creator',
            userData: user(ACTIVE, ['p1', 'p2']),
            now: NOW,
        })

        expect(stats).toMatchObject({ failed: 1, enabled: 1 })
        consoleError.mockRestore()
    })
})

describe('applyKnowledgeBaseDefaultForNewProject', () => {
    it('switches the wiki of a new project on for its active creator', async () => {
        const db = createDb({ 'users/creator': user(ACTIVE) })

        const result = await applyKnowledgeBaseDefaultForNewProject({
            db,
            project: { id: 'p1', ...project() },
            now: NOW,
        })

        expect(result).toBe('enabled')
        expect(db.read(kbPath('p1'))).toMatchObject({ enabled: true, enabledBy: 'default', ownerUserId: 'creator' })
    })

    it('waits for the sweep when the creator is not active, and leaves guides alone', async () => {
        const db = createDb({ 'users/creator': user(INACTIVE) })

        await expect(
            applyKnowledgeBaseDefaultForNewProject({ db, project: { id: 'p1', ...project() }, now: NOW })
        ).resolves.toBe('inactive')
        await expect(
            applyKnowledgeBaseDefaultForNewProject({
                db,
                project: { id: 'guide', ...project({ parentTemplateId: 'template-1' }) },
                now: NOW,
            })
        ).resolves.toBe('ineligible')
        expect(db.read(kbPath('p1'))).toBeUndefined()
        expect(db.read(kbPath('guide'))).toBeUndefined()
    })
})

describe('applyKnowledgeBaseDefaultsForActiveUsers', () => {
    it('reaches every project of every active user once, and nobody who has been away', async () => {
        const db = createDb({
            'users/creator': user(ACTIVE, ['p1', 'p2']),
            'users/member': user(ACTIVE, ['p1']),
            'users/away': user(INACTIVE, ['p3']),
            'projects/p1': project(),
            'projects/p2': project({ userIds: ['creator'] }),
            'projects/p3': project({ creatorId: 'away', userIds: ['away'] }),
        })
        jest.spyOn(console, 'log').mockImplementation(() => {})

        const result = await applyKnowledgeBaseDefaultsForActiveUsers({ db, now: NOW })

        expect(result).toMatchObject({ activeUsers: 2, enabled: 2, unchanged: 1 })
        expect(db.read(kbPath('p1'))).toMatchObject({ ownerUserId: 'creator' })
        expect(db.read(kbPath('p2'))).toMatchObject({ ownerUserId: 'creator' })
        expect(db.read(kbPath('p3'))).toBeUndefined()
        expect(db.queries[0]).toMatchObject({
            collectionPath: 'users',
            filters: [{ field: 'lastLogin', operator: '>=', value: NOW - 30 * DAY }],
        })
        console.log.mockRestore()
    })
})

describe('applyKnowledgeBaseDefault', () => {
    it('does not overwrite a wiki created between its first look and its write', async () => {
        const db = createDb({ 'users/creator': user(ACTIVE) })
        const original = db.runTransaction.bind(db)
        db.runTransaction = async handler => {
            db.write(kbPath('p1'), { enabled: true, ownerUserId: 'someone', enabledBy: 'member' })
            return original(handler)
        }

        const result = await applyKnowledgeBaseDefault({
            db,
            projectId: 'p1',
            project: project(),
            userId: 'creator',
            userData: user(ACTIVE),
            loadUser: async () => user(ACTIVE),
            now: NOW,
        })

        expect(result).toBe('unchanged')
        expect(db.read(kbPath('p1'))).toEqual({ enabled: true, ownerUserId: 'someone', enabledBy: 'member' })
    })
})
