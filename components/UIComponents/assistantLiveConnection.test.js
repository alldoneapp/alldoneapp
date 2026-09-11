import { createLiveCallConnection } from './assistantLiveConnection'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('waits for both provider startup and the server controller before enabling a call', async () => {
    const channel = { readyState: 'open', send: jest.fn(), close: jest.fn() }
    const connection = createLiveCallConnection(channel)
    let ready = false
    const waiting = connection.waitUntilReady().then(() => {
        ready = true
    })
    channel.onmessage({ data: JSON.stringify({ type: 'session.started' }) })
    await Promise.resolve()
    expect(ready).toBe(false)
    channel.onmessage({
        data: JSON.stringify({ type: 'session.instructions.appended', client_event_id: 'alldone_live_ready' }),
    })
    await waiting
    expect(ready).toBe(true)
    connection.dispose()
})

test('keeps the receiver alive until final usage, and makes repeated hangups idempotent', async () => {
    const channel = { readyState: 'open', send: jest.fn(), close: jest.fn() }
    const onUsage = jest.fn()
    const connection = createLiveCallConnection(channel, { onUsage })
    const waiting = connection.close()
    expect(connection.close()).toBe(waiting)
    expect(channel.send).toHaveBeenCalledTimes(1)
    expect(channel.close).not.toHaveBeenCalled()
    channel.onmessage({ data: JSON.stringify({ type: 'session.closed', usage: { seconds: 72 } }) })
    await expect(waiting).resolves.toBe(true)
    expect(onUsage).toHaveBeenCalledWith({ seconds: 72 })
    connection.dispose()
})

test('bounds close when the provider never sends a final event', async () => {
    const connection = createLiveCallConnection({ readyState: 'open', send: jest.fn() })
    const closing = connection.close()
    await jest.advanceTimersByTimeAsync(8000)
    await expect(closing).resolves.toBe(false)
    connection.dispose()
})

test('recovers when the controller acknowledgement predates the browser event connection', async () => {
    const channel = { readyState: 'open', send: jest.fn(), close: jest.fn() }
    const getControllerStatus = jest
        .fn()
        .mockResolvedValueOnce({ controllerConnected: false })
        .mockResolvedValue({ controllerConnected: true })
    const connection = createLiveCallConnection(channel, { getControllerStatus })
    const ready = connection.waitUntilReady()
    channel.onmessage({ data: JSON.stringify({ type: 'session.started' }) })
    await jest.advanceTimersByTimeAsync(1100)
    await expect(ready).resolves.toBeUndefined()
    connection.dispose()
    const calls = getControllerStatus.mock.calls.length
    await jest.advanceTimersByTimeAsync(5000)
    expect(getControllerStatus).toHaveBeenCalledTimes(calls)
})
test('a transport error before waitUntilReady fails immediately rather than waiting 45 seconds', async () => {
    const channel = { readyState: 'open', close: jest.fn() }
    const connection = createLiveCallConnection(channel)
    channel.onerror()
    await expect(connection.waitUntilReady()).rejects.toThrow('Voice connection failed')
    connection.dispose()
})
test('a disposed connection cannot start polling or become ready from a late status result', async () => {
    let respond
    const channel = { readyState: 'open', close: jest.fn() }
    const getControllerStatus = jest.fn(
        () =>
            new Promise(resolve => {
                respond = resolve
            })
    )
    const connection = createLiveCallConnection(channel, { getControllerStatus })
    const result = connection.waitUntilReady().catch(error => error)
    connection.dispose()
    respond({ controllerConnected: true })
    await jest.advanceTimersByTimeAsync(5000)
    expect(await result).toBeInstanceOf(Error)
    expect(getControllerStatus).toHaveBeenCalledTimes(1)
})

test('sends the greeting once, only after provider and controller readiness', async () => {
    const channel = { readyState: 'open', send: jest.fn(), close: jest.fn() }
    const connection = createLiveCallConnection(channel)
    connection.greet('Hello, I am Anna.')
    expect(channel.send).not.toHaveBeenCalled()
    channel.onmessage({ data: JSON.stringify({ type: 'session.started' }) })
    channel.onmessage({
        data: JSON.stringify({ type: 'session.instructions.appended', client_event_id: 'alldone_live_ready' }),
    })
    connection.greet('Hello, I am Anna.')
    connection.greet('Hello, I am Anna.')
    expect(channel.send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(channel.send.mock.calls[0][0])).toMatchObject({
        type: 'session.commentary.append',
        event_id: 'alldone_live_greeting',
        content: 'Hello, I am Anna.',
    })
    connection.dispose()
})
