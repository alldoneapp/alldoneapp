const { dispatchVmOnce } = require('./vmDispatchGuard')

const job = { success: true, correlationId: 'vm-1', status: 'started', hostProjectId: 'p', hostObjectId: 'task' }
const call = (runtime, dispatch, args = {}) =>
    dispatchVmOnce({ runtime, dispatch, args, projectId: 'p', requestUserId: 'u' })

test('the six calls from one request dispatch once, including a continuation after completion', async () => {
    const runtime = { objectId: 'task' }
    const dispatch = jest.fn(async () => job)
    for (let i = 0; i < 6; i++) {
        const result = await call(
            runtime,
            dispatch,
            i ? { continue_in_object_id: 'task', objective: 'Check or retrieve PDF' } : {}
        )
        expect(result.correlationId).toBe('vm-1')
        if (i) expect(result).toMatchObject({ reused: true, message: expect.stringContaining('get_vm_job') })
    }
    expect(dispatch).toHaveBeenCalledTimes(1)
    await call({ objectId: 'task' }, dispatch)
    expect(dispatch).toHaveBeenCalledTimes(2)
})

test('concurrent calls share the dispatch before it returns', async () => {
    const runtime = { objectId: 'task' }
    let finish
    const dispatch = jest.fn(
        () =>
            new Promise(resolve => {
                finish = resolve
            })
    )
    const first = call(runtime, dispatch)
    const second = call(runtime, dispatch)
    await Promise.resolve()
    finish(job)
    await expect(Promise.all([first, second])).resolves.toMatchObject([job, { ...job, reused: true }])
    expect(dispatch).toHaveBeenCalledTimes(1)
})

test('a contextless request reuses its created host, while independent target tasks can run', async () => {
    const runtime = {}
    const dispatch = jest.fn(async () => job)
    await call(runtime, dispatch)
    await call(runtime, dispatch, { continue_in_object_id: 'task' })
    await call(runtime, dispatch, { target_task_id: 'other' })
    expect(dispatch).toHaveBeenCalledTimes(2)
})

test('an explicit validation failure can be corrected without caching a failed launch', async () => {
    const runtime = { objectId: 'task' }
    const dispatch = jest.fn().mockResolvedValueOnce({ success: false }).mockResolvedValue(job)
    await call(runtime, dispatch)
    await expect(call(runtime, dispatch)).resolves.toEqual(job)
    expect(dispatch).toHaveBeenCalledTimes(2)
})

test('an ambiguous thrown dispatch is not repeated', async () => {
    const runtime = { objectId: 'task' }
    const dispatch = jest.fn(async () => {
        throw new Error('Connection lost')
    })
    await expect(call(runtime, dispatch)).rejects.toThrow('Connection lost')
    await expect(call(runtime, dispatch)).rejects.toThrow('Connection lost')
    expect(dispatch).toHaveBeenCalledTimes(1)
})

test('a new user message on a reused runtime can dispatch a genuine follow-up', async () => {
    const runtime = { objectId: 'task', messageId: 'first' }
    const dispatch = jest.fn(async () => job)
    await call(runtime, dispatch)
    runtime.messageId = 'second'
    await call(runtime, dispatch, { continue_in_object_id: 'task' })
    expect(dispatch).toHaveBeenCalledTimes(2)
})

test('opening a separate Anna summary comment does not create a fresh VM dispatch scope', async () => {
    const runtime = { objectId: 'task', assistantCommentId: 'introduction' }
    const dispatch = jest.fn(async () => job)
    await call(runtime, dispatch)
    runtime.assistantCommentId = 'summary'
    await call(runtime, dispatch, { continue_in_object_id: 'task' })
    expect(dispatch).toHaveBeenCalledTimes(1)
})
