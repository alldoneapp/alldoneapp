const mockGetIdToken = jest.fn()
const mockAuthState = { currentUser: null }
jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {
        auth: () => mockAuthState,
        app: () => ({ options: { projectId: 'test-project', apiKey: 'test-key' } }),
    },
}))

import {
    reportNewDayStatisticsError,
    STATISTICS_ERROR_REPORT_COOLDOWN_MS,
    STATISTICS_ERROR_REPORT_TIMEOUT_MS,
} from './reportNewDayStatisticsError'

const originalFetch = global.fetch
let context
let sequence = 0
const failure = Object.assign(new Error('Missing or insufficient permissions'), { code: 'PERMISSION_DENIED' })

beforeEach(() => {
    jest.useFakeTimers()
    mockGetIdToken.mockReset().mockResolvedValue('secret-token')
    mockAuthState.currentUser = { uid: 'u1', getIdToken: mockGetIdToken }
    global.fetch = jest.fn().mockResolvedValue({ ok: true })
    context = {
        userId: 'u1',
        projectId: `p${sequence++}`,
        statisticsDate: '08092026',
        stage: 'statistics-read',
        attempt: 2,
        elapsedMs: 560,
        connectionHealth: 'live',
        connectionState: 'online',
    }
})
afterEach(() => {
    jest.useRealTimers()
    global.fetch = originalFetch
})

it('persists a scoped failure through authenticated REST without using the SDK queue', async () => {
    expect(await reportNewDayStatisticsError(failure, context)).toBe(true)
    const [url, request] = global.fetch.mock.calls[0]
    expect(url).toBe(
        'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents/runtimeErrors?key=test-key'
    )
    expect(request.method).toBe('POST')
    expect(request.headers.Authorization).toBe('Bearer secret-token')
    const { fields } = JSON.parse(request.body)
    expect(fields).toMatchObject({
        source: { stringValue: 'new-day-statistics' },
        projectId: { stringValue: context.projectId },
        userId: { stringValue: 'u1' },
        statisticsDate: { stringValue: '08092026' },
        errorCode: { stringValue: 'PERMISSION_DENIED' },
        errorMessage: { stringValue: failure.message },
        stage: { stringValue: 'statistics-read' },
        attempt: { integerValue: '2' },
        elapsedMs: { integerValue: '560' },
        datetime: { integerValue: expect.any(String) },
    })
    expect(request.body).not.toContain('secret-token')
})

it('limits repeated taps while preserving different projects, errors, and later incidents', async () => {
    await Promise.all([reportNewDayStatisticsError(failure, context), reportNewDayStatisticsError(failure, context)])
    expect(global.fetch).toHaveBeenCalledTimes(1)
    await reportNewDayStatisticsError({ code: 'deadline-exceeded' }, context)
    await reportNewDayStatisticsError(failure, { ...context, projectId: 'another-project' })
    expect(global.fetch).toHaveBeenCalledTimes(3)
    await jest.advanceTimersByTimeAsync(STATISTICS_ERROR_REPORT_COOLDOWN_MS)
    await reportNewDayStatisticsError(failure, context)
    expect(global.fetch).toHaveBeenCalledTimes(4)
})

it.each(['token', 'fetch'])('bounds a stalled %s and does not send a late request', async stage => {
    let finishToken
    if (stage === 'token')
        mockGetIdToken.mockImplementation(
            () =>
                new Promise(resolve => {
                    finishToken = resolve
                })
        )
    else global.fetch.mockImplementation(() => new Promise(() => {}))
    const report = reportNewDayStatisticsError(failure, context)
    await jest.advanceTimersByTimeAsync(STATISTICS_ERROR_REPORT_TIMEOUT_MS)
    expect(await report).toBe(false)
    if (stage === 'token') {
        finishToken('late-token')
        await Promise.resolve()
        expect(global.fetch).not.toHaveBeenCalled()
    } else expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true)
})

it('does not report another account after an account switch during token refresh', async () => {
    let finishToken
    mockGetIdToken.mockImplementation(
        () =>
            new Promise(resolve => {
                finishToken = resolve
            })
    )
    const report = reportNewDayStatisticsError(failure, context)
    mockAuthState.currentUser = { uid: 'u2', getIdToken: mockGetIdToken }
    finishToken('token')
    expect(await report).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
})

it.each(['reject', 'http'])('contains %s reporting failures', async kind => {
    if (kind === 'reject') global.fetch.mockRejectedValue(new Error('Network failed'))
    else global.fetch.mockResolvedValue({ ok: false, status: 403 })
    expect(await reportNewDayStatisticsError(failure, context)).toBe(false)
})
