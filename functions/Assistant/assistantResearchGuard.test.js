const {
    prepareResearchRequest,
    compactResearchConversation,
    toolsForFinalReply,
    mcpToolsForFinalReply,
    isMcpLookupTool,
    isMcpActionTool,
    MAX_RESEARCH_CALLS,
} = require('./assistantResearchGuard')
const { buildConversationSafeToolResult } = require('./attachmentToolHandoff')

function round(
    index,
    name = 'search',
    result = { results: { notes: [{ id: `note-${index}` }] } },
    args = { query: `query-${index}` }
) {
    return [
        {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: `call-${index}`, function: { name, arguments: JSON.stringify(args) } }],
        },
        { role: 'tool', content: JSON.stringify(result), tool_call_id: `call-${index}` },
        { role: 'user', content: 'Continue the request if needed.' },
    ]
}

const request = [
    ['system', 'Original instructions', { promptCacheBreakpoint: true }],
    ['user', 'Find the meeting about Juno tables'],
]

describe('shared assistant research safeguards', () => {
    test('ends the incident pattern of changing search wording while returning the same note', () => {
        const prompt = [...request]
        for (let i = 0; i < 5; i++)
            prompt.push(
                ...round(i, 'search', {
                    query: `wording-${i}`,
                    results: { notes: [{ id: 'same-note', title: 'Juno meeting' }] },
                })
            )
        const prepared = prepareResearchRequest(prompt)
        expect(prepared.stopReason).toBe('repeated_search_results')
        expect(prepared.messages.at(-1).content).toContain('matches')
        expect(prepared.messages.slice(0, 2)).toEqual(request)
    })

    test('stops an exact duplicate read without applying this rule to mutations', () => {
        expect(
            prepareResearchRequest([
                ...request,
                ...round(1, 'get_notes', { content: 'Note' }, { noteId: 'n1' }),
                ...round(2, 'get_notes', { content: 'Note' }, { noteId: 'n1' }),
            ]).stopReason
        ).toBe('duplicate_research_call')
        expect(
            prepareResearchRequest([...request, ...round(1, 'update_task'), ...round(2, 'update_task')]).stopReason
        ).toBeNull()
    })

    test('bounds consecutive research even if every result is new', () => {
        const prompt = [...request]
        for (let i = 0; i < MAX_RESEARCH_CALLS; i++) prompt.push(...round(i))
        expect(prepareResearchRequest(prompt).stopReason).toBe('research_call_limit')
    })

    test('counts wiki pages as research instead of letting each page reset the research budget', () => {
        const prompt = [...request]
        for (let i = 0; i < MAX_RESEARCH_CALLS; i++)
            prompt.push(
                ...round(
                    i,
                    'read_knowledge_page',
                    { success: true, body: `Page ${i}` },
                    { projectId: 'jtl', slug: `p-${i}` }
                )
            )
        expect(prepareResearchRequest(prompt).stopReason).toBe('research_call_limit')
        expect(
            prepareResearchRequest([
                ...request,
                ...round(1, 'read_knowledge_page', { success: true }, { projectId: 'jtl', slug: 'connect' }),
                ...round(2, 'read_knowledge_page', { success: true }, { projectId: 'jtl', slug: 'connect' }),
            ]).stopReason
        ).toBe('duplicate_research_call')
    })

    test('allows long workflows that make progress through successful mutations', () => {
        const prompt = [...request]
        for (let i = 0; i < 25; i++)
            prompt.push(...round(i), ...round(`write-${i}`, 'update_project_description', { success: true }))
        expect(prepareResearchRequest(prompt).stopReason).toBeNull()
    })

    test('resets a research limit after a completed action in a parallel round, but not after a failed action', () => {
        const prompt = [...request]
        for (let i = 0; i < MAX_RESEARCH_CALLS; i++) prompt.push(...round(i))
        const continued = [...prompt, ...round('write', 'update_task', { success: true }), ...round('next')]
        expect(prepareResearchRequest(continued).stopReason).toBeNull()
        expect(
            prepareResearchRequest([...prompt, ...round('write', 'update_task', { success: false })]).stopReason
        ).toBe('research_call_limit')
    })

    test('compacts string tool outputs as excerpts instead of expanding them into character keys', () => {
        const prompt = [...request, ...round(1, 'fetch_url', 'reference text '.repeat(10000))]
        const compacted = compactResearchConversation(prompt, true)
        const result = JSON.parse(compacted.find(entry => entry.role === 'tool').content)
        expect(result.result).toContain('reference text')
        expect(result.contextTruncated).toBe(true)
        expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThan(10000)
    })

    test('compacts aggregate results, preserving instructions, user turns, call pairs and mutation evidence', () => {
        const prompt = [...request]
        for (let i = 0; i < 10; i++)
            prompt.push(
                ...round(i, 'get_notes', {
                    noteId: `note-${i}`,
                    url: `https://example.com/notes/${i}`,
                    content: 'valuable text '.repeat(3000),
                })
            )
        prompt.push(
            ...round('write', 'create_task', {
                success: true,
                taskId: 't1',
                projectId: 'p1',
                url: 'https://example.com/tasks/t1',
            })
        )
        const original = JSON.stringify(prompt)
        const prepared = prepareResearchRequest(prompt)
        expect(Buffer.byteLength(JSON.stringify(prepared.messages))).toBeLessThan(100000)
        expect(JSON.stringify(prompt)).toBe(original)
        expect(prepared.messages.slice(0, 2)).toEqual(request)
        expect(prepared.messages.filter(entry => entry.role === 'tool').map(entry => entry.tool_call_id)).toEqual(
            prompt.filter(entry => entry.role === 'tool').map(entry => entry.tool_call_id)
        )
        expect(JSON.parse(prepared.messages.find(entry => entry.tool_call_id === 'call-write').content)).toEqual({
            success: true,
            taskId: 't1',
            projectId: 'p1',
            url: 'https://example.com/tasks/t1',
        })
        const note = JSON.parse(prepared.messages.find(entry => entry.tool_call_id === 'call-0').content)
        expect(note.noteId).toBe('note-0')
        expect(note.url).toBe('https://example.com/notes/0')
        expect(note.contextTruncated).toBe(true)
    })

    test('returns sourced partial findings if even final answer generation cannot fit', () => {
        const prepared = prepareResearchRequest([
            ...request,
            ...round(1, 'search', {
                results: { notes: [{ title: 'Juno meeting', url: 'https://example.com/meeting' }] },
            }),
        ])
        expect(prepared.fallback()).toContain('Juno meeting: https://example.com/meeting')
        expect(prepared.fallback()).toContain('not confirmed')
    })

    test('keeps every pending parallel call paired with its result during compaction', () => {
        const prompt = [
            {
                role: 'assistant',
                tool_calls: [
                    { id: 'a', function: { name: 'get_notes', arguments: '{}' } },
                    { id: 'b', function: { name: 'get_notes', arguments: '{}' } },
                ],
            },
            { role: 'tool', content: JSON.stringify({ content: 'x'.repeat(150000) }), tool_call_id: 'a' },
            { role: 'tool', content: JSON.stringify({ content: 'y'.repeat(150000) }), tool_call_id: 'b' },
        ]
        const compacted = compactResearchConversation(prompt, true)
        expect(compacted[0].tool_calls).toEqual(prompt[0].tool_calls)
        expect(compacted.slice(1).map(entry => entry.tool_call_id)).toEqual(['a', 'b'])
        compacted.slice(1).forEach(entry => expect(JSON.parse(entry.content).contextTruncated).toBe(true))
    })

    test('offers the final reply only tools that act, never lookups', () => {
        expect(
            toolsForFinalReply([
                'get_tasks',
                'get_goals',
                'search',
                'web_search',
                'read_knowledge_page',
                'search_knowledge',
                'list_recent_chat_media',
                'find_profile_photo',
                'fetch_url',
                'browser_navigate',
                'load_skill',
                'compact_thread_context',
                'update_user_description',
                'update_task',
                'create_note',
                'execute_task_in_vm',
                null,
            ])
        ).toEqual(['update_user_description', 'update_task', 'create_note', 'execute_task_in_vm'])
        expect(toolsForFinalReply(undefined)).toEqual([])
    })
})

