jest.mock('./meetingReviewBackend', () => ({
    getMeetingReviewDocId: id => id,
    saveMeetingReview: jest.fn(() => Promise.resolve()),
    restoreMeetingReview: jest.fn(() => Promise.resolve()),
    saveMeetingSeriesCategory: jest.fn(() => Promise.resolve()),
    restoreMeetingSeriesCategory: jest.fn(() => Promise.resolve()),
    saveMeetingCategoryRule: jest.fn(() => Promise.resolve()),
    deleteMeetingCategoryRule: jest.fn(() => Promise.resolve()),
    watchMeetingReviewsInRange: jest.fn(() => () => {}),
    watchMeetingSeriesCategories: jest.fn(() => () => {}),
    watchMeetingCategoryRules: jest.fn(() => () => {}),
}))
jest.mock('../../redux/store', () => ({ getState: () => ({ loggedUser: { uid: 'me' } }) }))

import {
    deleteMeetingCategoryRule,
    restoreMeetingReview,
    restoreMeetingSeriesCategory,
    saveMeetingCategoryRule,
    saveMeetingReview,
    saveMeetingSeriesCategory,
} from './meetingReviewBackend'
import { applyMeetingReviewAction, isRatableMeetingTask } from './meetingReviewActions'
import {
    getMeetingReviewState,
    requestMeetingReview,
    resetMeetingReviewStoreForTests,
    setMeetingReviewState,
    finishCurrentMeetingReview,
    startMeetingReviewQueueMode,
} from './meetingReviewStore'
import { offerMeetingReviewAfterCompletion } from './offerMeetingReview'

const NOW = Date.UTC(2026, 10, 24, 12)
const weekly = {
    id: 'evt-weekly',
    projectId: 'p1',
    userId: 'me',
    name: 'Weekly Sync Produkt',
    calendarData: {
        recurringEventId: 'series-1',
        startMs: Date.UTC(2026, 10, 24, 8, 30),
        endMs: Date.UTC(2026, 10, 24, 9, 30),
        attendeeCount: 8,
    },
}
const single = {
    id: 'evt-single',
    projectId: 'p1',
    userId: 'me',
    name: 'Abstimmung Q1',
    calendarData: { startMs: Date.UTC(2026, 10, 24, 13), endMs: Date.UTC(2026, 10, 24, 14), attendeeCount: 4 },
}

beforeEach(() => {
    jest.clearAllMocks()
    resetMeetingReviewStoreForTests()
})

describe('isRatableMeetingTask', () => {
    it('is true only for the calendar owner and countable appointments', () => {
        expect(isRatableMeetingTask(weekly, 'me')).toBe(true)
        expect(isRatableMeetingTask(weekly, 'colleague')).toBe(false)
        expect(
            isRatableMeetingTask(
                { ...weekly, calendarData: { start: { date: '2026-11-24' }, end: { date: '2026-11-25' } } },
                'me'
            )
        ).toBe(false)
        expect(
            isRatableMeetingTask(
                { ...weekly, calendarData: { ...weekly.calendarData, selfResponseStatus: 'declined' } },
                'me'
            )
        ).toBe(false)
        expect(isRatableMeetingTask({ ...weekly, calendarData: null }, 'me')).toBe(false)
    })
})

