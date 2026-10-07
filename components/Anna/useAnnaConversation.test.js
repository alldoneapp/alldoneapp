import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import useAnnaConversation from './useAnnaConversation'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
const mockSnapshots = new Map()
jest.mock('../../utils/backends/firestore', () => ({
    runHttpsCallableFunction: jest.fn(),
    getDb: () => ({
        doc: path => ({
            onSnapshot: callback => {
                mockSnapshots.set(path, callback)
                callback({ exists: true, data: () => ({ isPublicFor: [0] }) })
                return () => mockSnapshots.delete(path)
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
    result = useAnnaConversation('u1', props)
    return null
}
const render = async props => act(async () => root.render(<Harness {...props} />))
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.useFakeTimers()
    runHttpsCallableFunction.mockReset()
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
