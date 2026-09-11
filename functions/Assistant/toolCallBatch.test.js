const { executeToolCallBatch, canRunToolInParallel } = require('./toolCallBatch')
const call = (name, id = name) => ({ id, function: { name, arguments: '{}' } })
const deferred = () => {
    let resolve, reject
    const promise = new Promise((yes, no) => {
        resolve = yes
        reject = no
    })
    return { promise, resolve, reject }
}
const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
}

test('overlaps at most three reads, fills free slots and returns all five results in request order', async () => {
    const gates = Array.from({ length: 5 }, deferred)
    const starts = []
    const states = []
    const running = executeToolCallBatch(
        gates.map((_, i) => call('web_search', String(i))),
        async (_, i) => {
            starts.push(i)
            return gates[i].promise
        },
        { onState: state => states.push(state) }
    )
    await flush()
    expect(starts).toEqual([0, 1, 2])
    gates[2].resolve('two')
    await flush()
    expect(starts).toEqual([0, 1, 2, 3])
    gates[3].resolve('three')
    await flush()
    expect(starts).toEqual([0, 1, 2, 3, 4])
    gates[4].resolve('four')
    gates[1].resolve('one')
    gates[0].resolve('zero')
    expect(await running).toEqual(['zero', 'one', 'two', 'three', 'four'])
    expect(Math.max(...states.map(state => state.active.length))).toBe(3)
    expect(states.at(-1)).toEqual({ total: 5, completed: 5, active: [] })
})

test.each([
    'create_task',
    'get_chat_attachment',
    'get_gmail_attachment',
    'external_tool_search',
    'mcp_read',
    'browser_navigate',
    'resolve_voice_confirmation',
    'end_call',
    'unknown',
])('%s is an ordering barrier', async name => {
    expect(canRunToolInParallel(call(name))).toBe(false)
    const gates = Array.from({ length: 4 }, deferred)
    const starts = []
    const running = executeToolCallBatch(
        [call('search'), call('fetch_url'), call(name), call('get_notes')],
        async (_, i) => {
            starts.push(i)
            return gates[i].promise
        }
    )
    await flush()
    expect(starts).toEqual([0, 1])
    gates[0].resolve(0)
    await flush()
    expect(starts).toEqual([0, 1])
    gates[1].resolve(1)
    await flush()
    expect(starts).toEqual([0, 1, 2])
    gates[2].resolve(2)
    await flush()
    expect(starts).toEqual([0, 1, 2, 3])
    gates[3].resolve(3)
    expect(await running).toEqual([0, 1, 2, 3])
})

test('a cancellation or permission failure stops queued work and drains running reads before rejecting', async () => {
    const gates = Array.from({ length: 3 }, deferred)
    const execute = jest.fn((_, i) => gates[i]?.promise)
    const running = executeToolCallBatch(
        [0, 1, 2, 3].map(i => call('web_search', String(i))).concat(call('create_task')),
        execute
    )
    let finished = false
    const outcome = running.catch(error => {
        finished = true
        return error
    })
    gates[1].reject(new Error('voice_request_superseded'))
    await flush()
    expect(finished).toBe(false)
    gates[0].resolve(0)
    await flush()
    expect(finished).toBe(false)
    gates[2].resolve(2)
    expect((await outcome).message).toBe('voice_request_superseded')
    expect(execute).toHaveBeenCalledTimes(3)
})

test('returned tool failures stay associated with their call and do not drop other results', async () => {
    const failed = { success: false, error: 'source unavailable' }
    expect(
        await executeToolCallBatch([call('web_search'), call('get_notes')], async (_, i) => (i ? 'notes' : failed))
    ).toEqual([failed, 'notes'])
})
