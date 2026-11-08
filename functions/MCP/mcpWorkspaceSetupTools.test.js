jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { arrayUnion: (...values) => ({ __arrayUnion: values }) },
}))

const {
    executeWorkspaceSetupTool,
    buildSchedule,
    DAILY_LIMITS,
    DEFAULT_ASSISTANT_TOOL_KEYS,
    MCP_WORKSPACE_SETUP_TOOLS,
    MCP_WORKSPACE_SETUP_TOOL_SCHEMAS,
} = require('./mcpWorkspaceSetupTools')

// A small in-memory Firestore: enough of the Admin SDK surface the setup tools use (doc/collection
// reads and writes, dotted-path updates, arrayUnion, batches, transactions, getAll).
function createFakeDb(initial = {}) {
    const docs = new Map(Object.entries(initial).map(([path, data]) => [path, JSON.parse(JSON.stringify(data))]))
    let autoId = 0

    const applyUpdate = (path, data) => {
        if (!docs.has(path)) throw new Error(`No document to update: ${path}`)
        const target = docs.get(path)
        for (const [key, value] of Object.entries(data)) {
            const parts = key.split('.')
            let node = target
            for (const part of parts.slice(0, -1)) {
                node[part] = node[part] && typeof node[part] === 'object' ? node[part] : {}
                node = node[part]
            }
            const last = parts[parts.length - 1]
            if (value && value.__arrayUnion) {
                const current = Array.isArray(node[last]) ? node[last] : []
                node[last] = [...current, ...value.__arrayUnion.filter(item => !current.includes(item))]
            } else {
                node[last] = JSON.parse(JSON.stringify(value))
            }
        }
    }

    const snapshotOf = path => {
        const exists = docs.has(path)
        return {
            id: path.split('/').pop(),
            exists,
            data: () => (exists ? JSON.parse(JSON.stringify(docs.get(path))) : undefined),
        }
    }

    const docRef = path => ({
        path,
        id: path.split('/').pop(),
        get: async () => snapshotOf(path),
        set: async data => docs.set(path, JSON.parse(JSON.stringify(data))),
        update: async data => applyUpdate(path, data),
    })

    const db = {
        docs,
        doc: docRef,
        collection: path => ({
            doc: id => docRef(`${path}/${id || `auto${++autoId}`}`),
            get: async () => {
                const prefix = `${path}/`
                const matching = [...docs.keys()].filter(
                    key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/')
                )
                return { size: matching.length, docs: matching.map(snapshotOf) }
            },
        }),
        getAll: async (...refs) => refs.map(ref => snapshotOf(ref.path)),
        batch: () => {
            const ops = []
            return {
                set: (ref, data) => ops.push(() => docs.set(ref.path, JSON.parse(JSON.stringify(data)))),
                update: (ref, data) => ops.push(() => applyUpdate(ref.path, data)),
                commit: async () => ops.forEach(op => op()),
            }
        },
        runTransaction: async fn => {
            const ops = []
            const result = await fn({
                get: async ref => snapshotOf(ref.path),
                set: (ref, data) => ops.push(() => docs.set(ref.path, JSON.parse(JSON.stringify(data)))),
                update: (ref, data) => ops.push(() => applyUpdate(ref.path, data)),
            })
            ops.forEach(op => op())
            return result
        },
    }
    return db
}

const USER = 'user-1'
const OTHER = 'user-2'
// Sunday 08.11.2026 10:00 UTC (11:00 in Berlin).
const NOW = Date.UTC(2026, 10, 8, 10, 0, 0)

const baseDb = (extra = {}) =>
    createFakeDb({
        [`users/${USER}`]: { projectIds: ['p-existing'], preferredTimezone: 'Europe/Berlin' },
        [`users/${OTHER}`]: { projectIds: ['p-other'] },
        'projects/p-existing': { name: 'Alldone Business', userIds: [USER], contactStatuses: {} },
        'projects/p-other': { name: 'Someone else', userIds: [OTHER] },
        ...extra,
    })

