import { doTrailingTagsCrowdTaskTitle, shouldSummarizeTaskTags } from './taskTagSummaryHelper'

const shouldSummarize = overrides =>
    shouldSummarizeTaskTags({
        amountTags: 0,
        inMyDayAndNotSubtask: false,
        showSummarizeTagInByTime: false,
        isCalendarTask: false,
        hasPriorityTag: false,
        trailingTagsCrowdTitle: false,
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

    it('summarizes plain tasks past the desktop limit', () => {
        expect(shouldSummarize({ amountTags: 5 })).toBe(true)
        expect(shouldSummarize({ amountTags: 4 })).toBe(false)
    })

    it('summarizes a small number of wide tags before they crowd out the title', () => {
        expect(shouldSummarize({ amountTags: 3, trailingTagsCrowdTitle: true })).toBe(true)
        expect(shouldSummarize({ amountTags: 1, trailingTagsCrowdTitle: true })).toBe(true)
        expect(shouldSummarize({ amountTags: 0, trailingTagsCrowdTitle: true })).toBe(false)
    })

    it('summarizes calendar tasks one tag earlier outside My Day', () => {
        expect(shouldSummarize({ amountTags: 4, isCalendarTask: true })).toBe(true)
        expect(shouldSummarize({ amountTags: 3, isCalendarTask: true })).toBe(false)
        expect(shouldSummarize({ amountTags: 4 })).toBe(false)
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
        expect(shouldSummarize({ amountTags: 4, hasPriorityTag: true })).toBe(true)
        expect(shouldSummarize({ amountTags: 3, hasPriorityTag: true })).toBe(false)
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
        expect(shouldSummarize({ amountTags: 3, isCalendarTask: true, hasPriorityTag: true })).toBe(true)
        expect(shouldSummarize({ amountTags: 2, isCalendarTask: true, hasPriorityTag: true })).toBe(false)
        expect(shouldSummarize({ amountTags: 1, isCalendarTask: true, hasPriorityTag: true, isMobile: true })).toBe(
            true
        )
    })
})

describe('doTrailingTagsCrowdTaskTitle', () => {
    it('collapses single-line task tags only above 70% of the available width', () => {
        expect(
            doTrailingTagsCrowdTaskTitle({
                taskTagsWidth: 420,
                taskItemWidth: 600,
                taskTitleIsMultiline: false,
            })
        ).toBe(false)
        expect(
            doTrailingTagsCrowdTaskTitle({
                taskTagsWidth: 421,
                taskItemWidth: 600,
                taskTitleIsMultiline: false,
            })
        ).toBe(true)
    })

    it('allows multi-line task tags to fill the available width', () => {
        expect(
            doTrailingTagsCrowdTaskTitle({
                taskTagsWidth: 421,
                taskItemWidth: 600,
                taskTitleIsMultiline: true,
            })
        ).toBe(false)
        expect(
            doTrailingTagsCrowdTaskTitle({
                taskTagsWidth: 600,
                taskItemWidth: 600,
                taskTitleIsMultiline: true,
            })
        ).toBe(false)
    })

    it('still collapses multi-line task tags that overflow the available width', () => {
        expect(
            doTrailingTagsCrowdTaskTitle({
                taskTagsWidth: 601,
                taskItemWidth: 600,
                taskTitleIsMultiline: true,
            })
        ).toBe(true)
    })

    it('waits for valid measurements and leaves the My Day layout to its own overflow handling', () => {
        expect(doTrailingTagsCrowdTaskTitle({ taskTagsWidth: 300, taskItemWidth: 0 })).toBe(false)
        expect(
            doTrailingTagsCrowdTaskTitle({
                taskTagsWidth: 400,
                taskItemWidth: 600,
                inMyDayAndNotSubtask: true,
            })
        ).toBe(false)
    })
})
