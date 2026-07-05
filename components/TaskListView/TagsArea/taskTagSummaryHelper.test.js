import { shouldSummarizeTaskTags } from './taskTagSummaryHelper'

const shouldSummarize = overrides =>
    shouldSummarizeTaskTags({
        amountTags: 0,
        inMyDayAndNotSubtask: false,
        showSummarizeTagInByTime: false,
        isCalendarTask: false,
        hasPriorityTag: false,
        tablet: false,
        isMobile: false,
        ...overrides,
    })

describe('shouldSummarizeTaskTags', () => {
    it('summarizes calendar tasks one tag earlier in My Day', () => {
        expect(shouldSummarize({ amountTags: 3, inMyDayAndNotSubtask: true, isCalendarTask: true })).toBe(true)
        expect(shouldSummarize({ amountTags: 2, inMyDayAndNotSubtask: true, isCalendarTask: true })).toBe(false)
        expect(shouldSummarize({ amountTags: 3, inMyDayAndNotSubtask: true })).toBe(false)
    })

    it('keeps measured overflow as the My Day fallback', () => {
        expect(
            shouldSummarize({
                amountTags: 1,
                inMyDayAndNotSubtask: true,
                showSummarizeTagInByTime: true,
            })
        ).toBe(true)
    })

    it('summarizes calendar tasks one tag earlier outside My Day', () => {
        expect(shouldSummarize({ amountTags: 5, isCalendarTask: true })).toBe(true)
        expect(shouldSummarize({ amountTags: 4, isCalendarTask: true })).toBe(false)
        expect(shouldSummarize({ amountTags: 5 })).toBe(false)
    })

    it('uses the earlier compact-layout limit for calendar tasks in My Day', () => {
        expect(
            shouldSummarize({
                amountTags: 1,
                inMyDayAndNotSubtask: true,
                isCalendarTask: true,
                tablet: true,
            })
        ).toBe(true)
    })

    it('summarizes priority-tagged tasks one tag earlier outside My Day', () => {
        expect(shouldSummarize({ amountTags: 5, hasPriorityTag: true })).toBe(true)
        expect(shouldSummarize({ amountTags: 4, hasPriorityTag: true })).toBe(false)
        expect(shouldSummarize({ amountTags: 2, hasPriorityTag: true, isMobile: true })).toBe(true)
        expect(shouldSummarize({ amountTags: 2, isMobile: true })).toBe(false)
    })

    it('summarizes priority-tagged tasks one tag earlier in My Day', () => {
        expect(shouldSummarize({ amountTags: 3, inMyDayAndNotSubtask: true, hasPriorityTag: true })).toBe(true)
        expect(shouldSummarize({ amountTags: 2, inMyDayAndNotSubtask: true, hasPriorityTag: true })).toBe(false)
        expect(
            shouldSummarize({ amountTags: 1, inMyDayAndNotSubtask: true, hasPriorityTag: true, isMobile: true })
        ).toBe(true)
        expect(shouldSummarize({ amountTags: 1, inMyDayAndNotSubtask: true, isMobile: true })).toBe(false)
    })

    it('stacks the calendar and priority offsets', () => {
        expect(shouldSummarize({ amountTags: 4, isCalendarTask: true, hasPriorityTag: true })).toBe(true)
        expect(shouldSummarize({ amountTags: 3, isCalendarTask: true, hasPriorityTag: true })).toBe(false)
        expect(shouldSummarize({ amountTags: 1, isCalendarTask: true, hasPriorityTag: true, isMobile: true })).toBe(
            true
        )
    })
})
