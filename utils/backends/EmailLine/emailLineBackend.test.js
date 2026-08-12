const mockGetState = jest.fn()
const mockDispatch = jest.fn()
jest.mock('../../../redux/store', () => ({
    getState: (...args) => mockGetState(...args),
    dispatch: (...args) => mockDispatch(...args),
}))

jest.mock('../../../redux/actions', () => ({
    setEmailLineSummary: jest.fn((key, summary) => ({ type: 'SET_EMAIL_LINE_SUMMARY', key, summary })),
    setEmailLineLoading: jest.fn((key, loading) => ({ type: 'SET_EMAIL_LINE_LOADING', key, loading })),
}))

const mockRunHttpsCallableFunction = jest.fn()
jest.mock('../firestore', () => ({
    runHttpsCallableFunction: (...args) => mockRunHttpsCallableFunction(...args),
}))

jest.mock('../../IntegrationProviders', () => ({
    buildConnectionKeyPayload: jest.fn(key => ({ connectionId: key })),
}))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: jest.fn(key => key),
}))

const {
    listEmailLineMessages,
    performEmailLineAction,
    performEmailLineSweepInBackground,
    isEmailAuthExpiredError,
    reconcileEmailLineLabelCount,
} = require('./emailLineBackend')

// Shape of the callable rejection: the server maps EmailLineAuthError to a
// `failed-precondition` HttpsError whose message carries the code.
const authExpiredRejection = () =>
    Object.assign(new Error('failed-precondition: EMAIL_AUTH_EXPIRED'), { code: 'functions/failed-precondition' })

const summaryWithLabel = {
    provider: 'google',
    labels: [
        { labelId: 'L1', displayName: 'Ads', threadCount: 5, unreadCount: 3 },
        { labelId: 'L2', displayName: 'Other', threadCount: 2, unreadCount: 1 },
    ],
}

describe('performEmailLineSweepInBackground', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGetState.mockReturnValue({ emailLineSummaryByProject: { c1: summaryWithLabel } })
    })

    it('optimistically zeroes the label, loops while remaining, then refreshes the summary', async () => {
        mockRunHttpsCallableFunction.mockImplementation(async name => {
            if (name === 'emailLineActionSecondGen') {
                const sweepCalls = mockRunHttpsCallableFunction.mock.calls.filter(
                    call => call[0] === 'emailLineActionSecondGen'
                ).length
                return { processed: 500, remaining: sweepCalls < 2 }
            }
            return { labels: [] } // summary refresh
        })

        await performEmailLineSweepInBackground('c1', 'L1', 'archiveAll')

        // Optimistic patch: swept label zeroed + flagged, other labels untouched.
        const optimistic = mockDispatch.mock.calls[0][0]
        expect(optimistic.type).toBe('SET_EMAIL_LINE_SUMMARY')
        const patched = optimistic.summary.labels.find(label => label.labelId === 'L1')
        expect(patched).toEqual(expect.objectContaining({ sweeping: true, threadCount: 0, unreadCount: 0 }))
        expect(optimistic.summary.labels.find(label => label.labelId === 'L2').threadCount).toBe(2)

        // Two sweep rounds (first reported remaining), then exactly one summary refresh.
        const calls = mockRunHttpsCallableFunction.mock.calls.map(call => call[0])
        expect(calls.filter(name => name === 'emailLineActionSecondGen')).toHaveLength(2)
        expect(calls.filter(name => name === 'getEmailLineSummarySecondGen')).toHaveLength(1)
    })

    it('markAllRead keeps the thread count and only zeroes unread', async () => {
        mockRunHttpsCallableFunction.mockResolvedValue({ processed: 1, remaining: false })

        await performEmailLineSweepInBackground('c1', 'L1', 'markAllRead')

        const patched = mockDispatch.mock.calls[0][0].summary.labels.find(label => label.labelId === 'L1')
        expect(patched).toEqual(expect.objectContaining({ sweeping: true, threadCount: 5, unreadCount: 0 }))
    })

    it('still refreshes the summary when the sweep call fails', async () => {
        mockRunHttpsCallableFunction.mockImplementation(async name => {
            if (name === 'emailLineActionSecondGen') throw new Error('boom')
            return { labels: [] }
        })

        await performEmailLineSweepInBackground('c1', 'L1', 'archiveAll')

        const calls = mockRunHttpsCallableFunction.mock.calls.map(call => call[0])
        expect(calls.filter(name => name === 'getEmailLineSummarySecondGen')).toHaveLength(1)
    })

    it('does nothing without a key, label, or action', async () => {
        await performEmailLineSweepInBackground('', 'L1', 'archiveAll')
        await performEmailLineSweepInBackground('c1', '', 'archiveAll')
        await performEmailLineSweepInBackground('c1', 'L1', '')
        expect(mockRunHttpsCallableFunction).not.toHaveBeenCalled()
        expect(mockDispatch).not.toHaveBeenCalled()
    })
})

