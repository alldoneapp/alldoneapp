jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('../Assistant/assistantHelper', () => ({
    getAssistantForChat: jest.fn(),
    normalizeModelKey: key => key || 'MODEL_GPT5_6_SOL',
    getTokensPerGold: key => ({ MODEL_GPT5_6_SOL: 100, MODEL_GPT5_6_TERRA: 200, MODEL_DEEPSEEK_V4_FLASH: 2000 })[key],
    getOptimizedContextMessages: jest.fn(async () => [['user', 'Find my tasks']]),
    filterAllowedToolsForRuntimeContext: tools => tools,
    interactWithChatStream: jest.fn(async () => 'stream'),
    collectAssistantTextWithToolCalls: jest.fn(),
    executeToolNatively: jest.fn(async () => ({ success: true })),
    isToolAllowedForExecution: jest.fn(async () => true),
    calculateTokens: jest.fn(() => 4000),
    buildConversationSafeToolArgs: (name, args) => args,
    buildConversationSafeToolResult: (name, result) => result,
}))
jest.mock('./assistantLiveGold', () => ({ reconcileLiveUsage: jest.fn(async () => ({ currentGold: 99 })) }))
jest.mock('./assistantLiveNoteTarget', () => ({
    ...jest.requireActual('./assistantLiveNoteTarget'),
    resolveCallContactNote: jest.fn(async () => null),
}))
const { resolveCallContactNote } = require('./assistantLiveNoteTarget')
const admin = require('firebase-admin')
const helper = require('../Assistant/assistantHelper')
const { reconcileLiveUsage } = require('./assistantLiveGold')
const { runLiveAssistant } = require('./assistantLiveBackend')
let sessionData
let savedOperations
let savedBackendAnswers
const session = { id: 's', userId: 'u', projectId: 'p', assistantId: 'a', chatId: 'c' }
const request = overrides => ({
    session,
    delegationId: 'd',
    assertActive: jest.fn(async () => {}),
    lastUserTurn: { text: 'Find tasks', createdAt: Date.now() },
    requestEnd: jest.fn(),
    ...overrides,
})
beforeEach(() => {
    jest.clearAllMocks()
    resolveCallContactNote.mockResolvedValue(null)
    helper.executeToolNatively.mockResolvedValue({ success: true })
    sessionData = {}
    savedOperations = []
    savedBackendAnswers = []
    admin.firestore.mockReturnValue({
        doc: path => ({
            get: async () => ({
                exists: true,
                data: () => (path === 'users/u' ? { gold: 100, language: 'English' } : sessionData),
            }),
            update: async data => Object.assign(sessionData, data),
            collection: name => ({
                orderBy: () => ({
                    limit: () => ({
                        get: async () => ({
                            empty: name !== 'liveDelegations' || !savedBackendAnswers.length,
                            docs:
                                name === 'liveDelegations'
                                    ? savedBackendAnswers.map(data => ({ data: () => data }))
                                    : [],
                        }),
                    }),
                }),
                doc: () => {
                    const operation = {}
                    savedOperations.push(operation)
                    return {
                        set: async value => Object.assign(operation, value),
                        update: async value => Object.assign(operation, value),
                    }
                },
            }),
        }),
    })
    helper.getAssistantForChat.mockResolvedValue({
        model: 'MODEL_GPT5_6_SOL',
        temperature: 'TEMPERATURE_BALANCED',
        reasoningEffort: 'high',
        allowedTools: ['create_task', 'create_calendar_event'],
    })
    helper.collectAssistantTextWithToolCalls.mockImplementation(async options => {
        await options.onRoundComplete({ assistantText: 'Done', conversation: [], round: 0 })
        return { finalResponseText: 'Done' }
    })
})

test('uses contact.noteId instead of the contact ID and persists the exact resolution', async () => {
    const target = { projectId: 'other-project', contactId: 'contact-1', noteId: 'note-1' }
    resolveCallContactNote.mockResolvedValue(target)
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async ({ toolExecutor }) => {
        await toolExecutor('get_notes', { noteId: 'contact-1', projectId: 'other-project' })
        return { finalResponseText: 'Verified note content' }
    })
    await runLiveAssistant(
        request({ session: { ...session, pageContext: { path: '/projects/other-project/contacts/contact-1/note' } } })
    )
    expect(helper.executeToolNatively).toHaveBeenCalledWith(
        'get_notes',
        { noteId: 'note-1', projectId: 'other-project' },
        'p',
        'a',
        'u',
        null,
        expect.any(Object)
    )
    expect(savedOperations[0]).toMatchObject({
        targetResolution: 'contact.noteId',
        arguments: JSON.stringify({ noteId: 'note-1', projectId: 'other-project' }),
        requestedArguments: JSON.stringify({ noteId: 'contact-1', projectId: 'other-project' }),
    })
    expect(helper.interactWithChatStream.mock.calls[0][0]).toContainEqual([
        'system',
        expect.stringContaining(JSON.stringify(target)),
    ])
})

