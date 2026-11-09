const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { ASSISTANT_TASK_MCP_SCHEMAS, ASSISTANT_TASK_TOOL_NAMES } = require('./assistantTaskTools')
const {
    WORKSPACE_SETUP_TOOL_NAMES,
    WORKSPACE_TOOL_ASSISTANT_SCHEMAS,
    executeWorkspaceToolForAssistant,
} = require('./workspaceToolsForAssistants')
const { getToolSchemas } = require('./toolSchemas')
const { MCP_WORKSPACE_SETUP_TOOL_SCHEMAS } = require('../MCP/mcpWorkspaceSetupTools')

const P = 'p1'
const USER = 'karsten'
const ASSISTANT = 'growth-lead'
const NOW = Date.UTC(2026, 10, 9, 9, 0, 0)

const seeded = () =>
    createFakeFirestore({
        [`users/${USER}`]: { projectIds: [P], preferredTimezone: 'Europe/Berlin' },
        [`projects/${P}`]: { name: 'Alldone Growth', userIds: [USER] },
        [`assistants/${P}/items/${ASSISTANT}`]: { displayName: 'Growth Lead', instructions: 'Grow.' },
        [`goals/${P}/items/g2`]: { extendedName: 'Growth Loop: profitable customers', isPublicFor: [0] },
        [`assistantTasks/${P}/${ASSISTANT}/t1`]: {
            id: 't1',
            name: 'Daily growth discovery',
            type: 'prompt',
            prompt: 'Find prospects.',
            recurrence: 'everyWorkday',
            startDate: Date.UTC(2026, 10, 9, 6, 30, 0),
            startTime: '07:30',
            activatedUserIds: [USER],
            recurrenceByUser: { [USER]: 'everyWorkday' },
            parentGoalId: 'g1',
            order: 0,
        },
    })

