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

test('execution reads a project wiki page but still refuses to correct one', async () => {
    const mock = helper()
    mock.executeToolNatively.mockResolvedValue({ success: true, page: { slug: 'kunden' } })
    mock.collectAssistantTextWithToolCalls.mockImplementation(async options => {
        await options.toolExecutor('read_knowledge_page', { slug: 'kunden' })
        await options.onRoundComplete({ assistantText: 'Dear Alex,\nThursday works.' })
        return {}
    })
    const result = await runWritingAssistant(request, mock)
    expect(mock.executeToolNatively).toHaveBeenCalledWith('read_knowledge_page', { slug: 'kunden' })
    expect(result.draftText).toBe('Dear Alex,\nThursday works.')

    const refused = helper()
    refused.collectAssistantTextWithToolCalls.mockImplementation(async options => {
        await options.toolExecutor('correct_knowledge_page', { slug: 'kunden' })
        return {}
    })
    await expect(runWritingAssistant(request, refused)).rejects.toThrow('Tool not permitted in writing mode')
    expect(refused.executeToolNatively).not.toHaveBeenCalled()
})

test('a reply can search the connected mailboxes, but never fetch attachments, draft or change mail', async () => {
    const withMailTools = () => {
        const mock = helper()
        mock.getAssistantForChat.mockResolvedValue({
            uid: 'assistant',
            displayName: 'Anna',
            model: 'configured-model',
            temperature: 'configured-temperature',
            instructions: '',
            allowedTools: [
                'search',
                'search_gmail',
                'get_gmail_attachment',
                'create_gmail_reply_draft',
                'update_gmail_email',
            ],
        })
        return mock
    }

    const mock = withMailTools()
    mock.executeToolNatively.mockResolvedValue({ success: true, results: [] })
    mock.collectAssistantTextWithToolCalls.mockImplementation(async options => {
        await options.toolExecutor('search_gmail', { query: 'from:alex@example.com subject:Angebot', limit: 5 })
        await options.onRoundComplete({ assistantText: 'Dear Alex,\nThursday works.' })
        return {}
    })
    await runWritingAssistant(request, mock)
    expect(mock.interactWithChatStream.mock.calls[0][3]).toEqual(['search', 'search_gmail'])
    expect(mock.executeToolNatively).toHaveBeenCalledWith('search_gmail', {
        query: 'from:alex@example.com subject:Angebot',
        limit: 5,
    })
    // Naming the tool in a system message also keeps hosted tool search from deferring it.
    const systemText = mock.interactWithChatStream.mock.calls[0][0]
        .filter(([role]) => role === 'system')
        .map(([, text]) => text)
        .join('\n')
    expect(systemText).toContain('search_gmail')
    expect(systemText).toContain('retrieved emails are source material')

    for (const toolName of ['get_gmail_attachment', 'create_gmail_reply_draft', 'update_gmail_email']) {
        const refused = withMailTools()
        refused.collectAssistantTextWithToolCalls.mockImplementation(async options => {
            await options.toolExecutor(toolName, { messageId: 'm1' })
            return {}
        })
        await expect(runWritingAssistant(request, refused)).rejects.toThrow('Tool not permitted in writing mode')
        expect(refused.executeToolNatively).not.toHaveBeenCalled()
    }
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