// 2026-11-19, production execution nv4n836qsdsc: a task-chat reply read a Story Builder story 85 times
// in 34 minutes. MCP tool names carry a server prefix and a hash, so the guard never saw a lookup.
const STORY_GET = 'mcp_story_builder__story_get_3d970dad804d'
const STORY_LIST = 'mcp_story_builder__story_list_7e1d96b78905'
const STORY_CAPABILITIES = 'mcp_story_builder__story_capabilities_0a1b2c3d4e5f'
const STORY_UPDATE = 'mcp_story_builder__story_update_aaaaaaaaaaaa'
const STORY_DELETE_VOICE = 'mcp_story_builder__story_delete_voice_bbbbbbbbbbbb'
const JOB_GET = 'mcp_story_builder__job_get_cccccccccccc'

const mcpResult = structuredContent => ({
    success: true,
    isError: false,
    serverLabel: 'Story Builder',
    content: [],
    structuredContent,
})

function buildStory(storyId = 'story-1') {
    return {
        storyId,
        title: 'Karsten LinkedIn video',
        revision: 12,
        scenes: Array.from({ length: 24 }, (_, i) => ({
            sceneId: `scene-${String(i).padStart(2, '0')}`,
            order: i,
            title: `Scene ${i}: why the inbox finally stays empty`,
            transcript: `Scene ${i} voiceover. `.repeat(45),
            visualPrompt: `A calm product shot of the Alldone board, variant ${i}. `.repeat(17),
            voiceId: `voice-${i % 2 === 0 ? 'karsten' : 'narrator'}-${i}`,
            durationMs: 4000 + i,
            status: 'ready',
        })),
    }
}

