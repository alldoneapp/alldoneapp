const DESKTOP_TAG_LIMIT = 4
const TABLET_TAG_LIMIT = 3
const MOBILE_TAG_LIMIT = 2
const MY_DAY_DESKTOP_TAG_LIMIT = 3
const MY_DAY_COMPACT_TAG_LIMIT = 1
const MAX_TRAILING_TAGS_WIDTH_RATIO = 0.7

export const doTrailingTagsCrowdTaskTitle = ({ taskTagsWidth, taskItemWidth, inMyDayAndNotSubtask }) =>
    !inMyDayAndNotSubtask &&
    taskTagsWidth > 0 &&
    taskItemWidth > 0 &&
    taskTagsWidth > taskItemWidth * MAX_TRAILING_TAGS_WIDTH_RATIO

export const shouldSummarizeTaskTags = ({
    amountTags,
    inMyDayAndNotSubtask,
    showSummarizeTagInByTime,
    isCalendarTask,
    hasPriorityTag,
    trailingTagsCrowdTitle,
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

    if (amountTags > 0 && trailingTagsCrowdTitle) return true

    return (
        amountTags > DESKTOP_TAG_LIMIT - leadingTagsOffset ||
        (tablet && amountTags > TABLET_TAG_LIMIT - leadingTagsOffset) ||
        (isMobile && amountTags > MOBILE_TAG_LIMIT - leadingTagsOffset)
    )
}
