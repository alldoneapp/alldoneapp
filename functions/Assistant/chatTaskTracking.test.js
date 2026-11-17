const { isChatTaskTrackingConversation, chatTaskTrackingInstructions } = require('./chatTaskTracking')

const chat = {
    projectId: 'product',
    objectType: 'topics',
    objectId: 'cto-chat',
    requestUserId: 'karsten',
    assistantId: 'cto',
}

describe('which conversations track work as tasks (AT-3071)', () => {
    test("a member's message to a project assistant in a chat", () => {
        expect(isChatTaskTrackingConversation(chat)).toBe(true)
        expect(isChatTaskTrackingConversation({ ...chat, objectType: 'chats' })).toBe(true)
    })

    test.each([
        ['a task thread, which already is the task', { objectType: 'tasks' }],
        ['a note thread', { objectType: 'notes' }],
        ['a goal thread', { objectType: 'goals' }],
        ['a contact thread', { objectType: 'contacts' }],
        ["Anna's conversation, which has its own instructions", { annaConversation: true }],
        ["an automatic reply to another assistant's comment", { automaticCommentReply: true }],
        ['a run without a requesting user', { requestUserId: '' }],
        ['a run without an assistant', { assistantId: '' }],
        ['a run without a thread', { objectId: '' }],
    ])('not %s', (_, overrides) => {
        expect(isChatTaskTrackingConversation({ ...chat, ...overrides })).toBe(false)
    })

    test('no runtime', () => {
        expect(isChatTaskTrackingConversation(null)).toBe(false)
    })
})

describe('chat task tracking instructions', () => {
    test('ask for a tracked task for substantial work and keep quick questions in the chat', () => {
        const text = chatTaskTrackingInstructions({ allowedTools: ['create_task', 'execute_task_in_vm'] })
        expect(text).toContain('trackAssistantWork true')
        expect(text).toContain('taskOrigin user_request')
        expect(text).toContain('Quick questions')
        expect(text).toContain('workflow_managed')
        expect(text).toContain('never both')
        expect(text).toContain('target_task_id')
    })

    test('follow the tools the assistant actually has', () => {
        expect(chatTaskTrackingInstructions({ allowedTools: [] })).toBe('')
        expect(chatTaskTrackingInstructions({ allowedTools: ['get_tasks'] })).toBe('')
        const vmOnly = chatTaskTrackingInstructions({ allowedTools: ['execute_task_in_vm'] })
        expect(vmOnly).toContain('creates and tracks its own task')
        expect(vmOnly).not.toContain('call create_task')
        const tasksOnly = chatTaskTrackingInstructions({ allowedTools: ['create_task'] })
        expect(tasksOnly).toContain('call create_task')
        expect(tasksOnly).not.toContain('execute_task_in_vm called')
    })
})

// assistantNormalTalk_optimized.js has no unit suite (see threadAssistantModelCallSites.test.js); this
// pins the wiring, whose loss would silently put chat work back into the chat.
describe('the interactive chat path wires chat task tracking', () => {
    const source = require('fs').readFileSync(
        require('path').join(__dirname, 'assistantNormalTalk_optimized.js'),
        'utf8'
    )

    test('flags the tool runtime for a tracked chat after the Anna check and adds the instruction', () => {
        const annaCheck = source.indexOf('baseToolRuntimeContext.annaConversation = true')
        const flag = source.indexOf(
            'if (isChatTaskTrackingConversation(baseToolRuntimeContext)) baseToolRuntimeContext.chatTaskTracking = true'
        )
        expect(annaCheck).toBeGreaterThan(-1)
        expect(flag).toBeGreaterThan(annaCheck)
        expect(source).toContain('chatTaskTrackingInstructions({ allowedTools })')
        expect(source).toMatch(/messages\.push\(\['system', chatTaskTrackingText\]\)/)
    })
})
