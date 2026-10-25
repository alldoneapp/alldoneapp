const {
    resolveMcpClientLabel,
    buildMcpActorMarker,
    isMcpActor,
    getActorChannelFields,
    decorateFeedUserForRuntimeContext,
    formatActorDisplayName,
    buildLastEditorVia,
    getLastEditorChannelFields,
} = require('./mcpActor')

describe('mcpActor', () => {
    test.each([
        // The names production clients actually report in `initialize`.
        ['codex-mcp-client', 'Codex'],
        ['Anthropic/ClaudeAI', 'Claude'],
        ['claude-code', 'Claude Code'],
        ['Anthropic/Toolbox', 'Claude'],
        ['Anthropic', 'Claude'],
        ['cursor-vscode', 'Cursor'],
        ['openai-mcp', 'ChatGPT'],
    ])('labels the client %s as %s', (rawName, label) => {
        expect(resolveMcpClientLabel(rawName)).toBe(label)
    })

    test('an unknown or missing client has no label, never its raw self-description', () => {
        expect(resolveMcpClientLabel('my-own-script')).toBeNull()
        expect(resolveMcpClientLabel('')).toBeNull()
        expect(resolveMcpClientLabel(undefined)).toBeNull()
        expect(buildMcpActorMarker('Totally Legit CEO')).toEqual({ via: 'mcp' })
    })

    test('only an MCP actor adds marker fields to what it writes', () => {
        expect(getActorChannelFields({ uid: 'user-1', via: 'mcp', viaClient: 'Codex' })).toEqual({
            via: 'mcp',
            viaClient: 'Codex',
        })
        expect(getActorChannelFields({ uid: 'user-1' })).toEqual({})
        expect(getActorChannelFields(null)).toEqual({})
        expect(isMcpActor({ via: 'whatsapp' })).toBe(false)
    })

    test('decorates the feed user of an MCP tool call and nothing else', () => {
        const feedUser = { uid: 'user-1', name: 'Karsten Wysk' }
        expect(decorateFeedUserForRuntimeContext(feedUser, { sourceChannel: 'mcp', mcpClient: 'Claude' })).toEqual({
            uid: 'user-1',
            name: 'Karsten Wysk',
            via: 'mcp',
            viaClient: 'Claude',
        })
        expect(decorateFeedUserForRuntimeContext(feedUser, { sourceChannel: 'whatsapp' })).toBe(feedUser)
        expect(decorateFeedUserForRuntimeContext(feedUser, null)).toBe(feedUser)
    })

    test('formats the actor name with the client, or MCP when it is unknown', () => {
        expect(formatActorDisplayName('Karsten Wysk', { via: 'mcp', viaClient: 'Claude' })).toBe(
            'Karsten Wysk (via Claude)'
        )
        expect(formatActorDisplayName('Karsten Wysk', { via: 'mcp' })).toBe('Karsten Wysk (via MCP)')
        expect(formatActorDisplayName('Karsten Wysk', { uid: 'user-1' })).toBe('Karsten Wysk')
    })

    test('a last-editor stamp only applies to the edition it was written with', () => {
        const stamp = buildLastEditorVia({ via: 'mcp', viaClient: 'Codex' }, 1000)
        expect(stamp).toEqual({ via: 'mcp', viaClient: 'Codex', editionDate: 1000 })
        expect(buildLastEditorVia({ uid: 'user-1' }, 1000)).toBeNull()

        expect(getLastEditorChannelFields({ lastEditionDate: 1000, lastEditorVia: stamp })).toEqual({
            via: 'mcp',
            viaClient: 'Codex',
        })
        // The app edited the task afterwards without knowing about the stamp.
        expect(getLastEditorChannelFields({ lastEditionDate: 2000, lastEditorVia: stamp })).toEqual({})
        expect(getLastEditorChannelFields({ lastEditionDate: 1000, lastEditorVia: null })).toEqual({})
    })
})
