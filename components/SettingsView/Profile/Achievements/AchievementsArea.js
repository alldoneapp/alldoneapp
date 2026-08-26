import React, { useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { translate } from '../../../../i18n/TranslationService'
import styles, { colors } from '../../../styles/global'
import EmptyInboxStreakValue from './EmptyInboxStreakValue'
import EmptyInboxTodayDot from './EmptyInboxTodayDot'
import useEmptyInboxDotCelebration from './emptyInboxDotMotion'
import useTodayEmptyInboxCelebration from './useTodayEmptyInboxCelebration'
import {
    buildEmptyInboxActivityWeeks,
    buildEmptyInboxMonthSegments,
    getEmptyInboxAchievementStats,
    getEmptyInboxDaysWithLegacyFallback,
} from './AchievementsHelper'

const CELL_SIZE = 11
const CELL_GAP = 3
const CELL_RADIUS = 2
const WEEK_WIDTH = CELL_SIZE + CELL_GAP
const DAY_LABEL_WIDTH = 40
const MIN_WEEKS = 12
const MAX_WEEKS = 53

const getNumberOfWeeks = width =>
    Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.floor((width - DAY_LABEL_WIDTH) / WEEK_WIDTH)))

// AT-2362: the grid is capped at MAX_WEEKS (one year), so on a wide card — the
// all-projects empty-inbox screen renders it full width — it is narrower than the card
// and used to hug the left edge while the title, description and metrics were centered.
// Giving the grid its exact intrinsic width lets `alignSelf: 'center'` center it as one
// block. Every week cell carries a trailing CELL_GAP that the last column does not paint,
// so the measured width overshoots the visible grid by that gap; the negative right
// margin in `activityGrid` takes it back out of the centering math (see below).
export const getGridWidth = numberOfWeeks => DAY_LABEL_WIDTH + numberOfWeeks * WEEK_WIDTH

const Metric = ({ label, value, celebration }) => (
    <View style={localStyles.metric}>
        {celebration ? (
            <EmptyInboxStreakValue value={value} celebration={celebration} style={localStyles.metricValue} />
        ) : (
            <Text style={localStyles.metricValue}>{value}</Text>
        )}
        <Text style={localStyles.metricLabel}>{label}</Text>
    </View>
)

/**
 * @param {number} [props.celebrationRunId] AT-2445 — a run id owned by the CALLER. The empty-inbox
 *   board celebrates in several places at once now (the congratulation, the confetti, the picture,
 *   and this card's dot), and they are one event, so the board decides once and hands the answer
 *   down. When it is absent the card falls back to deciding for itself, which is what keeps
 *   `celebrateNewDay` working for any other caller and keeps the Settings → Profile copy — which
 *   passes neither — unable to spend the day.
 */
export function EmptyInboxOverview({ user, style, onOpenAchievements, celebrateNewDay = false, celebrationRunId }) {
    const [contentWidth, setContentWidth] = useState(0)
    const CardContainer = onOpenAchievements ? TouchableOpacity : View
    const emptyInboxDays = useMemo(
        () => getEmptyInboxDaysWithLegacyFallback(user),
        [user.emptyInboxDays, user.lastDayEmptyInbox]
    )
    const stats = useMemo(() => getEmptyInboxAchievementStats(emptyInboxDays), [emptyInboxDays])
    // The hook is always called (it decides nothing when disabled) — a conditional hook would be a
    // rules-of-hooks violation, and letting it run while the caller also owns a run would spend the
    // day twice.
    const ownCelebrationRunId = useTodayEmptyInboxCelebration(
        emptyInboxDays,
        celebrateNewDay && celebrationRunId == null,
        user.uid
    )
    const resolvedRunId = celebrationRunId == null ? ownCelebrationRunId : celebrationRunId
    // AT-2418: one bundle of Animated.Values drives the dot AND the streak number, so the two beats
    // are one event rather than two animations that happen to overlap.
    const celebration = useEmptyInboxDotCelebration(resolvedRunId, stats.currentStreak)
    const numberOfWeeks = contentWidth ? getNumberOfWeeks(contentWidth) : MIN_WEEKS
    const weeks = useMemo(
        () => buildEmptyInboxActivityWeeks(emptyInboxDays, numberOfWeeks),
        [emptyInboxDays, numberOfWeeks]
    )
    const monthSegments = useMemo(() => buildEmptyInboxMonthSegments(weeks), [weeks])
    const dayLabels = [
        translate('Monday short'),
        '',
        translate('Wednesday short'),
        '',
        translate('Friday short'),
        '',
        '',
    ]

    return (
        <CardContainer
            style={[localStyles.card, style]}
            onLayout={event => setContentWidth(event.nativeEvent.layout.width - 40)}
            {...(onOpenAchievements
                ? { accessibilityRole: 'link', activeOpacity: 0.8, onPress: onOpenAchievements }
                : {})}
        >
            <Text style={localStyles.title}>{translate('Empty inbox')}</Text>
            <Text style={localStyles.description}>{translate('Empty inbox achievement description')}</Text>

            <View style={localStyles.metricsContainer}>
                <Metric
                    label={translate('Current streak')}
                    value={stats.currentStreak}
                    celebration={resolvedRunId ? celebration : null}
                />
                <Metric label={translate('Longest streak')} value={stats.longestStreak} />
                <Metric label={translate('Total days')} value={stats.totalDays} />
            </View>

            <View style={localStyles.activityContainer}>
                <View style={[localStyles.activityGrid, { width: getGridWidth(numberOfWeeks) }]}>
                    <View style={localStyles.monthLabels}>
                        <View style={{ width: DAY_LABEL_WIDTH }} />
                        {monthSegments.map((segment, index) => (
                            <View
                                key={`${segment.monthName}-${index}`}
                                style={[localStyles.monthLabelSlot, { width: WEEK_WIDTH * segment.numberOfWeeks }]}
                            >
                                <Text numberOfLines={1} style={localStyles.monthLabel}>
                                    {translate(segment.monthName).slice(0, 3)}
                                </Text>
                            </View>
                        ))}
                    </View>
                    <View style={localStyles.activityRows}>
                        <View style={localStyles.dayLabels}>
                            {dayLabels.map((label, index) => (
                                <Text key={index} style={localStyles.dayLabel}>
                                    {label}
                                </Text>
                            ))}
                        </View>
                        <View style={localStyles.weeks}>
                            {weeks.map((week, weekIndex) => (
                                <View key={weekIndex} style={localStyles.week}>
                                    {week.days.map(day => {
                                        const achievedLabel = day.achieved
                                            ? translate('Empty inbox reached on', { date: day.date.format('LL') })
                                            : undefined

                                        // AT-2418: only today's cell, only on the run that is
                                        // celebrating it. Every other cell keeps the plain View it
                                        // has always rendered, so the 370 squares around it cost
                                        // nothing extra.
                                        return resolvedRunId && day.isToday && day.achieved ? (
                                            <EmptyInboxTodayDot
                                                key={day.dateKey}
                                                celebration={celebration}
                                                size={CELL_SIZE}
                                                gap={CELL_GAP}
                                                radius={CELL_RADIUS}
                                                accessibilityLabel={achievedLabel}
                                            />
                                        ) : (
                                            <View
                                                key={day.dateKey}
                                                accessible={day.achieved}
                                                accessibilityLabel={achievedLabel}
                                                style={[
                                                    localStyles.activityCell,
                                                    day.achieved && localStyles.achievedCell,
                                                    day.isFuture && localStyles.futureCell,
                                                    day.isToday && !day.achieved && localStyles.todayCell,
                                                ]}
                                            />
                                        )
                                    })}
                                </View>
                            ))}
                        </View>
                    </View>
                </View>
            </View>
        </CardContainer>
    )
}

