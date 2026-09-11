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
const { runLiveAssistant, isUnambiguousApproval } = require('./assistantLiveBackend')
let sessionData
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
                doc: () => ({ set: jest.fn(), update: jest.fn() }),
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
            { includeAllRecent: true }
        )
    }
)
test('never falls back to a free unpriced model', async () => {
    helper.getAssistantForChat.mockResolvedValue({ model: 'UNKNOWN' })
    await expect(runLiveAssistant(request())).rejects.toThrow('Gold rate')
    expect(helper.interactWithChatStream).not.toHaveBeenCalled()
})
test('holds sensitive actions for exact confirmation and rejects qualified approval', async () => {
    const onProgress = jest.fn()
    await runLiveAssistant(request({ onProgress }))
    const options = helper.collectAssistantTextWithToolCalls.mock.calls[0][0]
    expect(await options.toolExecutor('create_calendar_event', { title: 'Dinner' })).toMatchObject({
        status: 'confirmation_required',
    })
    expect(helper.executeToolNatively).not.toHaveBeenCalled()
    expect(onProgress).not.toHaveBeenCalled()
    expect(await options.localTools.resolve_voice_confirmation.execute({ approved: true })).toMatchObject({
        status: 'explicit_spoken_approval_required',
    })
    expect(isUnambiguousApproval('Yes, but tomorrow')).toBe(false)
    expect(isUnambiguousApproval('Ja bitte.')).toBe(true)
})

test('reports only actual tool execution and returns to reviewing without claiming success', async () => {
    const onProgress = jest.fn()
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async options => {
        await options.toolExecutor('create_task', { title: 'Private title' })
        return { finalResponseText: 'Not completed' }
    })
    helper.executeToolNatively.mockImplementationOnce(async () => {
        expect(onProgress).toHaveBeenLastCalledWith(expect.stringContaining('Creating a task'))
        return { success: false }
    })
    await runLiveAssistant(request({ onProgress }))
    expect(onProgress.mock.calls.flat().join(' ')).not.toContain('Private title')
    expect(onProgress).toHaveBeenLastCalledWith(expect.stringContaining('answer is not ready'))
})

test.each([true, false])('observes a background job only after successful dispatch: %s', async success => {
    const onBackgroundJob = jest.fn()
    sessionData.livePendingAction = { toolName: 'execute_task_in_vm', toolArgs: {}, requestedAt: Date.now() - 1000 }
    helper.collectAssistantTextWithToolCalls.mockImplementationOnce(async options => {
        await options.localTools.resolve_voice_confirmation.execute({ approved: true })
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

test('consumes exact spoken confirmation once and executes the original arguments', async () => {
    sessionData.livePendingAction = {
        toolName: 'create_calendar_event',
        toolArgs: { title: 'Dinner' },
        requestedAt: Date.now() - 1000,
    }
    await runLiveAssistant(request({ lastUserTurn: { text: 'Yes please.', createdAt: Date.now() } }))
    const options = helper.collectAssistantTextWithToolCalls.mock.calls[0][0]
    await expect(options.localTools.resolve_voice_confirmation.execute({ approved: true })).resolves.toMatchObject({
        success: true,
    })
    expect(helper.executeToolNatively).toHaveBeenCalledTimes(1)
    expect(helper.executeToolNatively.mock.calls[0].slice(0, 2)).toEqual(['create_calendar_event', { title: 'Dinner' }])
    await expect(options.localTools.resolve_voice_confirmation.execute({ approved: true })).resolves.toMatchObject({
        status: 'no_pending_action',
    })
    expect(helper.executeToolNatively).toHaveBeenCalledTimes(1)
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
