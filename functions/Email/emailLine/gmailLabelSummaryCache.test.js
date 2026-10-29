const {
    MAX_CACHED_SUMMARIES,
    SUMMARY_MAX_AGE_MS,
    buildLabelSummaryCacheKey,
    getCachedLabelSummary,
    resetLabelSummaryCacheForTests,
    runLabelSummaryOnce,
    storeLabelSummary,
} = require('./gmailLabelSummaryCache')

const summary = (threadCount = 3) => ({ labels: [{ labelId: 'INBOX', threadCount }], inboxUnread: 1 })

describe('gmailLabelSummaryCache', () => {
    beforeEach(() => resetLabelSummaryCacheForTests())

    test('keys on the user and the mailbox, ignoring the address case', () => {
        expect(buildLabelSummaryCacheKey('u1', 'Me@Example.com')).toBe(
            buildLabelSummaryCacheKey('u1', 'me@example.com')
        )
        expect(buildLabelSummaryCacheKey('u1', 'me@example.com')).not.toBe(
            buildLabelSummaryCacheKey('u2', 'me@example.com')
        )
    })

    test('answers only for the historyId it was computed at', () => {
        storeLabelSummary('k', '100', summary(), 1000)
        expect(getCachedLabelSummary('k', '100', 2000)).toEqual(summary())
        expect(getCachedLabelSummary('k', '101', 2000)).toBeNull()
        // A miss drops the entry, so an older historyId cannot come back either.
        expect(getCachedLabelSummary('k', '100', 2000)).toBeNull()
    })

    test('expires after the maximum age even without a mailbox change', () => {
        storeLabelSummary('k', '100', summary(), 0)
        expect(getCachedLabelSummary('k', '100', SUMMARY_MAX_AGE_MS - 1)).not.toBeNull()
        expect(getCachedLabelSummary('k', '100', SUMMARY_MAX_AGE_MS)).toBeNull()
    })

    test('keeps at most MAX_CACHED_SUMMARIES entries and drops the oldest first', () => {
        for (let i = 0; i <= MAX_CACHED_SUMMARIES; i++) storeLabelSummary(`k${i}`, '1', summary(), 0)
        expect(getCachedLabelSummary('k0', '1', 1)).toBeNull()
        expect(getCachedLabelSummary(`k${MAX_CACHED_SUMMARIES}`, '1', 1)).not.toBeNull()
    })

    test('runs one computation for concurrent callers and stores its result', async () => {
        let resolveCompute
        const pending = new Promise(resolve => {
            resolveCompute = resolve
        })
        const compute = jest.fn(() => pending)
        const first = runLabelSummaryOnce('k', '100', compute)
        const second = runLabelSummaryOnce('k', '100', compute)
        resolveCompute(summary(5))

        await expect(Promise.all([first, second])).resolves.toEqual([summary(5), summary(5)])
        expect(compute).toHaveBeenCalledTimes(1)
        expect(getCachedLabelSummary('k', '100')).toEqual(summary(5))
    })

    test('stores nothing for a failed computation and lets the next caller retry', async () => {
        await expect(runLabelSummaryOnce('k', '100', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
        expect(getCachedLabelSummary('k', '100')).toBeNull()

        const compute = jest.fn(() => Promise.resolve(summary()))
        await runLabelSummaryOnce('k', '100', compute)
        expect(compute).toHaveBeenCalledTimes(1)
    })
})