export default function AchievementsArea({ user }) {
    return (
        <View style={localStyles.container}>
            <Text style={localStyles.sectionTitle}>{translate('Achievements')}</Text>
            <EmptyInboxOverview user={user} style={localStyles.profileCard} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 70,
    },
    sectionTitle: {
        ...styles.title6,
    },
    card: {
        padding: 20,
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 8,
        backgroundColor: '#FFFFFF',
    },
    profileCard: {
        marginTop: 16,
    },
    title: {
        ...styles.subtitle1,
        color: colors.Text01,
        textAlign: 'center',
    },
    description: {
        ...styles.caption1,
        color: colors.Text03,
        marginTop: 4,
        textAlign: 'center',
    },
    metricsContainer: {
        flexDirection: 'row',
        marginTop: 20,
        marginHorizontal: -8,
    },
    metric: {
        flex: 1,
        paddingHorizontal: 8,
    },
    metricValue: {
        ...styles.title6,
        color: colors.Text01,
        textAlign: 'center',
    },
    metricLabel: {
        ...styles.caption1,
        color: colors.Text03,
        marginTop: 2,
        textAlign: 'center',
    },
    activityContainer: {
        marginTop: 24,
    },
    activityGrid: {
        // The width handed in is the grid's exact intrinsic width, so `alignSelf: 'center'`
        // centers the whole block (day labels + month labels + squares) inside the card and
        // is a no-op on narrow cards, where the grid already fills the available width.
        // The negative margin discards the last column's unpainted trailing gap so the
        // squares are optically centered rather than CELL_GAP off to the left.
        alignSelf: 'center',
        marginRight: -CELL_GAP,
    },
    monthLabels: {
        flexDirection: 'row',
        height: 18,
    },
    monthLabelSlot: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
    },
    monthLabel: {
        ...styles.caption1,
        color: colors.Text03,
        minWidth: WEEK_WIDTH * 3,
        textAlign: 'center',
    },
    activityRows: {
        flexDirection: 'row',
    },
    dayLabels: {
        width: DAY_LABEL_WIDTH,
        paddingRight: 8,
    },
    dayLabel: {
        ...styles.caption1,
        color: colors.Text03,
        height: WEEK_WIDTH,
        lineHeight: WEEK_WIDTH,
    },
    weeks: {
        flexDirection: 'row',
    },
    week: {
        width: WEEK_WIDTH,
    },
    activityCell: {
        width: CELL_SIZE,
        height: CELL_SIZE,
        marginBottom: CELL_GAP,
        borderRadius: CELL_RADIUS,
        backgroundColor: colors.Grey200,
    },
    achievedCell: {
        backgroundColor: colors.UtilityGreen200,
    },
    futureCell: {
        backgroundColor: 'transparent',
    },
    todayCell: {
        borderWidth: 1,
        borderColor: colors.Primary100,
    },
})