describe('applyMeetingReviewAction', () => {
    it('one tap: saves the usefulness and confirms the preselected category, never touching the series', async () => {
        const { review } = await applyMeetingReviewAction({
            uid: 'me',
            task: weekly,
            action: { type: 'rate', usefulness: 'not_helpful' },
            nowMs: NOW,
        })
        expect(saveMeetingReview).toHaveBeenCalledWith(
            'me',
            'evt-weekly',
            expect.objectContaining({ usefulness: 'not_helpful', category: 'status', categorySource: 'user' })
        )
        expect(saveMeetingSeriesCategory).not.toHaveBeenCalled()
        expect(getMeetingReviewState().reviews['evt-weekly']).toMatchObject({ usefulness: 'not_helpful' })
        expect(review.reviewStatus).toBe('rated')
    })

    it('a category for the series is stored as series default; the usefulness never is', async () => {
        await applyMeetingReviewAction({
            uid: 'me',
            task: weekly,
            action: { type: 'rate', usefulness: 'worthwhile', category: 'work' },
            scope: 'series',
            nowMs: NOW,
        })
        expect(saveMeetingSeriesCategory).toHaveBeenCalledWith('me', 'series-1', 'work', NOW)
        expect(JSON.stringify(saveMeetingSeriesCategory.mock.calls)).not.toMatch(/worthwhile/)
        // a series learns through its default, not through a title rule
        expect(saveMeetingCategoryRule).not.toHaveBeenCalled()

        // the next occurrence gets the series default as a suggestion, but no usefulness
        const next = { ...weekly, id: 'evt-weekly-2' }
        const state = getMeetingReviewState()
        const { resolveTaskMeetingCategory, getStoredReview } = require('./meetingReviewActions')
        expect(resolveTaskMeetingCategory(next, state)).toMatchObject({
            category: 'work',
            source: 'series',
            confirmed: false,
        })
        expect(getStoredReview(next, state)).toBeNull()
    })

    it('an exception for one occurrence leaves the series default alone', async () => {
        setMeetingReviewState({ seriesCategories: { 'series-1': { seriesId: 'series-1', category: 'status' } } })
        await applyMeetingReviewAction({
            uid: 'me',
            task: weekly,
            action: { type: 'rate', usefulness: 'worthwhile', category: 'learning' },
            scope: 'instance',
            nowMs: NOW,
        })
        expect(saveMeetingSeriesCategory).not.toHaveBeenCalled()
        expect(saveMeetingReview).toHaveBeenCalledWith(
            'me',
            'evt-weekly',
            expect.objectContaining({ category: 'learning' })
        )
    })

    it('AT-3147: a series default saved as "stakeholder" is read and suggested as "status"', async () => {
        setMeetingReviewState({ seriesCategories: { 'series-1': { seriesId: 'series-1', category: 'stakeholder' } } })
        const { resolveTaskMeetingCategory } = require('./meetingReviewActions')
        expect(resolveTaskMeetingCategory(weekly, getMeetingReviewState())).toMatchObject({
            category: 'status',
            source: 'series',
            preselected: true,
        })
        // one tap confirms it under the current key; the legacy series default is not rewritten
        await applyMeetingReviewAction({
            uid: 'me',
            task: weekly,
            action: { type: 'rate', usefulness: 'partly' },
            nowMs: NOW,
        })
        expect(saveMeetingSeriesCategory).not.toHaveBeenCalled()
        expect(saveMeetingReview).toHaveBeenCalledWith(
            'me',
            'evt-weekly',
            expect.objectContaining({ category: 'status', categoryConfirmedFrom: 'series' })
        )
    })

    it('a correction of a single appointment becomes a visible rule; undo restores everything', async () => {
        const { undo } = await applyMeetingReviewAction({
            uid: 'me',
            task: single,
            action: { type: 'rate', usefulness: 'partly', category: 'work' },
            nowMs: NOW,
        })
        expect(saveMeetingCategoryRule).toHaveBeenCalledWith(
            'me',
            expect.objectContaining({ pattern: 'abstimmung q', category: 'work', corrections: 1 })
        )
        expect(getMeetingReviewState().rules).toHaveLength(1)

        await undo()
        expect(restoreMeetingReview).toHaveBeenCalledWith('me', 'evt-single', null)
        expect(deleteMeetingCategoryRule).toHaveBeenCalledWith('me', 'abstimmung q')
        expect(getMeetingReviewState().rules).toHaveLength(0)
        expect(getMeetingReviewState().reviews['evt-single']).toBeUndefined()
    })

    it('persists a duration change made in the sheet together with the rating', async () => {
        await applyMeetingReviewAction({
            uid: 'me',
            task: single,
            action: { type: 'rate', usefulness: 'worthwhile' },
            duration: {
                actualStartMs: single.calendarData.startMs,
                actualEndMs: single.calendarData.startMs + 30 * 60000,
            },
            nowMs: NOW,
        })
        expect(saveMeetingReview.mock.calls[0][2]).toMatchObject({
            usefulness: 'worthwhile',
            actualStartMs: single.calendarData.startMs,
            actualEndMs: single.calendarData.startMs + 30 * 60000,
        })
    })

    it('rolls the local state back when the write fails', async () => {
        saveMeetingReview.mockRejectedValueOnce(new Error('denied'))
        await expect(
            applyMeetingReviewAction({
                uid: 'me',
                task: single,
                action: { type: 'rate', usefulness: 'partly' },
                nowMs: NOW,
            })
        ).rejects.toThrow('denied')
        expect(getMeetingReviewState().reviews['evt-single']).toBeUndefined()
        expect(restoreMeetingSeriesCategory).not.toHaveBeenCalled()
    })
})

describe('offerMeetingReviewAfterCompletion', () => {
    it('queues the sheet for the owner of a countable calendar task', () => {
        expect(offerMeetingReviewAfterCompletion(weekly, 'p1')).toBe(true)
        expect(getMeetingReviewState().queue.map(item => item.task.id)).toEqual(['evt-weekly'])
        expect(getMeetingReviewState().queue[0].task.done).toBe(true)
    })

    it("does not ask for somebody else's meeting, an all-day event or an already rated one", () => {
        expect(offerMeetingReviewAfterCompletion({ ...weekly, userId: 'colleague' }, 'p1')).toBe(false)
        expect(
            offerMeetingReviewAfterCompletion(
                { ...weekly, calendarData: { start: { date: '2026-11-24' }, end: { date: '2026-11-25' } } },
                'p1'
            )
        ).toBe(false)
        setMeetingReviewState({ reviews: { 'evt-weekly': { reviewStatus: 'skipped' } } })
        expect(offerMeetingReviewAfterCompletion(weekly, 'p1')).toBe(false)
        expect(getMeetingReviewState().queue).toEqual([])
    })

    it('mass completion: the latest is shown; "+N more" walks through the others', () => {
        offerMeetingReviewAfterCompletion(weekly, 'p1')
        offerMeetingReviewAfterCompletion(single, 'p1')
        expect(getMeetingReviewState().queue.map(item => item.task.id)).toEqual(['evt-weekly', 'evt-single'])
        startMeetingReviewQueueMode()
        finishCurrentMeetingReview()
        expect(getMeetingReviewState().queue.map(item => item.task.id)).toEqual(['evt-weekly'])
        finishCurrentMeetingReview()
        expect(getMeetingReviewState().queue).toEqual([])
    })

    it('closing without queue mode leaves the others unrated and does not ask again now', () => {
        requestMeetingReview({ task: weekly, projectId: 'p1' })
        requestMeetingReview({ task: single, projectId: 'p1' })
        finishCurrentMeetingReview()
        expect(getMeetingReviewState().queue).toEqual([])
    })
})
