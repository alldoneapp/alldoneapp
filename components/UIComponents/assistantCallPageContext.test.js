import { createCallPageContextSync, readCallPageContext } from './assistantCallPageContext'

beforeEach(() => jest.useFakeTimers())
afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    window.history.replaceState({}, '', '/')
    document.title = ''
})

test('sends latest app navigation and title without query values, coalesces changes and skips unchanged pages', async () => {
    window.history.replaceState({}, '', '/projects/tasks')
    document.title = 'All projects'
    const publish = jest.fn(async () => ({ updated: true }))
    const sync = createCallPageContextSync({ sessionId: 'browser-one', initialContext: readCallPageContext(), publish })
    await jest.advanceTimersByTimeAsync(2000)
    expect(publish).not.toHaveBeenCalled()
    window.history.pushState({}, '', '/projects/p/tasks/one')
    window.history.replaceState({}, '', '/projects/p/notes/two/editor?token=secret#private')
    document.title = 'Plan for Sunday'
    await jest.advanceTimersByTimeAsync(500)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenLastCalledWith({
        sessionId: 'browser-one',
        sequence: 1,
        pageContext: { path: '/projects/p/notes/two/editor', title: 'Plan for Sunday' },
    })
    await jest.advanceTimersByTimeAsync(2000)
    expect(publish).toHaveBeenCalledTimes(1)
    sync.stop()
    window.history.pushState({}, '', '/settings')
    await jest.advanceTimersByTimeAsync(1000)
    expect(publish).toHaveBeenCalledTimes(1)
})

test('retries a failed update with the latest page and never overlaps pending writes', async () => {
    let resolve
    let context = { path: '/one', title: '' }
    const onError = jest.fn()
    const publish = jest
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementationOnce(
            () =>
                new Promise(r => {
                    resolve = r
                })
        )
        .mockResolvedValue({ updated: true })
    const sync = createCallPageContextSync({ sessionId: 'browser-one', read: () => context, publish, onError })
    await jest.advanceTimersByTimeAsync(500)
    expect(onError).toHaveBeenCalledTimes(1)
    context = { path: '/two', title: '' }
    await jest.advanceTimersByTimeAsync(2000)
    expect(publish).toHaveBeenCalledTimes(2)
    context = { path: '/three', title: '' }
    await jest.advanceTimersByTimeAsync(2500)
    expect(publish).toHaveBeenCalledTimes(2)
    resolve({ updated: true })
    await jest.advanceTimersByTimeAsync(500)
    expect(publish).toHaveBeenLastCalledWith({ sessionId: 'browser-one', sequence: 3, pageContext: context })
    sync.stop()
})
