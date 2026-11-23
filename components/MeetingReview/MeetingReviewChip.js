import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors, windowTagStyle } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { MEETING_CATEGORY_COLORS, toMeetingDocId } from '../../functions/shared/meetingReview/meetingReviewConstants'
import { resolveMeetingCategory } from '../../functions/shared/meetingReview/meetingCategorySuggestion'
import { isRatableMeetingTask } from '../../utils/meetingReview/meetingReviewSelectors'
import { requestMeetingReview, useMeetingReviewSelector } from '../../utils/meetingReview/meetingReviewStore'
import { getMeetingReviewChipState, getMeetingReviewChipText } from './meetingReviewChipText'

/**
 * AT-3137 — category and usefulness on a COMPLETED calendar task (concept 5.1; open and future
 * appointments get no chip in the MVP, decision E4). Only the calendar's owner sees it: ratings are
 * private. Tapping opens the same sheet to edit.
 */
export default function MeetingReviewChip({ task, projectId, containerStyle, disabled }) {
    const uid = useSelector(state => state.loggedUser?.uid)
    const docId = task?.id ? toMeetingDocId(task.id) : ''
    const seriesId = task?.calendarData?.recurringEventId
    // Each selector returns a stored object reference, so a row re-renders only when ITS data changes.
    const review = useMeetingReviewSelector(state => state.reviews[docId] || null)
    const seriesDoc = useMeetingReviewSelector(state =>
        seriesId ? state.seriesCategories[toMeetingDocId(seriesId)] : null
    )
    const rules = useMeetingReviewSelector(state => state.rules)

    if (!task?.done || !isRatableMeetingTask(task, uid)) return null

    const resolved = resolveMeetingCategory({ task, review, seriesCategory: seriesDoc?.category || null, rules })
    const chip = getMeetingReviewChipState(review, resolved)
    const text = getMeetingReviewChipText(review, resolved)
    const dashed = !chip.notAttended && (!chip.categoryConfirmed || !chip.usefulness)

    return (
        <TouchableOpacity
            testID="meeting-review-chip"
            accessibilityRole="button"
            accessibilityLabel={`${translate('Meeting review')}: ${text}`}
            disabled={disabled}
            onPress={() => requestMeetingReview({ task: { ...task, projectId }, projectId, isEdit: true })}
            style={[localStyles.container, dashed && localStyles.dashed, containerStyle]}
        >
            {chip.category && !chip.notAttended ? (
                <View style={[localStyles.dot, { backgroundColor: MEETING_CATEGORY_COLORS[chip.category] }]} />
            ) : null}
            <Text style={[localStyles.text, chip.notAttended && localStyles.muted, windowTagStyle()]} numberOfLines={1}>
                {text}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 24,
        borderRadius: 12,
        paddingHorizontal: 8,
        backgroundColor: colors.Grey200,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    dashed: {
        borderStyle: 'dashed',
        borderColor: colors.Grey400,
        backgroundColor: 'transparent',
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text02,
    },
    muted: {
        color: colors.Text03,
    },
})
