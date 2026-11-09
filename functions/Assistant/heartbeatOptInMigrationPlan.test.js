const { planHeartbeatConfirmations } = require('./heartbeatOptInMigrationPlan')
const { getHeartbeatConfigHash } = require('./heartbeatOptIn')

// NV-17 migration: by default only the assistant's creator keeps a heartbeat in a shared project.
describe('heartbeat confirmation migration plan', () => {
    const assistant = { uid: 'a1', creatorId: 'owner', heartbeatPrompt: 'Check in.', heartbeatChancePercent: 10 }
    const project = { userIds: ['owner', 'teammate'] }
    const usersById = new Map([
        ['owner', {}],
        ['teammate', {}],
    ])
    const plan = overrides =>
        planHeartbeatConfirmations({
            projectId: 'p1',
            project,
            assistants: [assistant],
            usersById,
            now: 5,
            ...overrides,
        })

    test('confirms only the creator by default, with the current configuration', () => {
        expect(plan()).toEqual([
            {
                userId: 'owner',
                projectId: 'p1',
                assistantId: 'a1',
                fieldPath: 'heartbeatOptIns.p1__a1',
                record: { configHash: getHeartbeatConfigHash(assistant), confirmedAt: 5, confirmedBy: 'migration' },
            },
        ])
    })

    test('confirms the only member of a one-member project whoever created the assistant', () => {
        expect(plan({ project: { userIds: ['teammate'] } }).map(entry => entry.userId)).toEqual(['teammate'])
    })

    test('confirms every member a heartbeat reaches today with scope all', () => {
        expect(plan({ scope: 'all' }).map(entry => entry.userId)).toEqual(['owner', 'teammate'])
    })

    test('skips inactive heartbeats, existing records, templates and former creators', () => {
        expect(plan({ assistants: [{ ...assistant, heartbeatChancePercent: 0 }] })).toEqual([])
        expect(plan({ usersById: new Map([['owner', { heartbeatOptIns: { p1__a1: { configHash: 'x' } } }]]) })).toEqual(
            []
        )
        expect(plan({ project: { ...project, isTemplate: true } })).toEqual([])
        expect(plan({ assistants: [{ ...assistant, creatorId: 'left-the-project' }] })).toEqual([])
        expect(() => plan({ scope: 'everyone' })).toThrow()
    })
})
