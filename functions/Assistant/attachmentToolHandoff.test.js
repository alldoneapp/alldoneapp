const { buildConversationSafeToolResult } = require('./attachmentToolHandoff')

const mcpTool = 'mcp_team_story_get_123'
const result = structuredContent => ({
    success: true,
    isError: false,
    toolName: 'story_get',
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
})

describe('MCP conversation context', () => {
    test('deduplicates before the ceiling so all 25 scenes and full scripts survive', () => {
        const story = {
            revision: 7,
            scenes: Array.from({ length: 25 }, (_, i) => ({
                sceneId: `scene-${i}`,
                transcript: 'Script. '.repeat(110),
            })),
        }
        const raw = result(story)
        expect(JSON.stringify(raw).length).toBeGreaterThan(40000)

        const safe = buildConversationSafeToolResult(mcpTool, raw)

        expect(safe.content).toEqual([])
        expect(safe.structuredContent).toEqual(story)
        expect(safe.contextTruncated).toBeUndefined()
        expect(JSON.stringify(safe).length).toBeLessThan(40000)
        expect(raw.content).toHaveLength(1) // The MCP App still receives the complete raw response.
    })

    test('preserves additional instructions, images and resources alongside structured JSON', () => {
        const raw = result({ title: 'Story', revision: 2 })
        raw.content[0].text = '{ "revision": 2, "title": "Story" }'
        const extra = [
            { type: 'text', text: 'Review the selected scene before editing.' },
            { type: 'text', text: '{"title":"Different content"}' },
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
            { type: 'resource_link', uri: 'ui://story/view', name: 'Story' },
        ]
        raw.content.push(...extra)
        raw.appView = 'The user sees the app.'
        expect(buildConversationSafeToolResult(mcpTool, raw)).toEqual({ ...raw, content: extra })
    })

    test('keeps text-only MCP results and unrelated tools unchanged', () => {
        const textOnly = { success: true, content: [{ type: 'text', text: 'Story loaded.' }] }
        expect(buildConversationSafeToolResult(mcpTool, textOnly)).toBe(textOnly)
        const raw = result({ title: 'Story' })
        expect(buildConversationSafeToolResult('some_other_tool', raw)).toBe(raw)
    })

    test('compares JSON representations when a result contains optional undefined fields', () => {
        const raw = result({ title: 'Story', optional: undefined })
        expect(buildConversationSafeToolResult(mcpTool, raw)).toEqual({ ...raw, content: [] })
    })

    test('preserves error status and details while removing only their duplicate', () => {
        const raw = {
            ...result({ error: 'forbidden', message: 'Reconnect this account.' }),
            success: false,
            isError: true,
        }
        expect(buildConversationSafeToolResult(mcpTool, raw)).toEqual({ ...raw, content: [] })
    })
})
