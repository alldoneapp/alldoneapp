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

const { performEmailLineSweepInBackground } = require('./emailLineBackend')

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