const run = (db, tool, args, userId = USER) =>
    executeWorkspaceSetupTool(
        tool,
        userId,
        args,
        { mcpClient: 'Claude', baseUrl: 'https://my.alldone.app' },
        {
            db,
            now: () => NOW,
        }
    )

describe('MCP workspace setup tools', () => {
    it('serves exactly one schema per tool name', () => {
        expect(MCP_WORKSPACE_SETUP_TOOL_SCHEMAS.map(schema => schema.name)).toEqual(MCP_WORKSPACE_SETUP_TOOLS)
    })

    describe('create_project', () => {
        it('creates the project, its membership and its main workstream, with contact statuses in order', async () => {
            const db = baseDb()
            const result = await run(db, 'create_project', {
                name: 'Alldone Growth',
                description: 'Growth loop pipeline',
                contactStatuses: [
                    { name: 'new idea/potential' },
                    { name: 'reached out', followUpDays: 5 },
                    { name: 'in conversation', color: '#00f477' },
                ],
            })

            expect(result.alreadyExisted).toBe(false)
            const project = db.docs.get(`projects/${result.projectId}`)
            expect(project).toMatchObject({
                name: 'Alldone Growth',
                description: 'Growth loop pipeline',
                creatorId: USER,
                userIds: [USER],
                workstreamIds: ['ws@default'],
                isTemplate: false,
                parentTemplateId: '',
                active: true,
                createdVia: { via: 'mcp', viaClient: 'Claude' },
            })
            expect(project.goalMilestonesConfig.timezone).toBe('Europe/Berlin')
            expect(db.docs.get(`users/${USER}`).projectIds).toEqual(['p-existing', result.projectId])
            expect(db.docs.get(`projectsWorkstreams/${result.projectId}/workstreams/ws@default`)).toMatchObject({
                displayName: 'Team',
                projectId: result.projectId,
                userIds: [USER],
            })

            expect(result.contactStatuses.map(status => status.name)).toEqual([
                'new idea/potential',
                'reached out',
                'in conversation',
            ])
            const stored = Object.values(project.contactStatuses)
            expect(stored.find(status => status.name === 'reached out').followUpDays).toBe(5)
            expect(stored.find(status => status.name === 'in conversation').color).toBe('#00F477')
            stored.forEach(status => expect(project.contactStatuses[status.id]).toBe(status))
        })

        it('returns the existing project for the same name and only adds the missing statuses', async () => {
            const db = baseDb({
                'projects/p-existing': {
                    name: 'Alldone Business',
                    userIds: [USER],
                    contactStatuses: { s1: { id: 's1', name: 'Reached out', sortIndex: 1 } },
                },
            })
            const result = await run(db, 'create_project', {
                name: '  alldone business ',
                contactStatuses: [{ name: 'reached out' }, { name: 'won' }],
            })

            expect(result).toMatchObject({ projectId: 'p-existing', alreadyExisted: true })
            expect(result.contactStatuses.map(status => status.name)).toEqual(['Reached out', 'won'])
            expect(db.docs.get(`users/${USER}`).projectIds).toEqual(['p-existing'])
        })

        it('does not count a guide or template with the same name as an existing project', async () => {
            const db = baseDb({
                [`users/${USER}`]: { projectIds: ['p-guide'] },
                'projects/p-guide': { name: 'Alldone Growth', userIds: [USER], parentTemplateId: 'tpl' },
            })
            const result = await run(db, 'create_project', { name: 'Alldone Growth' })
            expect(result.alreadyExisted).toBe(false)
            expect(result.projectId).not.toBe('p-guide')
        })

        it('rejects an empty name, an unknown colour and a bad follow-up', async () => {
            const db = baseDb()
            await expect(run(db, 'create_project', { name: '  ' })).rejects.toThrow('name must not be empty')
            await expect(run(db, 'create_project', { name: 'X', color: 'red' })).rejects.toThrow('color must be one of')
            await expect(
                run(db, 'create_project', { name: 'X', contactStatuses: [{ name: 'a', followUpDays: 0 }] })
            ).rejects.toThrow('followUpDays')
        })

        it('stops at the daily limit', async () => {
            const db = baseDb()
            for (let i = 0; i < DAILY_LIMITS.create_project; i++) {
                await run(db, 'create_project', { name: `Project ${i}` })
            }
            await expect(run(db, 'create_project', { name: 'One too many' })).rejects.toThrow('limited to')
        })
    })

    describe('add_contact_statuses', () => {
        it('adds new statuses and skips names that already exist', async () => {
            const db = baseDb({
                'projects/p-existing': {
                    name: 'Alldone Business',
                    userIds: [USER],
                    contactStatuses: { s1: { id: 's1', name: 'Won', sortIndex: 1 } },
                },
            })
            const result = await run(db, 'add_contact_statuses', {
                projectId: 'p-existing',
                statuses: [{ name: 'won' }, { name: 'Lost' }, { name: 'lost' }],
            })
            expect(result.added).toEqual(['Lost'])
            expect(result.contactStatuses.map(status => status.name)).toEqual(['Won', 'Lost'])
            expect(Object.keys(db.docs.get('projects/p-existing').contactStatuses)).toHaveLength(2)
        })

        it('refuses a project the user is not a member of', async () => {
            const db = baseDb()
            await expect(
                run(db, 'add_contact_statuses', { projectId: 'p-other', statuses: [{ name: 'x' }] })
            ).rejects.toThrow('not accessible')
        })
    })

    describe('create_assistant', () => {
        it('creates an assistant with the app defaults', async () => {
            const db = baseDb()
            const result = await run(db, 'create_assistant', {
                projectId: 'p-existing',
                name: 'Growth Lead',
                instructions: 'Find profitable customers.',
            })
            const assistant = db.docs.get(`assistants/p-existing/items/${result.assistantId}`)
            expect(assistant).toMatchObject({
                displayName: 'Growth Lead',
                instructions: 'Find profitable customers.',
                model: 'MODEL_GPT6_SOL',
                creatorId: USER,
                isDefault: false,
                heartbeatChancePercent: 0,
                createdVia: { via: 'mcp', viaClient: 'Claude' },
            })
            expect(assistant.allowedTools).toEqual(DEFAULT_ASSISTANT_TOOL_KEYS)
            expect(assistant.allowedTools).not.toContain('browser_automation')
        })

        it('accepts valid tool keys and models, rejects unknown ones', async () => {
            const db = baseDb()
            const ok = await run(db, 'create_assistant', {
                projectId: 'p-existing',
                name: 'Researcher',
                instructions: 'x',
                model: 'MODEL_DEEPSEEK_V4_FLASH',
                allowedTools: ['web_search', 'fetch_url', 'web_search'],
            })
            expect(ok.allowedTools).toEqual(['web_search', 'fetch_url'])
            expect(ok.model).toBe('MODEL_DEEPSEEK_V4_FLASH')

            await expect(
                run(db, 'create_assistant', {
                    projectId: 'p-existing',
                    name: 'Bad tools',
                    instructions: 'x',
                    allowedTools: ['send_email'],
                })
            ).rejects.toThrow('Unknown Tools Access keys: send_email')
            await expect(
                run(db, 'create_assistant', {
                    projectId: 'p-existing',
                    name: 'Bad model',
                    instructions: 'x',
                    model: 'gpt-4',
                })
            ).rejects.toThrow('model must be one of')
        })

        it('returns an existing assistant of the same name unchanged', async () => {
            const db = baseDb({
                'assistants/p-existing/items/a1': { displayName: 'Growth Lead', instructions: 'old' },
            })
            const result = await run(db, 'create_assistant', {
                projectId: 'p-existing',
                name: 'growth lead',
                instructions: 'new',
            })
            expect(result).toMatchObject({ assistantId: 'a1', alreadyExisted: true })
            expect(db.docs.get('assistants/p-existing/items/a1').instructions).toBe('old')
        })

        it("refuses another user's project", async () => {
            const db = baseDb()
            await expect(
                run(db, 'create_assistant', { projectId: 'p-other', name: 'x', instructions: 'x' })
            ).rejects.toThrow('not accessible')
        })
    })

    describe('create_assistant_task', () => {
        const withAssistant = () =>
            baseDb({ 'assistants/p-existing/items/a1': { displayName: 'Growth Lead', instructions: 'Be useful.' } })

        it('stores the schedule exactly as the app form does and activates it for the user', async () => {
            const db = withAssistant()
            const result = await run(db, 'create_assistant_task', {
                projectId: 'p-existing',
                assistantId: 'a1',
                name: 'Weekly growth review',
                prompt: 'Review the scoreboard.',
                recurrence: 'weekly',
                startDate: '2026-11-09',
                startTime: '08:00',
            })

            const task = db.docs.get(`assistantTasks/p-existing/a1/${result.taskId}`)
            expect(task).toMatchObject({
                id: result.taskId,
                name: 'Weekly growth review',
                type: 'prompt',
                prompt: 'Review the scoreboard.',
                aiSystemMessage: 'Be useful.',
                recurrence: 'weekly',
                executionMode: 'direct',
                startTime: '08:00',
                userTimezone: 1,
                creatorUserId: USER,
                activatorUserId: USER,
                activatedUserIds: [USER],
                activatedInProjectId: 'p-existing',
                recurrenceByUser: { [USER]: 'weekly' },
                sendWhatsApp: false,
                assistantId: 'a1',
                order: 0,
                lastExecuted: null,
            })
            // 08:00 in Berlin on 09.11.2026 (CET, UTC+1) is 07:00 UTC.
            expect(task.startDate).toBe(Date.UTC(2026, 10, 9, 7, 0, 0))
            expect(result.firstRun).toBe('2026-11-09 08:00 +01:00')
            expect(db.docs.get('assistants/p-existing/items/a1').lastEditorId).toBe(USER)
        })

        it('reuses a task of the same name and rejects a bad recurrence or an unknown assistant', async () => {
            const db = withAssistant()
            const args = {
                projectId: 'p-existing',
                assistantId: 'a1',
                name: 'Daily research',
                prompt: 'x',
                recurrence: 'everyWorkday',
            }
            const first = await run(db, 'create_assistant_task', args)
            const second = await run(db, 'create_assistant_task', { ...args, prompt: 'changed' })
            expect(second).toMatchObject({ taskId: first.taskId, alreadyExisted: true })

            await expect(
                run(db, 'create_assistant_task', { ...args, name: 'b', recurrence: 'hourly' })
            ).rejects.toThrow('recurrence must be one of')
            await expect(run(db, 'create_assistant_task', { ...args, name: 'c', assistantId: 'nope' })).rejects.toThrow(
                'was not found'
            )
        })
    })

    describe('buildSchedule', () => {
        it('falls back to a numeric hour offset when the user has no IANA timezone', () => {
            const schedule = buildSchedule({
                startDate: '2026-11-09',
                startTime: '09:30',
                userData: { timezone: -5 },
                now: NOW,
            })
            expect(schedule.startDate).toBe(Date.UTC(2026, 10, 9, 14, 30, 0))
            expect(schedule.userTimezone).toBe(-5)
        })

        it('defaults to today at 08:00 in the user timezone', () => {
            const schedule = buildSchedule({ userData: { preferredTimezone: 'Europe/Berlin' }, now: NOW })
            expect(schedule.firstRunLocal).toBe('2026-11-08 08:00 +01:00')
        })

        it('rejects malformed dates and times', () => {
            expect(() => buildSchedule({ startTime: '8am', userData: {}, now: NOW })).toThrow('startTime')
            expect(() => buildSchedule({ startDate: '09.11.2026', userData: {}, now: NOW })).toThrow('startDate')
        })
    })

    it('requires an authenticated user', async () => {
        await expect(executeWorkspaceSetupTool('create_project', null, { name: 'x' })).rejects.toThrow(
            'Authentication required'
        )
    })
})
