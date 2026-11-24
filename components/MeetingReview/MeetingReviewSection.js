import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import {
    MEETING_ATTENDANCE_NOT_ATTENDED,
    MEETING_CATEGORY_COLORS,
    MEETING_CATEGORY_LABEL_KEYS,
    MEETING_REVIEW_STATUS_RATED,
    MEETING_USEFULNESS_EMOJI,
    MEETING_USEFULNESS_LABEL_KEYS,
    toMeetingDocId,
} from '../../functions/shared/meetingReview/meetingReviewConstants'
import { resolveMeetingCategory } from '../../functions/shared/meetingReview/meetingCategorySuggestion'
import { getCalendarEventBounds } from '../../functions/shared/meetingReview/calendarEventCounting'
import { applyMeetingReviewAction, isRatableMeetingTask } from '../../utils/meetingReview/meetingReviewActions'
import { requestMeetingReview, useMeetingReviewSelector } from '../../utils/meetingReview/meetingReviewStore'
import { formatMeetingDuration } from '../../utils/meetingReview/meetingReviewFormat'
import { openMeetingTimeStatistics } from '../../utils/meetingReview/openMeetingTimeStatistics'
import { getSuggestionLabel } from './MeetingReviewSheet'
import { getDateFormat, getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'

/**
 * AT-3137 — "Rating (only visible to you)" in the task detail (concept W6): edit later, remove the
 * rating, see the counted duration and open the statistics. Only for the calendar's owner.
 */
export default function MeetingReviewSection({ task, projectId }) {
    const uid = useSelector(state => state.loggedUser?.uid)
    const docId = task?.id ? toMeetingDocId(task.id) : ''
    const seriesId = task?.calendarData?.recurringEventId
    const review = useMeetingReviewSelector(state => state.reviews[docId] || null)
    const seriesDoc = useMeetingReviewSelector(state =>
        seriesId ? state.seriesCategories[toMeetingDocId(seriesId)] : null
    )
    const rules = useMeetingReviewSelector(state => state.rules)

    if (!isRatableMeetingTask(task, uid)) return null

    const resolved = resolveMeetingCategory({ task, review, seriesCategory: seriesDoc?.category || null, rules })
    const bounds = getCalendarEventBounds(task.calendarData)
    const plannedMs = bounds ? bounds.endMs - bounds.startMs : 0
    const adjusted = Number.isFinite(review?.actualStartMs) && Number.isFinite(review?.actualEndMs)
    const notAttended = review?.attendance === MEETING_ATTENDANCE_NOT_ATTENDED
    const countedMs = notAttended ? 0 : adjusted ? review.actualEndMs - review.actualStartMs : plannedMs
    const rated = review?.reviewStatus === MEETING_REVIEW_STATUS_RATED && !!review?.usefulness
    const fullTask = { ...task, projectId }

    const categoryText = resolved.category
        ? `${translate(MEETING_CATEGORY_LABEL_KEYS[resolved.category])} · ${
              resolved.confirmed ? translate('Meeting confirmed') : getSuggestionLabel(resolved)
          }`
        : translate('Meeting category open')
    const usefulnessText = notAttended
        ? translate('Meeting not attended short')
        : rated
          ? `${MEETING_USEFULNESS_EMOJI[review.usefulness]} ${translate(MEETING_USEFULNESS_LABEL_KEYS[review.usefulness])}${
                review.ratedAt
                    ? ` · ${translate('Meeting rated at', {
                          date: moment(review.ratedAt).format(`${getDateFormat()} ${getTimeFormat()}`),
                      })}`
                    : ''
            }`
          : translate('Meeting unrated')

    return (
        <View style={localStyles.container} testID="meeting-review-section">
            <Text style={localStyles.title}>{translate('Meeting rating only for you')}</Text>
            <View style={localStyles.row}>
                <Text style={localStyles.label}>{translate('Meeting category')}</Text>
                {resolved.category ? (
                    <View style={[localStyles.dot, { backgroundColor: MEETING_CATEGORY_COLORS[resolved.category] }]} />
                ) : null}
                <Text style={localStyles.value} testID="meeting-section-category">
                    {categoryText}
                </Text>
            </View>
            <View style={localStyles.row}>
                <Text style={localStyles.label}>{translate('Meeting usefulness')}</Text>
                <Text style={localStyles.value} testID="meeting-section-usefulness">
                    {usefulnessText}
                </Text>
            </View>
            <View style={localStyles.row}>
                <Text style={localStyles.label}>{translate('Meeting duration')}</Text>
                <Text style={localStyles.value} testID="meeting-section-duration">
                    {translate('Meeting planned counted', {
                        planned: formatMeetingDuration(plannedMs),
                        counted: formatMeetingDuration(countedMs),
                    })}
                    {adjusted ? ' ✎' : ''}
                </Text>
            </View>
            {!task.done && <Text style={localStyles.hint}>{translate('Meeting not checked off hint')}</Text>}
            <View style={localStyles.actions}>
                <TouchableOpacity
                    testID="meeting-section-edit"
                    onPress={() => requestMeetingReview({ task: fullTask, projectId, isEdit: true })}
                >
                    <Text style={localStyles.link}>{translate(rated ? 'Edit' : 'Meeting rate now')}</Text>
                </TouchableOpacity>
                {rated && (
                    <TouchableOpacity
                        testID="meeting-section-clear"
                        onPress={() =>
                            applyMeetingReviewAction({ uid, task: fullTask, action: { type: 'clear' } }).catch(error =>
                                console.error('[meetingReview] could not remove the rating', error)
                            )
                        }
                    >
                        <Text style={localStyles.link}>{translate('Meeting remove rating')}</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity testID="meeting-section-statistics" onPress={openMeetingTimeStatistics}>
                    <Text style={localStyles.link}>{`${translate('Meeting time statistics')} →`}</Text>
                </TouchableOpacity>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 24,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: colors.Grey300,
    },
    title: {
        ...styles.subtitle1,
        color: colors.Text01,
        marginBottom: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 28,
    },
    label: {
        ...styles.body2,
        color: colors.Text03,
        width: 110,
    },
    value: {
        ...styles.body2,
        color: colors.Text01,
        flexShrink: 1,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    hint: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 4,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 16,
        marginTop: 8,
    },
    link: {
        ...styles.subtitle2,
        color: colors.Primary100,
    },
})
