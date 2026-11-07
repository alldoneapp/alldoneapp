jest.mock('../../../utils/backends/KnowledgeBase/knowledgeBaseFirestore', () => ({
    getKnowledgeRunsStartedBefore: jest.fn(),
}))

import { getKnowledgeRunsStartedBefore } from '../../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import { clearWikiDayCosts, getWikiDayBounds, loadWikiDayCost, summarizeWikiDayCost } from './wikiDayCost'

const DAY = getWikiDayBounds('20261024')
const at = (hour, minute = 0) => DAY.start + (hour * 60 + minute) * 60 * 1000

beforeEach(() => {
    jest.clearAllMocks()
    clearWikiDayCosts()
})

describe('what the wiki cost on one day', () => {
    it('adds up every run that worked during the day, once each', () => {
        expect(
            summarizeWikiDayCost(
                [
                    { startedAt: at(3), finishedAt: at(3, 10), goldSpent: 12 },
                    { startedAt: at(14), finishedAt: at(14, 2), goldSpent: 3.4 },
                    // Started before midnight, finished after it: it worked on this day too.
                    { startedAt: at(-1), finishedAt: at(0, 5), goldSpent: 5 },
                ],
                DAY
            )
        ).toEqual({ gold: 20, runCount: 3, running: false })
    })

    it('leaves out runs of other days and counts a running one without a cost yet', () => {
        expect(
            summarizeWikiDayCost(
                [
                    { startedAt: at(-20), finishedAt: at(-19), goldSpent: 40 },
                    { startedAt: at(24), finishedAt: at(24, 5), goldSpent: 7 },
                    { startedAt: at(22), status: 'running', goldSpent: 99 },
                    { startedAt: 'yesterday', goldSpent: 1 },
                    { startedAt: at(4), finishedAt: at(4, 1), goldSpent: 'many' },
                ],
                DAY
            )
        ).toEqual({ gold: 0, runCount: 2, running: true })
    })

    it('reads the runs once a minute per card day, and answers null when it cannot', async () => {
        getKnowledgeRunsStartedBefore.mockResolvedValue([{ startedAt: at(3), finishedAt: at(3, 1), goldSpent: 8 }])

        const now = at(30)
        await expect(loadWikiDayCost('p1', '20261024', now)).resolves.toEqual({ gold: 8, runCount: 1, running: false })
        await loadWikiDayCost('p1', '20261024', now + 1000)
        expect(getKnowledgeRunsStartedBefore).toHaveBeenCalledTimes(1)
        expect(getKnowledgeRunsStartedBefore).toHaveBeenCalledWith('p1', DAY.end)

        getKnowledgeRunsStartedBefore.mockRejectedValue(new Error('offline'))
        await expect(loadWikiDayCost('p1', '20261024', now + 61 * 1000)).resolves.toBeNull()
        await expect(loadWikiDayCost('p1', 'not-a-day', now)).resolves.toBeNull()
    })
})
