import React, { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { translate } from '../../../../i18n/TranslationService'
import styles, { colors } from '../../../styles/global'
import {
    buildEmptyInboxActivityWeeks,
    getEmptyInboxAchievementStats,
    getEmptyInboxDaysWithLegacyFallback,
} from './AchievementsHelper'

const CELL_SIZE = 11
const CELL_GAP = 3
const WEEK_WIDTH = CELL_SIZE + CELL_GAP
const DAY_LABEL_WIDTH = 40
const MIN_WEEKS = 12
const MAX_WEEKS = 53

const getNumberOfWeeks = width =>
    Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.floor((width - DAY_LABEL_WIDTH) / WEEK_WIDTH)))

const Metric = ({ label, value }) => (
    <View style={localStyles.metric}>
        <Text style={localStyles.metricValue}>{value}</Text>
        <Text style={localStyles.metricLabel}>{label}</Text>
    </View>
)

export function EmptyInboxOverview({ user, style }) {
    const [contentWidth, setContentWidth] = useState(0)
    const emptyInboxDays = useMemo(() => getEmptyInboxDaysWithLegacyFallback(user), [
        user.emptyInboxDays,
        user.lastDayEmptyInbox,
    ])
    const stats = useMemo(() => getEmptyInboxAchievementStats(emptyInboxDays), [emptyInboxDays])
    const numberOfWeeks = contentWidth ? getNumberOfWeeks(contentWidth) : MIN_WEEKS
    const weeks = useMemo(() => buildEmptyInboxActivityWeeks(emptyInboxDays, numberOfWeeks), [
        emptyInboxDays,
        numberOfWeeks,
    ])
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
        <View
            style={[localStyles.card, style]}
            onLayout={event => setContentWidth(event.nativeEvent.layout.width - 40)}
        >
            <Text style={localStyles.title}>{translate('Empty inbox')}</Text>
            <Text style={localStyles.description}>{translate('Empty inbox achievement description')}</Text>

            <View style={localStyles.metricsContainer}>
                <Metric label={translate('Current streak')} value={stats.currentStreak} />
                <Metric label={translate('Longest streak')} value={stats.longestStreak} />
                <Metric label={translate('Total days')} value={stats.totalDays} />
            </View>

            <View style={localStyles.activityContainer}>
                <View style={localStyles.monthLabels}>
                    <View style={{ width: DAY_LABEL_WIDTH }} />
                    {weeks.map((week, index) => (
                        <View key={index} style={localStyles.monthLabelSlot}>
                            {!!week.monthName && (
                                <Text style={localStyles.monthLabel}>{translate(week.monthName).slice(0, 3)}</Text>
                            )}
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
                                {week.days.map(day => (
                                    <View
                                        key={day.dateKey}
                                        accessible={day.achieved}
                                        accessibilityLabel={
                                            day.achieved
                                                ? translate('Empty inbox reached on', {
                                                      date: day.date.format('LL'),
                                                  })
                                                : undefined
                                        }
                                        style={[
                                            localStyles.activityCell,
                                            day.achieved && localStyles.achievedCell,
                                            day.isFuture && localStyles.futureCell,
                                            day.isToday && !day.achieved && localStyles.todayCell,
                                        ]}
                                    />
                                ))}
                            </View>
                        ))}
                    </View>
                </View>
            </View>
        </View>
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
    },
    description: {
        ...styles.caption1,
        color: colors.Text03,
        marginTop: 4,
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
    },
    metricLabel: {
        ...styles.caption1,
        color: colors.Text03,
        marginTop: 2,
    },
    activityContainer: {
        marginTop: 24,
    },
    monthLabels: {
        flexDirection: 'row',
        height: 18,
    },
    monthLabelSlot: {
        width: WEEK_WIDTH,
        overflow: 'visible',
    },
    monthLabel: {
        ...styles.caption1,
        position: 'absolute',
        color: colors.Text02,
        width: WEEK_WIDTH * 4,
        zIndex: 1,
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
        color: colors.Text02,
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
        borderRadius: 2,
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