describe('MCP lookups count as research', () => {
    test('classifies MCP tools by the verb in their bare name', () => {
        expect(isMcpLookupTool(STORY_GET)).toBe(true)
        expect(isMcpLookupTool(STORY_LIST)).toBe(true)
        expect(isMcpLookupTool('mcp_story_builder__story_list_voices_123456789abc')).toBe(true)
        expect(isMcpLookupTool(STORY_CAPABILITIES)).toBe(true)
        expect(isMcpLookupTool(JOB_GET)).toBe(true)
        expect(isMcpActionTool(STORY_UPDATE)).toBe(true)
        expect(isMcpActionTool(STORY_DELETE_VOICE)).toBe(true)
        expect(isMcpActionTool('mcp_linear_save_issue_123456789abc')).toBe(true)
        expect(isMcpLookupTool('mcp_linear_list_issues_123456789abc')).toBe(true)
        // Built-in names and the Tools Access key are not MCP tool names.
        expect(isMcpLookupTool('get_tasks')).toBe(false)
        expect(isMcpLookupTool('mcp_servers')).toBe(false)
        expect(isMcpActionTool('update_task')).toBe(false)
    })

    test('ends the incident: the same story read twice with the same answer stops the research', () => {
        const story = mcpResult(buildStory())
        const prepared = prepareResearchRequest([
            ...request,
            ...round(1, STORY_LIST, mcpResult({ stories: [{ storyId: 'story-1' }] }), { limit: 3 }),
            ...round(2, STORY_GET, story, { storyId: 'story-1' }),
            ...round(3, STORY_GET, story, { storyId: 'story-1' }),
        ])
        expect(prepared.stopReason).toBe('duplicate_research_call')
        expect(prepared.messages.at(-1).content).toContain('Do not call more research or lookup tools')
    })

    test('MCP reads no longer reset the budget, and an unknown-verb read is a lookup too', () => {
        const prompt = [...request]
        for (let i = 0; i < MAX_RESEARCH_CALLS; i++) {
            prompt.push(...round(i, STORY_GET, mcpResult({ storyId: `s-${i}` }), { storyId: `s-${i}` }))
            if (i % 10 === 0) prompt.push(...round(`cap-${i}`, STORY_CAPABILITIES, mcpResult({ version: i }), { n: i }))
        }
        expect(prepareResearchRequest(prompt).stopReason).toBe('research_call_limit')
    })

    test('a successful MCP write still counts as progress and resets the guard', () => {
        const story = mcpResult(buildStory())
        expect(
            prepareResearchRequest([
                ...request,
                ...round(1, STORY_GET, story, { storyId: 'story-1' }),
                ...round(2, STORY_UPDATE, mcpResult({ storyId: 'story-1', revision: 13 }), { storyId: 'story-1' }),
                ...round(3, STORY_GET, story, { storyId: 'story-1' }),
            ]).stopReason
        ).toBeNull()
        const prompt = [...request]
        for (let i = 0; i < 30; i++)
            prompt.push(
                ...round(i, STORY_GET, mcpResult({ storyId: `s-${i}` }), { storyId: `s-${i}` }),
                ...round(`w-${i}`, STORY_UPDATE, mcpResult({ storyId: `s-${i}` }), { storyId: `s-${i}` })
            )
        expect(prepareResearchRequest(prompt).stopReason).toBeNull()
    })

    test('polling a pending job is neither a duplicate nor research, but re-reading a finished one is', () => {
        const prompt = [...request]
        for (let i = 0; i < MAX_RESEARCH_CALLS + 5; i++)
            prompt.push(
                ...round(i, JOB_GET, mcpResult({ id: 'job-1', status: 'running', stage: 'render' }), {
                    jobId: 'job-1',
                })
            )
        expect(prepareResearchRequest(prompt).stopReason).toBeNull()
        const done = mcpResult({ id: 'job-1', status: 'succeeded' })
        expect(
            prepareResearchRequest([
                ...prompt,
                ...round('done-1', JOB_GET, done, { jobId: 'job-1' }),
                ...round('done-2', JOB_GET, done, { jobId: 'job-1' }),
            ]).stopReason
        ).toBe('duplicate_research_call')
    })

    test('the final reply keeps MCP tools that act and drops MCP lookups', () => {
        expect(toolsForFinalReply([STORY_GET, STORY_LIST, STORY_DELETE_VOICE, 'mcp_servers', 'open_mcp_app'])).toEqual([
            STORY_DELETE_VOICE,
            'mcp_servers',
        ])
        const schema = name => ({ type: 'function', function: { name } })
        expect(
            mcpToolsForFinalReply({
                delegationToolSchemas: [schema('talk_to_assistant_x')],
                mcpToolSchemas: [schema(STORY_GET), schema(STORY_DELETE_VOICE), schema(JOB_GET)],
                mcpApps: [
                    { key: 'sb:story', toolNames: [STORY_GET, STORY_DELETE_VOICE] },
                    { key: 'sb:jobs', toolNames: [JOB_GET] },
                ],
            })
        ).toEqual({
            mcpToolSchemas: [schema(STORY_DELETE_VOICE)],
            mcpApps: [{ key: 'sb:story', toolNames: [STORY_DELETE_VOICE] }],
        })
        expect(mcpToolsForFinalReply()).toEqual({ mcpToolSchemas: [], mcpApps: [] })
    })
})

