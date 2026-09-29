import { keepScreenAwake } from './screenWakeLock'

const originalWakeLock = navigator.wakeLock
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
let visibility
let locks
let request
let releases

const flush = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
}

beforeEach(() => {
    visibility = 'visible'
    locks = []
    releases = []
    request = jest.fn(async () => {
        const lock = {
            release: jest.fn(async () => {}),
            addEventListener: jest.fn(),
        }
        locks.push(lock)
        return lock
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
})

afterEach(() => {
    releases.forEach(release => release())
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility)
    if (originalWakeLock === undefined) delete navigator.wakeLock
    else Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: originalWakeLock })
})

const keep = () => {
    const release = keepScreenAwake()
    releases.push(release)
    return release
}

test('one lock serves overlapping microphone users and releases after the last stops', async () => {
    const stopCall = keep()
    const stopDictation = keep()
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
    stopDictation()
    expect(locks[0].release).not.toHaveBeenCalled()
    stopCall()
    stopCall()
    expect(locks[0].release).toHaveBeenCalledTimes(1)
})

test('releases on hide and requests again on return only while recording is active', async () => {
    const stop = keep()
    await flush()
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(locks[0].release).toHaveBeenCalledTimes(1)
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    stop()
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(request).toHaveBeenCalledTimes(2)
})

test('releases a request that resolves after recording stopped', async () => {
    let resolveRequest
    request.mockImplementationOnce(() => new Promise(resolve => (resolveRequest = resolve)))
    const stop = keep()
    await flush()
    stop()
    const lateLock = { release: jest.fn(async () => {}), addEventListener: jest.fn() }
    resolveRequest(lateLock)
    await flush()
    expect(lateLock.release).toHaveBeenCalledTimes(1)
})

test('a new recording still gets a lock after the previous pending request becomes stale', async () => {
    let resolveRequest
    request.mockImplementationOnce(() => new Promise(resolve => (resolveRequest = resolve)))
    const stopFirst = keep()
    await flush()
    stopFirst()
    const stopSecond = keep()
    expect(request).toHaveBeenCalledTimes(1)

    const staleLock = { release: jest.fn(async () => {}), addEventListener: jest.fn() }
    resolveRequest(staleLock)
    await flush()
    expect(staleLock.release).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(2)
    await new Promise(resolve => setTimeout(resolve, 0))
    stopSecond()
    expect(locks[0].release).toHaveBeenCalledTimes(1)
})

test('unsupported and denied wake locks do not interrupt recording', async () => {
    delete navigator.wakeLock
    expect(() => keep()()).not.toThrow()
    Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
            request: jest.fn(async () => {
                throw new Error('denied')
            }),
        },
    })
    const stop = keep()
    await flush()
    expect(() => stop()).not.toThrow()
})
