const {
    appendAssistantActivity,
    advanceAssistantActivity,
    MAX_ASSISTANT_ACTIVITY_HISTORY,
} = require('./assistantActivityHistory')

test('preserves the prior phase and updates parallel progress without adding heartbeat rows', () => {
    const thinking = { phase: 'thinking', startedAt: 1 }
    const tool = { phase: 'tool', toolName: 'parallel_reads', startedAt: 2, subject: '0/5' }
    let run = { activity: thinking }
    Object.assign(run, advanceAssistantActivity(run, tool))
    Object.assign(run, advanceAssistantActivity(run, { ...tool, subject: '2/5' }))
    Object.assign(run, advanceAssistantActivity(run, { phase: 'composing', startedAt: 3 }))
    expect(run.activityHistory).toEqual([thinking, { ...tool, subject: '2/5' }, { phase: 'composing', startedAt: 3 }])
})

test('bounds saved history and keeps repeated executions of the same tool distinct', () => {
    let history = []
    for (let startedAt = 1; startedAt <= 20; startedAt++) {
        history = appendAssistantActivity(history, { phase: 'tool', toolName: 'web_search', startedAt })
    }
    expect(history).toHaveLength(MAX_ASSISTANT_ACTIVITY_HISTORY)
    expect(history[0].startedAt).toBe(13)
    expect(history[history.length - 1].startedAt).toBe(20)
})

test('stores only display fields and leaves prior snapshots untouched', () => {
    const history = [{ phase: 'thinking', startedAt: 1 }]
    const result = appendAssistantActivity(history, {
        phase: 'tool',
        startedAt: 2,
        actionKey: 'assistant_activity_search_notes',
        subject: 'Pricing',
        toolArgs: { privateData: 'never persist' },
        result: 'never persist',
    })
    expect(result[1]).toEqual({
        phase: 'tool',
        startedAt: 2,
        actionKey: 'assistant_activity_search_notes',
        subject: 'Pricing',
    })
    expect(history).toEqual([{ phase: 'thinking', startedAt: 1 }])
    expect(appendAssistantActivity([null, { phase: 'invalid' }], null)).toEqual([])
})