// AT-2195: archiving an email task rejected with the bare code EMAIL_AUTH_EXPIRED, which
// callers put straight into an alert(). By the time this reaches the client the server has
// already force-refreshed and retried, so it genuinely means "reconnect required".
describe('performEmailLineAction auth expiry (AT-2195)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGetState.mockReturnValue({ emailLineSummaryByProject: { c1: summaryWithLabel } })
    })

    it('archives normally and refreshes the summary when the connection is healthy', async () => {
        mockRunHttpsCallableFunction.mockImplementation(async name =>
            name === 'emailLineActionSecondGen' ? { processed: 1 } : { labels: [] }
        )

        await expect(performEmailLineAction('c1', { action: 'archive', messageIds: ['m1'] })).resolves.toEqual({
            processed: 1,
        })

        const calls = mockRunHttpsCallableFunction.mock.calls.map(call => call[0])
        expect(calls).toContain('getEmailLineSummarySecondGen')
    })

    it('replaces the raw error code with an actionable message', async () => {
        mockRunHttpsCallableFunction.mockRejectedValue(authExpiredRejection())

        const error = await performEmailLineAction('c1', { action: 'archive', messageIds: ['m1'] }).catch(
            caught => caught
        )

        expect(error.code).toBe('EMAIL_AUTH_EXPIRED')
        expect(error.authExpired).toBe(true)
        // Callers alert error.message; it must not be the bare code any more.
        expect(error.message).not.toContain('EMAIL_AUTH_EXPIRED')
        expect(error.message).toBe('Your email connection expired. Please reconnect it in Settings > Integrations.')
    })

    it('flags the cached summary so the reconnect state appears', async () => {
        mockRunHttpsCallableFunction.mockRejectedValue(authExpiredRejection())

        await performEmailLineAction('c1', { action: 'archive', messageIds: ['m1'] }).catch(() => {})

        const summaryDispatch = mockDispatch.mock.calls
            .map(call => call[0])
            .find(action => action.type === 'SET_EMAIL_LINE_SUMMARY')
        expect(summaryDispatch.key).toBe('c1')
        expect(summaryDispatch.summary.authExpired).toBe(true)
    })

    it('does not force a summary refresh through the dead connection', async () => {
        mockRunHttpsCallableFunction.mockRejectedValue(authExpiredRejection())

        await performEmailLineAction('c1', { action: 'archive', messageIds: ['m1'] }).catch(() => {})

        const calls = mockRunHttpsCallableFunction.mock.calls.map(call => call[0])
        expect(calls).not.toContain('getEmailLineSummarySecondGen')
    })

    it('leaves any other failure untouched so real errors stay diagnosable', async () => {
        mockRunHttpsCallableFunction.mockRejectedValue(new Error('unavailable'))

        await expect(performEmailLineAction('c1', { action: 'archive', messageIds: ['m1'] })).rejects.toThrow(
            'unavailable'
        )
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('flags the summary when a background sweep hits a dead connection', async () => {
        mockRunHttpsCallableFunction.mockImplementation(async name => {
            if (name === 'emailLineActionSecondGen') throw authExpiredRejection()
            return { labels: [] }
        })

        await performEmailLineSweepInBackground('c1', 'L1', 'archiveAll')

        const flagged = mockDispatch.mock.calls
            .map(call => call[0])
            .some(action => action.type === 'SET_EMAIL_LINE_SUMMARY' && action.summary.authExpired === true)
        expect(flagged).toBe(true)
    })

    it('detects the code only in genuine auth failures', () => {
        expect(isEmailAuthExpiredError(authExpiredRejection())).toBe(true)
        expect(isEmailAuthExpiredError(new Error('unavailable'))).toBe(false)
        expect(isEmailAuthExpiredError(null)).toBe(false)
    })
})

describe('listEmailLineMessages', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('coalesces matching in-flight label requests', async () => {
        let resolveRequest
        mockRunHttpsCallableFunction.mockReturnValueOnce(new Promise(resolve => (resolveRequest = resolve)))

        const first = listEmailLineMessages('c1', 'L1')
        const second = listEmailLineMessages('c1', 'L1')
        expect(mockRunHttpsCallableFunction).toHaveBeenCalledTimes(1)

        resolveRequest({ messages: [{ messageId: 'm1' }], nextPageToken: null })
        await expect(Promise.all([first, second])).resolves.toEqual([
            { messages: [{ messageId: 'm1' }], nextPageToken: null },
            { messages: [{ messageId: 'm1' }], nextPageToken: null },
        ])
    })

    it('does not coalesce different labels', async () => {
        mockRunHttpsCallableFunction.mockResolvedValue({ messages: [] })

        await Promise.all([listEmailLineMessages('c1', 'L1'), listEmailLineMessages('c1', 'L2')])

        expect(mockRunHttpsCallableFunction).toHaveBeenCalledTimes(2)
    })
})

describe('reconcileEmailLineLabelCount', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGetState.mockReturnValue({ emailLineSummaryByProject: { c1: summaryWithLabel } })
    })

    it('updates only the matching label count in the Redux summary', () => {
        expect(reconcileEmailLineLabelCount('c1', 'L1', 2)).toBe(true)

        const action = mockDispatch.mock.calls[0][0]
        expect(action.key).toBe('c1')
        expect(action.summary.labels).toEqual([
            { labelId: 'L1', displayName: 'Ads', threadCount: 2, unreadCount: 3 },
            summaryWithLabel.labels[1],
        ])
        expect(action.summary.provider).toBe('google')
    })

    it('accepts zero but ignores missing, unchanged, and invalid counts', () => {
        expect(reconcileEmailLineLabelCount('c1', 'L1', 0)).toBe(true)
        expect(reconcileEmailLineLabelCount('c1', 'missing', 1)).toBe(false)
        expect(reconcileEmailLineLabelCount('c1', 'L1', 5)).toBe(false)
        expect(reconcileEmailLineLabelCount('c1', 'L1', Number.NaN)).toBe(false)
        expect(mockDispatch).toHaveBeenCalledTimes(1)
    })
})
