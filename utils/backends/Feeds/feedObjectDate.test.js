import { getFeedObjectDate, getFeedObjectDateCandidates, readFeedObjectFromCandidates } from './feedObjectDate'

// 2026-09-27 22:01:07 UTC = 2026-09-28 00:01:07 Europe/Berlin. The production incident: a goal
// routing feed written by a Cloud Function (UTC) at that instant, read back by a Berlin browser.
const SERVER_MIDNIGHT_FEED_TIME = 1790546467082

const permissionDenied = () =>
    Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

describe('getFeedObjectDate', () => {
    it('prefers the day the unread counter recorded', () => {
        expect(getFeedObjectDate({ dateFormated: '27092026', lastChangeDate: SERVER_MIDNIGHT_FEED_TIME })).toBe(
            '27092026'
        )
    })

    it('falls back to the local day when the feed carries none', () => {
        expect(getFeedObjectDate({ lastChangeDate: Date.UTC(2026, 8, 20, 12) })).toBe('20092026')
    })

    it('ignores a malformed stored day', () => {
        expect(getFeedObjectDate({ dateFormated: 'yesterday', lastChangeDate: Date.UTC(2026, 8, 20, 12) })).toBe(
            '20092026'
        )
    })
})

describe('getFeedObjectDateCandidates', () => {
    it('adds the UTC day after the resolved one', () => {
        expect(getFeedObjectDateCandidates('28092026', SERVER_MIDNIGHT_FEED_TIME)).toEqual(['28092026', '27092026'])
    })

    it('reads once when both days agree', () => {
        expect(getFeedObjectDateCandidates('27092026', SERVER_MIDNIGHT_FEED_TIME)).toEqual(['27092026'])
    })
})

describe('readFeedObjectFromCandidates', () => {
    it('finds a server-written object under the UTC day after the local-day read is denied', async () => {
        const stored = { 27092026: { type: 'task', name: 'Meeting' } }
        const readAt = jest.fn(async date => {
            if (!stored[date]) throw permissionDenied()
            return stored[date]
        })

        const result = await readFeedObjectFromCandidates(['28092026', '27092026'], readAt)

        expect(result).toEqual({ object: stored['27092026'], date: '27092026' })
        expect(readAt).toHaveBeenCalledTimes(2)
    })

    it('stops at the first day that holds the object', async () => {
        const readAt = jest.fn(async () => ({ type: 'task' }))

        await readFeedObjectFromCandidates(['28092026', '27092026'], readAt)

        expect(readAt).toHaveBeenCalledTimes(1)
    })

    it('rethrows when every read failed, so a pending access projection is still retried', async () => {
        const readAt = jest.fn(async () => {
            throw permissionDenied()
        })

        await expect(readFeedObjectFromCandidates(['28092026', '27092026'], readAt)).rejects.toThrow(
            'Missing or insufficient permissions.'
        )
    })

    it('reports a missing object on the first day when a read answered cleanly', async () => {
        const readAt = jest.fn(async date => {
            if (date === '28092026') throw permissionDenied()
            return undefined
        })

        expect(await readFeedObjectFromCandidates(['28092026', '27092026'], readAt)).toEqual({
            object: null,
            date: '28092026',
        })
    })
})