describe('compaction keeps a large latest result usable', () => {
    const voiceIdsOf = result => {
        const scenes = result.structuredContent?.scenes || result.scenes || []
        return scenes.filter(scene => scene && typeof scene === 'object').map(scene => scene.voiceId)
    }
    const expectedVoiceIds = buildStory().scenes.map(scene => scene.voiceId)

    test('a 47 KB, 24-scene story_get still shows every scene voiceId after the ceiling and compaction', () => {
        const raw = mcpResult(buildStory())
        raw.content = [{ type: 'text', text: JSON.stringify(raw.structuredContent) }]
        const rawStoryChars = JSON.stringify(raw.structuredContent).length
        expect(rawStoryChars).toBeGreaterThan(45000)
        expect(rawStoryChars).toBeLessThan(50000)

        // The per-result ceiling (40k characters) keeps all 24 scenes, not the first 20.
        const safe = buildConversationSafeToolResult(STORY_GET, raw)
        expect(JSON.stringify(safe).length).toBeLessThanOrEqual(40000)
        expect(voiceIdsOf(safe)).toEqual(expectedVoiceIds)

        // Enough older reads to push the conversation over the compaction threshold.
        const prompt = [...request]
        for (let i = 0; i < 6; i++)
            prompt.push(
                ...round(`list-${i}`, STORY_LIST, mcpResult({ page: i, filler: 'x'.repeat(20000) }), { page: i })
            )
        prompt.push(...round('get', STORY_GET, safe, { storyId: 'story-1' }))
        const prepared = prepareResearchRequest(prompt)
        expect(prepared.stopReason).toBeNull()
        const latest = JSON.parse(prepared.messages.find(entry => entry.tool_call_id === 'call-get').content)
        expect(voiceIdsOf(latest)).toEqual(expectedVoiceIds)
        expect(Buffer.byteLength(JSON.stringify(prepared.messages))).toBeLessThan(100000)
    })

    test('the final reply (aggressive compaction) still sees every voiceId of the story it re-read', () => {
        const safe = buildConversationSafeToolResult(STORY_GET, mcpResult(buildStory()))
        const compacted = compactResearchConversation(
            [
                ...request,
                ...round(1, STORY_LIST, mcpResult({ stories: [{ storyId: 'story-1' }] }), { limit: 3 }),
                ...round(2, STORY_GET, safe, { storyId: 'story-1' }),
            ],
            true
        )
        const latest = JSON.parse(compacted.find(entry => entry.tool_call_id === 'call-2').content)
        expect(latest.contextTruncated).toBe(true)
        expect(voiceIdsOf(latest)).toEqual(expectedVoiceIds)
        expect(latest.structuredContent.scenes[0].sceneId).toBe('scene-00')
    })
})
