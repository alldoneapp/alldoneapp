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