test.each([
    { noteId: 'explicit-other-note', projectId: 'other-project' },
    { noteId: 'contact-1', projectId: 'different-project' },
])('does not overwrite another explicit note target: %j', async args => {
    resolveCallContactNote.mockResolvedValue({ projectId: 'other-project', contactId: 'contact-1', noteId: 'note-1' })
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async ({ toolExecutor }) => {
        await toolExecutor('get_notes', args)
        return { finalResponseText: 'Done' }
    })
    await runLiveAssistant(
        request({ session: { ...session, pageContext: { path: '/projects/other-project/contacts/contact-1/note' } } })
    )
    expect(helper.executeToolNatively.mock.calls[0][1]).toEqual(args)
})

test('returns a failed read to the model so it can correct the ID in the same delegation', async () => {
    helper.executeToolNatively
        .mockRejectedValueOnce(new Error('Note not found (exact ID and case-insensitive fallback checked)'))
        .mockResolvedValueOnce({ success: true, note: { id: 'verified-note', content: 'Actual note text' } })
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async ({ toolExecutor }) => {
        const failed = await toolExecutor('get_notes', { projectId: 'p', noteId: 'wrong-id' })
        expect(failed).toMatchObject({
            success: false,
            retryAllowed: true,
            error: expect.stringContaining('Note not found'),
        })
        const corrected = await toolExecutor('get_notes', { projectId: 'p', noteId: 'verified-note' })
        return { finalResponseText: corrected.note.content }
    })
    await expect(runLiveAssistant(request())).resolves.toBe('Actual note text')
    expect(savedOperations[0]).toMatchObject({
        status: 'completed',
        outcome: { status: 'failed', cause: expect.stringContaining('Note not found') },
    })
    expect(savedOperations[1].outcome.status).toBe('result_received')
})

test('caps unchanged failed reads at two executions while permitting corrected arguments', async () => {
    helper.executeToolNatively.mockRejectedValue(new Error('Note not found'))
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async ({ toolExecutor }) => {
        for (let i = 0; i < 4; i++) {
            const result = await toolExecutor('get_notes', { projectId: 'p', noteId: 'wrong-id' })
            expect(result.retryAllowed).toBe(i === 0)
        }
        helper.executeToolNatively.mockResolvedValueOnce({ success: true })
        await toolExecutor('get_notes', { projectId: 'p', noteId: 'correct-id' })
        return { finalResponseText: 'Done' }
    })
    await runLiveAssistant(request())
    expect(helper.executeToolNatively).toHaveBeenCalledTimes(3)
})

test('parallel duplicates cannot exceed the retry budget for the same failed read', async () => {
    helper.executeToolNatively.mockRejectedValue(new Error('Note not found'))
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async ({ toolExecutor }) => {
        const results = await Promise.all(
            Array.from({ length: 5 }, () => toolExecutor('get_notes', { projectId: 'p', noteId: 'wrong-id' }))
        )
        expect(results.map(result => result.retryAllowed)).toEqual([true, false, false, false, false])
        return { finalResponseText: 'The note was not found' }
    })
    await runLiveAssistant(request())
    expect(helper.executeToolNatively).toHaveBeenCalledTimes(2)
})

test.each(['voice_request_superseded', 'insufficient_gold'])(
    'does not recover from a run control signal: %s',
    async message => {
        helper.executeToolNatively.mockRejectedValueOnce(new Error(message))
        helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async ({ toolExecutor }) => {
            await toolExecutor('get_notes', { projectId: 'p', noteId: 'n' })
            return { finalResponseText: 'Unreachable' }
        })
        await expect(runLiveAssistant(request())).rejects.toThrow(message)
    }
)

test('rechecks access to the linked note immediately before execution', async () => {
    resolveCallContactNote
        .mockResolvedValueOnce({ projectId: 'p', contactId: 'contact-1', noteId: 'note-1' })
        .mockRejectedValueOnce(new Error('User does not have access to this note'))
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async ({ toolExecutor }) => {
        const result = await toolExecutor('get_notes', { projectId: 'p', noteId: 'contact-1' })
        expect(result).toMatchObject({ success: false, error: 'User does not have access to this note' })
        return { finalResponseText: 'Cannot access the note' }
    })
    await runLiveAssistant(
        request({ session: { ...session, pageContext: { path: '/projects/p/contacts/contact-1/note' } } })
    )
    expect(helper.executeToolNatively).not.toHaveBeenCalled()
})

