const {
    MCP_DIRECT_TOOL_LIMIT,
    OPEN_MCP_APP_TOOL_NAME,
    readMcpToolApp,
    getMcpAppKey,
    describeMcpApps,
    selectMcpToolSchemas,
    openMcpApp,
} = require('./mcpAppGroups')

// Targets as getReachableMcpTools builds them: alldone.team names each tool's app, another server does not.
const target = (serverId, serverLabel, name, app = null) => ({
    toolName: `mcp_${serverId}_${name}`,
    serverId,
    serverLabel,
    appKey: getMcpAppKey(serverId, app),
    appName: app ? app.name : null,
    appSummary: app ? app.summary : null,
})
const JUDY = { id: 'judy', name: 'Judy Job', summary: 'Job search and applications.' }
const STORY = { id: 'story', name: 'Story Builder', summary: 'Stories and narrated videos.' }
const targets = [
    ...Array.from({ length: 50 }, (_, i) => target('team', 'alldone.team', `judy_${i}`, JUDY)),
    ...Array.from({ length: 66 }, (_, i) => target('team', 'alldone.team', `story_${i}`, STORY)),
    target('pubmed', 'PubMed', 'search'),
]
const schemaOf = item => ({ type: 'function', function: { name: item.toolName, parameters: { type: 'object' } } })
const schemas = targets.map(schemaOf)

describe('reading the app a server names for a tool', () => {
    test('takes id, name and summary from _meta, bounded', () => {
        expect(
            readMcpToolApp({
                _meta: { 'team.alldone/app': { id: 'Judy', name: 'Judy Job', summary: 'x'.repeat(500) } },
            })
        ).toEqual({
            id: 'judy',
            name: 'Judy Job',
            summary: 'x'.repeat(240),
        })
    })

    test('a tool without an app belongs to its server', () => {
        expect(readMcpToolApp({ name: 'search' })).toBeNull()
        expect(readMcpToolApp({ _meta: { 'team.alldone/app': { name: 'no id' } } })).toBeNull()
        expect(getMcpAppKey('pubmed', null)).toBe('pubmed')
        expect(getMcpAppKey('team', JUDY)).toBe('team:judy')
    })
})

describe('apps of the connected servers', () => {
    const apps = describeMcpApps(targets)

    test('one entry per app, a server without apps as one, each with its own namespace', () => {
        expect(apps.map(app => [app.key, app.namespace, app.toolNames.length])).toEqual([
            ['team:judy', 'mcp_judy_job', 50],
            ['team:story', 'mcp_story_builder', 66],
            ['pubmed', 'mcp_pubmed', 1],
        ])
    })

    test('namespace names stay unique when two apps share a name', () => {
        const twins = describeMcpApps([target('a', 'Records', 'x'), target('b', 'Records', 'y')])
        expect(twins.map(app => app.namespace)).toEqual(['mcp_records', 'mcp_records_2'])
    })

    test('with tool search every tool is sent, grouped by app with the app description', () => {
        const { schemas: sent, namespaceIndex } = selectMcpToolSchemas({ schemas, apps, toolSearch: true })
        expect(sent).toHaveLength(schemas.length)
        expect(namespaceIndex.get('mcp_team_judy_3')).toEqual({
            namespace: 'mcp_judy_job',
            description: 'Judy Job on MCP server "alldone.team": Job search and applications.',
        })
        expect(namespaceIndex.get('mcp_pubmed_search').description).toBe('MCP server "PubMed".')
    })

    test('without tool search a small server is sent whole', () => {
        const small = targets.slice(0, MCP_DIRECT_TOOL_LIMIT)
        const result = selectMcpToolSchemas({ schemas: small.map(schemaOf), apps: describeMcpApps(small) })
        expect(result.schemas).toHaveLength(MCP_DIRECT_TOOL_LIMIT)
        expect(result.schemas.some(schema => schema.function.name === OPEN_MCP_APP_TOOL_NAME)).toBe(false)
    })

    test('without tool search a large server offers its apps, and an opened app brings its tools', () => {
        const closed = selectMcpToolSchemas({ schemas, apps })
        expect(closed.schemas.map(schema => schema.function.name)).toEqual([OPEN_MCP_APP_TOOL_NAME])
        const open = closed.schemas[0].function
        expect(open.parameters.properties.app.enum).toEqual(['team:judy', 'team:story', 'pubmed'])
        expect(open.description).toContain(
            'team:judy: Judy Job on MCP server "alldone.team": Job search and applications. (50 tools)'
        )

        const context = {}
        expect(openMcpApp(apps, 'team:judy', context)).toMatchObject({ success: true, toolCount: 50 })
        openMcpApp(apps, 'team:judy', context)
        expect(context.openedMcpAppKeys).toEqual(['team:judy'])
        const opened = selectMcpToolSchemas({ schemas, apps, openedKeys: context.openedMcpAppKeys })
        expect(opened.schemas).toHaveLength(51)
        expect(opened.schemas.slice(1).every(schema => schema.function.name.startsWith('mcp_team_judy_'))).toBe(true)
        expect(opened.schemas[0].function.description).toContain('(50 tools, open)')
    })

    test('an unknown app opens nothing and names the apps there are', () => {
        const context = {}
        expect(openMcpApp(apps, 'team:nope', context)).toMatchObject({
            success: false,
            availableApps: ['team:judy', 'team:story', 'pubmed'],
        })
        expect(context.openedMcpAppKeys).toBeUndefined()
    })
})
