const { prepareResearchRequest, compactResearchConversation, MAX_RESEARCH_CALLS } = require('./assistantResearchGuard')

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
})
