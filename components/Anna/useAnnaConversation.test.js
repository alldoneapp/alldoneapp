import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import useAnnaConversation from './useAnnaConversation'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
const mockSnapshots = new Map()
const mockErrors = new Map()
const mockData = new Map()
const mockPendingSnapshots = new Set()
jest.mock('../../utils/backends/firestore', () => ({
    runHttpsCallableFunction: jest.fn(),
    getDb: () => ({
        doc: path => ({
            onSnapshot: (callback, error) => {
                mockSnapshots.set(path, callback)
                mockErrors.set(path, error)
                if (mockPendingSnapshots.has(path))
                    return () => {
                        mockSnapshots.delete(path)
                        mockErrors.delete(path)
                    }
                if (mockData.has(path)) callback({ exists: true, data: () => mockData.get(path) })
                else if (path.startsWith('chatObjects/'))
                    callback({
                        exists: true,
                        data: () => ({
                            isPublicFor: [0],
                            annaOwnerId: 'u1',
                            creatorId: 'u1',
                            type: 'topics',
                            assistantId: 'a1',
                        }),
                    })
                return () => {
                    mockSnapshots.delete(path)
                    mockErrors.delete(path)
                }
            },
        }),
    }),
}))
jest.mock('../../utils/appResume', () => ({ subscribePageVisible: () => () => {} }))
let root, container, result
const day = (id, rollover, projectId = 'p1') => ({
    projectId,
    chatId: id,
    assistantId: 'a1',
    nextRolloverAt: rollover,
    nextBefore: null,
    threads: [{ projectId, chatId: id, created: rollover }],
})
function Harness(props) {
    result = useAnnaConversation(props.userId || 'u1', props)
    return null
}
const render = async props => act(async () => root.render(<Harness {...props} />))
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.useFakeTimers()
    runHttpsCallableFunction.mockReset()
    mockData.clear()
    mockPendingSnapshots.clear()
    container = document.createElement('div')
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    jest.useRealTimers()
    delete global.IS_REACT_ACT_ENVIRONMENT
})

it('waits until the view is opened before creating a daily conversation', async () => {
    runHttpsCallableFunction.mockResolvedValue(day('today', Date.now() + 86400000))
    await render({ enabled: false })
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    await render({ enabled: true })
    expect(result.conversation.id).toBe('today')
})

it('uses the server local-midnight boundary and retains both days after rollover', async () => {
    const now = Date.now()
    runHttpsCallableFunction
        .mockResolvedValueOnce(day('today', now + 30000))
        .mockResolvedValue(day('tomorrow', now + 86400000))
    await render({ enabled: true })
    await act(async () => jest.advanceTimersByTime(30001))
    expect(result.conversation.id).toBe('tomorrow')
    expect(result.threads.map(thread => thread.chatId)).toEqual(['today', 'tomorrow'])
})

it('does not roll an active text or voice run into another day', async () => {
    const now = Date.now()
    runHttpsCallableFunction
        .mockResolvedValueOnce(day('today', now + 1000))
        .mockResolvedValue(day('tomorrow', now + 86400000))
    await render({ enabled: true, hold: true })
    await act(async () => jest.advanceTimersByTime(30001))
    expect(result.conversation.id).toBe('today')
    await render({ enabled: true, hold: false })
    await act(async () => jest.advanceTimersByTime(30001))
    expect(result.conversation.id).toBe('tomorrow')
})

it('ignores an old project response after the default project changes', async () => {
    let finishOld
    runHttpsCallableFunction
        .mockReturnValueOnce(
            new Promise(resolve => {
                finishOld = resolve
            })
        )
        .mockResolvedValue(day('new', Date.now() + 86400000, 'p2'))
    await render({ enabled: true, user: { defaultProjectId: 'p1' } })
    await render({ enabled: true, user: { defaultProjectId: 'p2' } })
    await act(async () => finishOld(day('old', Date.now() + 86400000)))
    expect(result.conversation.projectId).toBe('p2')
    expect(result.threads.map(thread => thread.chatId)).toEqual(['new'])
})

const deferred = () => {
    let resolve, reject
    const promise = new Promise((yes, no) => {
        resolve = yes
        reject = no
    })
    return { promise, resolve, reject }
}
const user = { defaultProjectId: 'p1' }
const stored = { projectId: 'p1', chatId: 'AnnaChat20261007u1', assistantId: 'a1', dateKey: '20261007' }
const storedChat = { annaOwnerId: 'u1', creatorId: 'u1', type: 'topics', assistantId: 'a1', created: 100 }
const seedStoredChat = () => {
    mockData.set('users/u1/private/annaConversation', stored)
    mockData.set(`chatObjects/p1/chats/${stored.chatId}`, storedChat)
}

it('prefetches the known conversation without starting a function and shows it during a cold start', async () => {
    seedStoredChat()
    const coldStart = deferred()
    const history = deferred()
    runHttpsCallableFunction.mockImplementation((name, payload) =>
        payload.historyOnly ? history.promise : coldStart.promise
    )
    await render({ enabled: false, user })
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    expect(result.conversation.id).toBe(stored.chatId)
    await render({ enabled: true, user })
    expect(result.loading).toBe(false)
    expect(result.conversation.id).toBe(stored.chatId)
    expect(runHttpsCallableFunction).toHaveBeenCalledWith('getAnnaConversationSecondGen', { includeHistory: false })
    expect(runHttpsCallableFunction).toHaveBeenCalledWith('getAnnaConversationSecondGen', { historyOnly: true })
})