test('clears a failed contact-note read when the retry uses its canonical note ID', async () => {
    resolveCallContactNote.mockResolvedValue({ projectId: 'p', contactId: 'contact-1', noteId: 'note-1' })
    helper.executeToolNatively
        .mockRejectedValueOnce(new Error('Storage temporarily unavailable'))
        .mockResolvedValueOnce({ success: true, note: { id: 'note-1', content: 'Loaded' } })
    const onProgress = jest.fn()
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async ({ toolExecutor }) => {
        await toolExecutor('get_notes', { projectId: 'p', noteId: 'contact-1' })
        await toolExecutor('get_notes', { projectId: 'p', noteId: 'note-1' })
        return { finalResponseText: 'Loaded' }
    })
    await runLiveAssistant(
        request({ onProgress, session: { ...session, pageContext: { path: '/projects/p/contacts/contact-1/note' } } })
    )
    expect(onProgress.mock.calls.at(-1)[0]).toMatchObject({ status: 'result_received', cause: null })
})

test('one failed read does not discard the other four concurrent lookup results', async () => {
    const { executeToolCallBatch } = require('../Assistant/toolCallBatch')
    const complete = []
    helper.executeToolNatively.mockImplementation(
        (name, args) =>
            new Promise((resolve, reject) => {
                complete.push(() =>
                    args.noteId === 'n0'
                        ? reject(new Error('Note not found'))
                        : resolve({ success: true, note: { id: args.noteId } })
                )
            })
    )
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async ({ toolExecutor }) => {
        const calls = Array.from({ length: 5 }, (_, i) => ({
            function: { name: 'get_notes', arguments: { projectId: 'p', noteId: `n${i}` } },
        }))
        const batch = executeToolCallBatch(calls, call => toolExecutor(call.function.name, call.function.arguments))
        for (let i = 0; i < 40; i++) await Promise.resolve()
        expect(complete).toHaveLength(5)
        complete.forEach(finish => finish())
        const results = await batch
        expect(results[0]).toMatchObject({ success: false, error: 'Note not found' })
        expect(results.slice(1).map(result => result.note.id)).toEqual(['n1', 'n2', 'n3', 'n4'])
        return { finalResponseText: 'Four notes loaded; one lookup needs correction' }
    })
    await expect(runLiveAssistant(request())).resolves.toContain('Four notes loaded')
    expect(savedOperations).toHaveLength(5)
})
test.each(['MODEL_GPT5_6_SOL', 'MODEL_GPT5_6_TERRA', 'MODEL_DEEPSEEK_V4_FLASH'])(
    'uses configured %s for routing and billing',
    async model => {
        helper.getAssistantForChat.mockResolvedValue({
            model,
            temperature: 'TEMP',
            allowedTools: [],
            reasoningEffort: 'high',
        })
        await expect(runLiveAssistant(request())).resolves.toBe('Done')
        expect(helper.interactWithChatStream).toHaveBeenCalledWith(
            expect.any(Array),
            model,
            'TEMP',
            [],
            expect.objectContaining({ openAiReasoningEffort: 'high' })
        )
        expect(reconcileLiveUsage).toHaveBeenCalledWith(
            expect.objectContaining({
                backend: expect.objectContaining({ model, tokensPerGold: helper.getTokensPerGold(model) }),
            })
        )
        expect(helper.getOptimizedContextMessages).toHaveBeenCalledWith(
            null,
            'p',
            'topics',
            'c',
            'English',
            undefined,
            undefined,
            [],
            null,
            'u',
            'a',
            { includeAllRecent: true, excludeCallSessionId: 's' }
        )
    }
)
test('never falls back to a free unpriced model', async () => {
    helper.getAssistantForChat.mockResolvedValue({ model: 'UNKNOWN' })
    await expect(runLiveAssistant(request())).rejects.toThrow('Gold rate')
    expect(helper.interactWithChatStream).not.toHaveBeenCalled()
})
test('executes both requested calendar entries without a voice-only confirmation, using corrected arguments', async () => {
    sessionData.livePendingAction = {
        toolName: 'create_calendar_event',
        toolArgs: { title: 'Old all-day draft' },
        requestedAt: 1,
    }
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async options => {
        expect(options.localTools.resolve_voice_confirmation).toBeUndefined()
        for (const args of [
            { summary: 'Riesendrachen', start: '2026-09-12T11:00:00+02:00' },
            { summary: 'Mitmachfest', start: '2026-09-13T12:00:00+02:00' },
        ])
            await options.toolExecutor('create_calendar_event', args)
        return { finalResponseText: 'Both entries created' }
    })
    await runLiveAssistant(request())
    expect(helper.executeToolNatively.mock.calls.map(call => call.slice(0, 2))).toEqual([
        ['create_calendar_event', { summary: 'Riesendrachen', start: '2026-09-12T11:00:00+02:00' }],
        ['create_calendar_event', { summary: 'Mitmachfest', start: '2026-09-13T12:00:00+02:00' }],
    ])
    const messages = helper.interactWithChatStream.mock.calls[0][0]
    expect(messages.map(message => message[1]).join('\n')).toContain('Do not add a separate voice confirmation')
    expect(messages.map(message => message[1]).join('\n')).toContain('look them up before booking')
})

