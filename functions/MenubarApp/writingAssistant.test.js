'use strict'

const { runWritingAssistant } = require('./writingAssistant')
const { writingReadTools } = require('../Assistant/assistantWritingPolicy')

function helper() {
    const mock = {
        getAssistantForChat: jest.fn(async () => ({
            uid: 'assistant',
            displayName: 'Anna',
            model: 'configured-model',
            temperature: 'configured-temperature',
            instructions: 'My writing style',
            allowedTools: ['search', 'send_email', 'execute_task_in_vm', 'update_user_description'],
        })),
        addBaseInstructions: jest.fn(async messages => messages.push(['system', 'Normal profile and project context'])),
        interactWithChatStream: jest.fn(async () => []),
        collectAssistantTextWithToolCalls: jest.fn(async options => {
            await options.onRoundComplete({ assistantText: 'Looking up context…' })
            await options.onRoundComplete({ assistantText: 'Dear Alex,\nThursday works.' })
            return {}
        }),
        executeToolNatively: jest.fn(),
        reduceGoldWhenChatWithAI: jest.fn(),
    }
    return mock
}
const request = {
    userId: 'user',
    userData: { gold: 100 },
    projectId: 'project',
    assistantId: 'assistant',
    instructions: 'Reply',
    textbox: { selectedText: 'Hi' },
    image: { mimeType: 'image/jpeg', dataBase64: 'private-image' },
}

test('uses the shared context builder, configured model and normal Gold policy, returning only the final writing turn', async () => {
    const mock = helper()
    const result = await runWritingAssistant(request, mock)
    expect(mock.addBaseInstructions).toHaveBeenCalledWith(
        expect.any(Array),
        'Anna',
        'en',
        'My writing style',
        ['search'],
        null,
        { projectId: 'project', assistantId: 'assistant', requestUserId: 'user' }
    )
    expect(mock.interactWithChatStream).toHaveBeenCalledWith(
        expect.any(Array),
        'configured-model',
        'configured-temperature',
        ['search'],
        expect.objectContaining({ writingDraft: true })
    )
    expect(result.draftText).toBe('Dear Alex,\nThursday works.')
    expect(mock.reduceGoldWhenChatWithAI).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mock.interactWithChatStream.mock.calls[0][0])).toContain(
        'data:image/jpeg;base64,private-image'
    )
})

test('empty instructions keep the screenshot, textbox and normal assistant context in the model request', async () => {
    const mock = helper()
    const result = await runWritingAssistant({ ...request, instructions: '' }, mock)
    const messages = mock.interactWithChatStream.mock.calls[0][0]
    expect(messages).toContainEqual(['system', 'Normal profile and project context'])
    const content = messages.at(-1)[1]
    expect(JSON.parse(content[0].text)).toEqual({ instructions: '', textbox: request.textbox })
    expect(content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,private-image' },
    })
    expect(mock.addBaseInstructions).toHaveBeenCalledWith(
        expect.any(Array),
        'Anna',
        'en',
        'My writing style',
        ['search'],
        null,
        { projectId: 'project', assistantId: 'assistant', requestUserId: 'user' }
    )
    expect(result.draftText).toBe('Dear Alex,\nThursday works.')
    expect(mock.reduceGoldWhenChatWithAI).toHaveBeenCalledTimes(1)
})

test('execution rejects a hallucinated mutation even if the assistant normally permits it', async () => {
    const mock = helper()
    mock.collectAssistantTextWithToolCalls.mockImplementation(async options => {
        await options.toolExecutor('send_email', { body: 'x' })
        return {}
    })
    await expect(runWritingAssistant(request, mock)).rejects.toThrow('Tool not permitted in writing mode')
    expect(mock.executeToolNatively).not.toHaveBeenCalled()
    expect(mock.reduceGoldWhenChatWithAI).not.toHaveBeenCalled()
    expect(writingReadTools(['search', 'create_task', 'tool_mcp_custom', 'load_skill'])).toEqual([
        'search',
        'load_skill',
    ])
})

test('a cancelled run cannot finish or charge Gold', async () => {
    const mock = helper()
    await expect(
        runWritingAssistant(
            {
                ...request,
                assertActive: async () => {
                    throw new Error('Cancelled')
                },
            },
            mock
        )
    ).rejects.toThrow('Cancelled')
    expect(mock.reduceGoldWhenChatWithAI).not.toHaveBeenCalled()
})
