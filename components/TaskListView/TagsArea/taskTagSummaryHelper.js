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
    hasPriorityTag,
    tablet,
    isMobile,
}) => {
    // Leading chips (calendar time, priority) render before the task title and never collapse
    // into the summary tag, so each one lowers the limit of trailing tags shown before summarizing.
    const leadingTagsOffset = (isCalendarTask ? 1 : 0) + (hasPriorityTag ? 1 : 0)

    if (inMyDayAndNotSubtask) {
        const tagLimit = tablet || isMobile ? MY_DAY_COMPACT_TAG_LIMIT : MY_DAY_DESKTOP_TAG_LIMIT
        const leadingTagsReachedLimit = leadingTagsOffset > 0 && amountTags > tagLimit - leadingTagsOffset

        return amountTags > 0 && (showSummarizeTagInByTime || leadingTagsReachedLimit)
    }

    return (
        amountTags > DESKTOP_TAG_LIMIT - leadingTagsOffset ||
        (tablet && amountTags > TABLET_TAG_LIMIT - leadingTagsOffset) ||
        (isMobile && amountTags > MOBILE_TAG_LIMIT - leadingTagsOffset)
    )
}
