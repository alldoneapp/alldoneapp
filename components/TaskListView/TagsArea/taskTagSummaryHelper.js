const DESKTOP_TAG_LIMIT = 5
const TABLET_TAG_LIMIT = 3
const MOBILE_TAG_LIMIT = 2
const MY_DAY_DESKTOP_TAG_LIMIT = 3
const MY_DAY_COMPACT_TAG_LIMIT = 1

export const shouldSummarizeTaskTags = ({
    amountTags,
    inMyDayAndNotSubtask,
    showSummarizeTagInByTime,
    isCalendarTask,
    tablet,
    isMobile,
}) => {
    const calendarTagOffset = isCalendarTask ? 1 : 0

    if (inMyDayAndNotSubtask) {
        const tagLimit = tablet || isMobile ? MY_DAY_COMPACT_TAG_LIMIT : MY_DAY_DESKTOP_TAG_LIMIT
        const calendarTaskReachedLimit = isCalendarTask && amountTags > tagLimit - calendarTagOffset

        return amountTags > 0 && (showSummarizeTagInByTime || calendarTaskReachedLimit)
    }

    return (
        amountTags > DESKTOP_TAG_LIMIT - calendarTagOffset ||
        (tablet && amountTags > TABLET_TAG_LIMIT - calendarTagOffset) ||
        (isMobile && amountTags > MOBILE_TAG_LIMIT - calendarTagOffset)
    )
}