it('renders a newly created conversation while its snapshot and history are still pending', async () => {
    const history = deferred()
    // A deliberately missing first snapshot exercises the server response fast path.
    mockPendingSnapshots.add(`chatObjects/p1/chats/${stored.chatId}`)
    runHttpsCallableFunction.mockImplementation((name, payload) =>
        payload.historyOnly
            ? history.promise
            : Promise.resolve({
                  ...stored,
                  conversation: { ...storedChat, projectId: 'p1', id: stored.chatId },
                  nextRolloverAt: Date.now() + 86400000,
              })
    )
    await render({ enabled: true, user })
    expect(result.loading).toBe(false)
    expect(result.conversation.id).toBe(stored.chatId)
    expect(result.historyLoaded).toBe(false)
    await act(async () =>
        history.resolve({ threads: [{ projectId: 'p1', chatId: 'anna_u1', created: 0 }], nextBefore: null })
    )
    expect(result.threads.map(thread => thread.chatId)).toEqual(['anna_u1', stored.chatId])
})

it('keeps the known chat usable if background history fails and supports retry', async () => {
    seedStoredChat()
    runHttpsCallableFunction.mockImplementation((name, payload) =>
        payload.historyOnly
            ? Promise.reject(new Error('History unavailable'))
            : Promise.resolve({ ...stored, nextRolloverAt: Date.now() + 86400000 })
    )
    await render({ enabled: true, user })
    expect(result.conversation.id).toBe(stored.chatId)
    expect(result.loading).toBe(false)
    expect(result.error).toBe('History unavailable')
    runHttpsCallableFunction.mockImplementation((name, payload) =>
        Promise.resolve(
            payload.historyOnly
                ? { threads: [], nextBefore: null }
                : { ...stored, nextRolloverAt: Date.now() + 86400000 }
        )
    )
    await act(async () => result.retry())
    expect(result.error).toBe('')
    expect(result.historyLoaded).toBe(true)
})

it('does not bootstrap a pointer from another project or another owner', async () => {
    seedStoredChat()
    await render({ enabled: false, user: { defaultProjectId: 'p2' } })
    expect(result.conversation).toBeNull()
    mockData.set(`chatObjects/p1/chats/${stored.chatId}`, { ...storedChat, annaOwnerId: 'someone-else' })
    await render({ enabled: false, user })
    expect(result.conversation).toBeNull()
})

it('discards old account replies and cached conversation on account switch', async () => {
    seedStoredChat()
    const oldEnsure = deferred()
    const oldHistory = deferred()
    runHttpsCallableFunction.mockImplementation((name, payload) =>
        payload.historyOnly ? oldHistory.promise : oldEnsure.promise
    )
    await render({ enabled: true, user })
    expect(result.conversation.id).toBe(stored.chatId)
    await render({ enabled: false, userId: 'u2', user })
    expect(result.conversation).toBeNull()
    await act(async () => {
        oldEnsure.resolve(day('old', Date.now() + 86400000))
        oldHistory.resolve({ threads: [{ ...stored, created: 100 }], nextBefore: null })
    })
    expect(result.conversation).toBeNull()
    expect(result.threads).toEqual([])
})

it('clears the cached conversation if its access is revoked', async () => {
    seedStoredChat()
    await render({ enabled: false, user })
    await act(async () => mockErrors.get(`chatObjects/p1/chats/${stored.chatId}`)(new Error('Permission denied')))
    expect(result.conversation).toBeNull()
    expect(result.threads).toEqual([])
})

it('waits for the authoritative daily thread before returning a send target', async () => {
    seedStoredChat()
    const coldStart = deferred()
    runHttpsCallableFunction.mockImplementation((name, payload) =>
        payload.historyOnly ? Promise.resolve({ threads: [stored], nextBefore: null }) : coldStart.promise
    )
    await render({ enabled: true, user })
    let target, send
    act(() => {
        send = result.resolveConversation().then(value => {
            target = value
        })
    })
    expect(target).toBeUndefined()
    expect(result.conversation.id).toBe(stored.chatId)
    await act(async () => {
        coldStart.resolve(day('tomorrow', Date.now() + 86400000))
        await send
    })
    expect(target.id).toBe('tomorrow')
    expect(runHttpsCallableFunction.mock.calls.filter(([, payload]) => payload.includeHistory === false)).toHaveLength(
        1
    )
})

it('still accepts pending history when the timezone changes during startup', async () => {
    seedStoredChat()
    const history = deferred()
    runHttpsCallableFunction.mockImplementation((name, payload) =>
        payload.historyOnly ? history.promise : Promise.resolve({ ...stored, nextRolloverAt: Date.now() + 86400000 })
    )
    await render({ enabled: true, user: { ...user, timezone: 'Europe/Berlin' } })
    await render({ enabled: true, user: { ...user, timezone: 'America/New_York' } })
    await act(async () =>
        history.resolve({ threads: [{ projectId: 'p1', chatId: 'anna_u1', created: 0 }], nextBefore: null })
    )
    expect(result.historyLoaded).toBe(true)
    expect(result.threads.map(thread => thread.chatId)).toEqual(['anna_u1', stored.chatId])
})