test('answers the current live request even when saved chat history still ends at the audio check', async () => {
    helper.getOptimizedContextMessages.mockResolvedValueOnce([['system', 'Configured assistant context']])
    const onProgress = jest.fn()
    const liveConversation = [
        { role: 'assistant', text: 'Hello, how can I help?' },
        { role: 'user', text: 'Hallo, hörst du mich?' },
        { role: 'assistant', text: 'Ja, ich höre dich klar und deutlich.' },
        { role: 'user', text: 'Okay, was ist denn am Sonntag?' },
        { role: 'assistant', text: 'Einen Moment, ich schau kurz nach.' },
    ]
    await runLiveAssistant(request({ liveConversation, lastUserTurn: { text: liveConversation[3].text }, onProgress }))
    const messages = helper.interactWithChatStream.mock.calls[0][0]
    expect(messages.slice(-4)).toEqual(liveConversation.slice(0, 4).map(turn => [turn.role, turn.text]))
    expect(messages.at(-1)).toEqual(['user', 'Okay, was ist denn am Sonntag?'])
    expect(messages.filter(([role]) => role === 'assistant').map(([, text]) => text)).not.toContain(
        liveConversation[4].text
    )
    expect(messages.some(([role, text]) => role === 'system' && text.includes(liveConversation[4].text))).toBe(true)
    expect(onProgress).not.toHaveBeenCalled()
})

test('keeps the outstanding request when the caller asks why the assistant asked twice', async () => {
    const liveConversation = [
        { role: 'user', text: 'Was ist denn am Sonntag?' },
        { role: 'assistant', text: 'Was möchtest du erledigen?' },
        { role: 'user', text: 'Du machst doch gerade was für mich. Warum fragst du zweimal nach?' },
    ]
    await runLiveAssistant(request({ liveConversation }))
    const messages = helper.interactWithChatStream.mock.calls[0][0]
    expect(messages.slice(-3)).toEqual(liveConversation.map(turn => [turn.role, turn.text]))
})

test('reports the actual calendar error with its subject instead of overwriting it with generic reviewing', async () => {
    const onProgress = jest.fn()
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async options => {
        await options.toolExecutor('create_calendar_event', { summary: 'Riesendrachen' })
        return { finalResponseText: 'Could not create the event' }
    })
    helper.executeToolNatively.mockResolvedValueOnce({ success: false, error: 'Calendar write permission missing' })
    await runLiveAssistant(request({ onProgress }))
    expect(onProgress).toHaveBeenLastCalledWith(
        expect.objectContaining({
            content: expect.stringContaining('Calendar write permission missing'),
            urgent: true,
            status: 'failed',
            cause: 'Calendar write permission missing',
        })
    )
    expect(onProgress.mock.calls.at(-1)[0].content).toContain('Riesendrachen')
})

test('keeps existing tool permissions authoritative even without the extra voice confirmation', async () => {
    helper.isToolAllowedForExecution.mockResolvedValueOnce(false)
    await runLiveAssistant(request())
    const options = helper.collectAssistantTextWithToolCalls.mock.calls[0][0]
    await expect(options.toolExecutor('create_calendar_event', {})).rejects.toThrow('Tool no longer permitted')
    expect(helper.executeToolNatively).not.toHaveBeenCalled()
})