describe('MCP workspace tools for assistants: one definition, one handler', () => {
    test('assistants get the MCP schemas, with project and assistant defaulting to themselves', () => {
        expect(MCP_WORKSPACE_SETUP_TOOL_SCHEMAS.filter(s => ASSISTANT_TASK_TOOL_NAMES.includes(s.name))).toEqual(
            ASSISTANT_TASK_MCP_SCHEMAS
        )
        for (const mcpSchema of ASSISTANT_TASK_MCP_SCHEMAS) {
            const { function: fn } = WORKSPACE_TOOL_ASSISTANT_SCHEMAS[mcpSchema.name]
            expect(fn.description.startsWith(mcpSchema.description)).toBe(true)
            expect(fn.description).toMatch(/only when the user clearly asked/)
            expect(Object.keys(fn.parameters.properties)).toEqual(Object.keys(mcpSchema.inputSchema.properties))
            expect(mcpSchema.inputSchema.required).toEqual(expect.arrayContaining(['projectId', 'assistantId']))
            expect(fn.parameters.required).not.toContain('projectId')
            expect(fn.parameters.required).not.toContain('assistantId')
        }
    })

    test('one Tools Access key, assistant_tasks, gives an assistant all three tools', () => {
        const names = getToolSchemas(['assistant_tasks']).map(schema => schema.function.name)
        expect(names.sort()).toEqual([...ASSISTANT_TASK_TOOL_NAMES].sort())
        expect(getToolSchemas(['get_tasks']).map(schema => schema.function.name)).toEqual(['get_tasks'])
    })

    test("an assistant changes its own task's goal through the MCP handler, marked as the assistant", async () => {
        const db = seeded()
        const result = await executeWorkspaceToolForAssistant({
            toolName: 'update_assistant_task',
            args: { taskName: 'Daily growth discovery', parentGoalId: 'g2' },
            projectId: P,
            assistantId: ASSISTANT,
            requestUserId: USER,
            deps: { db, now: () => NOW },
        })
        expect(result.changed).toEqual(['goal'])
        expect(result.task.goal).toEqual({ goalId: 'g2', name: 'Growth Loop: profitable customers' })
        const stored = db.docs.get(`assistantTasks/${P}/${ASSISTANT}/t1`)
        expect(stored.parentGoalId).toBe('g2')
        expect(stored.lastEditedVia).toEqual({ via: 'assistant', assistantId: ASSISTANT })
        expect(stored.lastEditorId).toBe(USER)
    })

    test('lists its own tasks by default and refuses to run without a requesting user', async () => {
        const db = seeded()
        const listed = await executeWorkspaceToolForAssistant({
            toolName: 'get_assistant_tasks',
            projectId: P,
            assistantId: ASSISTANT,
            requestUserId: USER,
            deps: { db, now: () => NOW },
        })
        expect(listed.tasks.map(task => task.name)).toEqual(['Daily growth discovery'])
        await expect(
            executeWorkspaceToolForAssistant({ toolName: 'get_assistant_tasks', projectId: P, assistantId: ASSISTANT })
        ).rejects.toThrow(/signed-in user/)
    })

    test('workspace_setup gives an assistant create_project, add_contact_statuses and create_assistant', () => {
        const names = getToolSchemas(['workspace_setup']).map(schema => schema.function.name)
        expect(names.sort()).toEqual([...WORKSPACE_SETUP_TOOL_NAMES].sort())
        // An assistant never sets Tools Access, so it is not even offered the parameter.
        const createAssistant = WORKSPACE_TOOL_ASSISTANT_SCHEMAS.create_assistant.function
        expect(createAssistant.parameters.properties).not.toHaveProperty('allowedTools')
        expect(createAssistant.parameters.required).toEqual(['name', 'instructions'])
        expect(createAssistant.description).toMatch(/only the user can change it/)
    })

    test('an assistant creates a helper assistant in its own project, with default tools only', async () => {
        const db = seeded()
        const created = await executeWorkspaceToolForAssistant({
            toolName: 'create_assistant',
            args: { name: 'Research Helper', instructions: 'Research prospects.' },
            projectId: P,
            assistantId: ASSISTANT,
            requestUserId: USER,
            deps: { db, now: () => NOW },
        })
        expect(created).toMatchObject({ projectId: P, name: 'Research Helper', alreadyExisted: false })
        const stored = db.docs.get(`assistants/${P}/items/${created.assistantId}`)
        expect(stored.displayName).toBe('Research Helper')

        await expect(
            executeWorkspaceToolForAssistant({
                toolName: 'create_assistant',
                args: { name: 'Powerful Helper', instructions: 'x', allowedTools: ['execute_task_in_vm'] },
                projectId: P,
                assistantId: ASSISTANT,
                requestUserId: USER,
                deps: { db, now: () => NOW },
            })
        ).rejects.toThrow(/cannot change Tools Access/)
        await expect(
            executeWorkspaceToolForAssistant({
                toolName: 'update_assistant',
                args: { projectId: P, assistantId: ASSISTANT, addTools: ['execute_task_in_vm'] },
                projectId: P,
                assistantId: ASSISTANT,
                requestUserId: USER,
                deps: { db, now: () => NOW },
            })
        ).rejects.toThrow(/Unknown workspace tool/)
    })

    test('an assistant adds contact statuses to its own project', async () => {
        const db = seeded()
        const result = await executeWorkspaceToolForAssistant({
            toolName: 'add_contact_statuses',
            args: { statuses: [{ name: 'new idea/potential' }, { name: 'reached out' }] },
            projectId: P,
            assistantId: ASSISTANT,
            requestUserId: USER,
            deps: { db, now: () => NOW },
        })
        expect(result.projectId).toBe(P)
        expect(Object.values(db.docs.get(`projects/${P}`).contactStatuses || {}).map(status => status.name)).toEqual(
            expect.arrayContaining(['new idea/potential', 'reached out'])
        )
    })
})
