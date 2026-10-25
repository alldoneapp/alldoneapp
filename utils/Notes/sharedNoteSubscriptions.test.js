import { createSharedNoteSubscriptions, readSharedTask } from './sharedNoteSubscriptions'

it('shares a listener, replays its current value and releases only after the last consumer', () => {
    const subscribe = createSharedNoteSubscriptions()
    let emit
    const start = jest.fn(callback => {
        emit = callback
        return 'watcher'
    })
    const stop = jest.fn()
    const first = jest.fn()
    const second = jest.fn()
    const releaseFirst = subscribe('tasks/user/project/note', start, stop, first)
    emit({ task: 'first' })
    const releaseSecond = subscribe('tasks/user/project/note', start, stop, second)
    expect(second).toHaveBeenCalledWith({ task: 'first' })
    emit({ task: 'changed' })
    expect(start).toHaveBeenCalledTimes(1)
    releaseFirst()
    releaseFirst()
    expect(stop).not.toHaveBeenCalled()
    releaseSecond()
    expect(stop).toHaveBeenCalledWith('watcher')
    const third = jest.fn()
    subscribe('tasks/user/project/note', start, stop, third)()
    expect(start).toHaveBeenCalledTimes(2)
    expect(third).not.toHaveBeenCalled()
})
it('isolates projects and access readers', () => {
    const subscribe = createSharedNoteSubscriptions()
    const start = jest.fn(() => 'watcher')
    const stop = jest.fn()
    const release = ['u1/p1/t1', 'u2/p1/t1', 'u1/p2/t1'].map(key => subscribe(key, start, stop, jest.fn()))
    expect(start).toHaveBeenCalledTimes(3)
    release.forEach(fn => fn())
    expect(stop).toHaveBeenCalledTimes(3)
})
it('coalesces repeated task recovery reads, without retaining stale data', async () => {
    let resolve
    const load = jest.fn(
        () =>
            new Promise(r => {
                resolve = r
            })
    )
    const first = readSharedTask(load, 'p', 't')
    const second = readSharedTask(load, 'p', 't')
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
    resolve({ id: 't' })
    expect(await first).toEqual(await second)
    const third = readSharedTask(load, 'p', 't')
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(2)
    resolve(null)
    await third
})