test.each([true, false])('observes a background job only after successful dispatch: %s', async success => {
    const onBackgroundJob = jest.fn()
    sessionData.livePendingAction = { toolName: 'execute_task_in_vm', toolArgs: {}, requestedAt: Date.now() - 1000 }
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async options => {
        await options.toolExecutor('execute_task_in_vm', {})
        return { finalResponseText: 'Dispatch result' }
    })
    helper.executeToolNatively.mockResolvedValueOnce({ success, correlationId: 'job-1', status: 'started' })
    await runLiveAssistant(request({ onBackgroundJob, lastUserTurn: { text: 'Yes', createdAt: Date.now() } }))
    expect(onBackgroundJob.mock.calls).toEqual(success ? [['job-1']] : [])
})
test('checks for newer speech immediately before any tool execution', async () => {
    const assertActive = jest.fn(async () => {})
    await runLiveAssistant(request({ assertActive }))
    assertActive.mockRejectedValue(new Error('voice_request_superseded'))
    const options = helper.collectAssistantTextWithToolCalls.mock.calls[0][0]
    await expect(options.toolExecutor('create_task', {})).rejects.toThrow('voice_request_superseded')
    expect(helper.executeToolNatively).not.toHaveBeenCalled()
})

test('delivers the fully paid final answer when its charge exhausts Gold', async () => {
    reconcileLiveUsage.mockResolvedValueOnce({ currentGold: 0, insufficientBalance: false })
    await expect(runLiveAssistant(request())).resolves.toBe('Done')
})

test('gives a follow-up request the saved answer and delivery state without assuming it was spoken', async () => {
    savedBackendAnswers = [
        { status: 'completed', result: 'The existing verified answer.', deliveryStatus: 'context_sent' },
    ]
    await runLiveAssistant(request({ lastUserTurn: { text: 'Are you still there?', createdAt: Date.now() } }))
    const messages = helper.interactWithChatStream.mock.calls[0][0]
    const savedContext = messages.find(message => message[1].startsWith('Saved backend answers'))[1]
    expect(savedContext).toContain('The existing verified answer.')
    expect(savedContext).toContain('context_sent')
    expect(savedContext).toContain('does not mean it was spoken')
    expect(helper.executeToolNatively).not.toHaveBeenCalled()
})

test('gives the configured backend the current page as reference while retaining the original call thread', async () => {
    const path = '/projects/another-project/notes/visible-note/editor'
    await runLiveAssistant(
        request({
            session: { ...session, pageContext: { path, title: 'Visible note' } },
            liveConversation: [{ role: 'user', text: 'Summarize this note' }],
        })
    )
    const [messages, , , , runtime] = helper.interactWithChatStream.mock.calls[0]
    expect(messages).toContainEqual(['system', expect.stringContaining(path)])
    expect(messages).toContainEqual(['system', expect.stringContaining('Navigation alone does not request any action')])
    expect(messages.at(-1)).toEqual(['user', 'Summarize this note'])
    expect(runtime).toMatchObject({ projectId: 'p', objectType: 'topics', objectId: 'c', requestUserId: 'u' })
})

test.each([
    [{ success: true, results: [], message: 'A page about errors' }, 'result_received', null],
    [{ success: false, error: 'Calendar write permission missing' }, 'failed', 'Calendar write permission missing'],
    [{ success: false }, 'outcome_unconfirmed', null],
])('persists the actual tool outcome separately from execution completion: %j', async (nativeResult, status, cause) => {
    helper.executeToolNatively.mockResolvedValueOnce(nativeResult)
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async options => {
        await options.toolExecutor('web_search', { query: 'Sunday' })
        expect(savedOperations[0]).toMatchObject({ status: 'completed', outcome: { status, cause } })
        return { finalResponseText: 'Verified result' }
    })
    await runLiveAssistant(request())
})

test('persists a thrown cause and instructs the backend not to turn spoken error claims into a diagnosis', async () => {
    helper.executeToolNatively.mockRejectedValueOnce(new Error('Calendar write permission missing'))
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async options => {
        await options.toolExecutor('create_calendar_event', { summary: 'Sunday' })
        return { finalResponseText: 'Unreachable' }
    })
    const liveConversation = [
        { role: 'user', text: 'What error?' },
        { role: 'assistant', text: 'An error came in' },
    ]
    await expect(runLiveAssistant(request({ liveConversation }))).rejects.toThrow('Calendar write permission missing')
    expect(savedOperations[0]).toMatchObject({
        status: 'outcome_unconfirmed',
        outcome: { status: 'failed', cause: 'Calendar write permission missing' },
    })
    const messages = helper.interactWithChatStream.mock.calls[0][0]
    expect(messages).toContainEqual(['system', expect.stringContaining('both a failure status and a specific cause')])
    expect(messages).toContainEqual([
        'system',
        expect.stringContaining('never invent an explanation such as a display bug'),
    ])
})
