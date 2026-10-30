const fs = require('fs')
const path = require('path')
const {
    WORKSPACE_CHANGE_TOOLS,
    isWorkspaceChangeTool,
    isChangingWorkspace,
} = require('./assistantWorkspaceChangeTools')

const call = name => ({ function: { name } })

describe('workspace-changing assistant tools (AT-2926)', () => {
    it('counts tools that create or change Alldone objects', () => {
        for (const name of ['create_task', 'update_task', 'create_note', 'update_note', 'update_contact']) {
            expect(isWorkspaceChangeTool(name)).toBe(true)
        }
    })

    it('leaves reads, external services, settings, delegation and unknown tools out', () => {
        for (const name of [
            'get_tasks',
            'search',
            'web_search',
            'fetch_url',
            'search_gmail',
            'create_calendar_event',
            'create_gmail_draft',
            'update_user_memory',
            'update_assistant_settings',
            'execute_task_in_vm',
            'talk_to_assistant_cto',
            'mcp_unknown',
            '',
            undefined,
        ]) {
            expect(isWorkspaceChangeTool(name)).toBe(false)
        }
    })

    it('looks only at the calls that are executing right now', () => {
        const calls = [call('get_tasks'), call('create_task'), call('web_search')]
        expect(isChangingWorkspace(calls, [0])).toBe(false)
        expect(isChangingWorkspace(calls, [1])).toBe(true)
        expect(isChangingWorkspace(calls, [0, 1, 2])).toBe(true)
        expect(isChangingWorkspace(calls, [])).toBe(false)
        expect(isChangingWorkspace(calls, undefined)).toBe(false)
        expect(isChangingWorkspace(undefined, [0])).toBe(false)
    })

    it('names only tools the assistant actually serves', () => {
        const sources = [
            '../Assistant/toolSchemas.js',
            '../Artifacts/artifactToolSchemas.js',
            '../KnowledgeBase/knowledgeBaseToolSchemas.js',
        ]
            .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8'))
            .join('\n')
        for (const name of WORKSPACE_CHANGE_TOOLS) {
            expect(sources).toContain(`'${name}'`)
        }
    })
})
