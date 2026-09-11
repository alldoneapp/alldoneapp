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
