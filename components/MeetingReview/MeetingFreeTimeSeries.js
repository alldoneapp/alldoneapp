import React, { useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { modeColor } from '../../Themes/colorMode'
import { localizedMoment } from '../../i18n/localizedMoment'
import { formatMeetingHours, formatMeetingTime } from '../../utils/meetingReview/meetingReviewFormat'
import { formatWorkingHoursRange } from '../../utils/meetingTimeToday'
import {
    FREE_DAY_COMPLETE,
    FREE_DAY_FUTURE,
    FREE_DAY_NON_WORKDAY,
    FREE_DAY_TODAY,
} from '../../utils/meetingReview/meetingFreeWorkTime'

// Two series, validated with the dataviz palette script (adjacent CVD ΔE 13.0 light / 15.9 dark,
// normal-vision ΔE 27.5 / 26.5). Dark steps are their own values, not a flip. The light magenta is
// below 3:1 on the surface, so every figure is also printed (summary, labels, table).
const FREE_COLOR = modeColor('#2a78d6', '#3987e5')
const MEETING_COLOR = modeColor('#e87ba4', '#d55181')
// With a project scope: the other projects' meetings, same hue, lighter.
const OTHER_MEETING_COLOR = modeColor('rgba(232,123,164,0.38)', 'rgba(213,81,129,0.42)')

const CHART_HEIGHT = 120
const MONTH_COLUMN_WIDTH = 22

const hours = ms => formatMeetingHours(ms)

const dayLabel = (dayStartMs, dateFormat) => {
    const day = localizedMoment(dayStartMs)
    return `${day.format('dd')} ${day.format(dateFormat)}`
}

/**
 * AT-3145 — "Meeting-free work time per day" inside Settings → Meeting time (and the project tab).
 * Calendar-derived availability (working window minus the union of meetings), not measured working
 * time; see utils/meetingReview/meetingFreeWorkTime.js for every rule.
 *
 * Week: one column per day (meeting-free at the baseline, meetings above, column = working window).
 * Month: the same, narrower and scrollable. Day: the working window as a time line with the
 * meetings in it. A column opens that day's figures; the table shows every day as text.
 */
export default function MeetingFreeTimeSeries({
    series,
    period,
    calendarConnected,
    incomplete,
    workingHours,
    workingHoursFailed,
    includeWeekends,
    scopeProjectName,
    dateFormat,
    timeFormat,
}) {
    const [selectedDayMs, setSelectedDayMs] = useState(null)
    const [tableOpen, setTableOpen] = useState(period !== 'month')
    const scoped = !!series?.projectId

    const header = (
        <View>
            <Text style={localStyles.title}>{translate('Meeting free title')}</Text>
            <Text style={localStyles.hint}>{translate('Meeting free explanation')}</Text>
            {workingHours ? (
                <Text style={localStyles.hint} testID="meeting-free-current-settings">
                    {translate('Meeting free current settings', {
                        range: formatWorkingHoursRange(workingHours),
                        days: translate(includeWeekends ? 'Meeting free all days' : 'Meeting free weekdays'),
                    })}
                </Text>
            ) : null}
            {scoped ? (
                <Text style={localStyles.hint} testID="meeting-free-scope-hint">
                    {translate('Meeting free scope hint', { name: scopeProjectName })}
                </Text>
            ) : null}
        </View>
    )

    if (!calendarConnected) {
        return (
            <View style={localStyles.container} testID="meeting-free-time">
                {header}
                <Text style={localStyles.empty} testID="meeting-free-no-calendar">
                    {translate('Meeting free no calendar')}
                </Text>
            </View>
        )
    }
    if (!series || !workingHours) {
        return workingHoursFailed ? (
            <View style={localStyles.container} testID="meeting-free-time">
                {header}
                <Text style={localStyles.empty} testID="meeting-free-window-unknown">
                    {translate('Meeting free window unknown')}
                </Text>
            </View>
        ) : null
    }

    const { days, summary } = series
    const selectedDay = days.find(day => day.dayStartMs === selectedDayMs) || null

    const dayFigures = day => {
        if (day.status === FREE_DAY_NON_WORKDAY) return translate('Meeting free non workday')
        if (day.status === FREE_DAY_FUTURE) return translate('Meeting free future')
        const parts = [
            translate('Meeting free day figures', {
                window: hours(day.windowMs),
                meetings: hours(day.meetingMs),
                free: hours(day.freeMs),
            }),
        ]
        if (scoped)
            parts.push(
                translate('Meeting free scoped part', { name: scopeProjectName, time: hours(day.scopedMeetingMs) })
            )
        if (day.soloBlockCount > 0) parts.push(translate('Meeting free solo blocks', { count: day.soloBlockCount }))
        if (day.noCalendarEntries) parts.push(translate('Meeting free note no entries'))
        if (day.status === FREE_DAY_TODAY) parts.push(translate('Meeting free note today'))
        return parts.join(' · ')
    }

    const renderColumn = (day, width) => {
        const label = localizedMoment(day.dayStartMs)
        const isToday = day.status === FREE_DAY_TODAY
        const selected = day.dayStartMs === selectedDayMs
        const heightOf = ms => (summary.maxWindowMs > 0 ? (ms / summary.maxWindowMs) * CHART_HEIGHT : 0)
        const hasValues = day.status === FREE_DAY_COMPLETE || isToday
        const otherMeetingMs = scoped && hasValues ? Math.max(0, day.meetingMs - day.scopedMeetingMs) : 0
        const scopedMs = scoped && hasValues ? day.scopedMeetingMs : 0
        return (
            <TouchableOpacity
                key={day.dayStartMs}
                testID={`meeting-free-day-${day.dayStartMs}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${dayLabel(day.dayStartMs, dateFormat)}: ${dayFigures(day)}`}
                onPress={() => setSelectedDayMs(selected ? null : day.dayStartMs)}
                style={[localStyles.column, width ? { width } : localStyles.columnFlex]}
            >
                <Text style={localStyles.columnValue} numberOfLines={1}>
                    {hasValues && (period === 'week' || selected)
                        ? `${day.noCalendarEntries ? '? ' : ''}${hours(day.freeMs)}`
                        : day.noCalendarEntries && hasValues
                          ? '?'
                          : ''}
                </Text>
                <View style={[localStyles.plot, isToday && localStyles.todayPlot]}>
                    {day.status === FREE_DAY_FUTURE ? (
                        <View style={[localStyles.futureBox, { height: heightOf(day.windowMs) }]} />
                    ) : day.status === FREE_DAY_NON_WORKDAY ? (
                        <View style={localStyles.nonWorkday} />
                    ) : (
                        <View style={[localStyles.stack, selected && localStyles.stackSelected]}>
                            {scoped ? (
                                <>
                                    {otherMeetingMs > 0 && (
                                        <View
                                            style={[
                                                localStyles.segment,
                                                localStyles.topSegment,
                                                {
                                                    height: heightOf(otherMeetingMs),
                                                    backgroundColor: OTHER_MEETING_COLOR,
                                                },
                                            ]}
                                        />
                                    )}
                                    {scopedMs > 0 && (
                                        <View
                                            style={[
                                                localStyles.segment,
                                                otherMeetingMs <= 0 && localStyles.topSegment,
                                                { height: heightOf(scopedMs), backgroundColor: MEETING_COLOR },
                                            ]}
                                        />
                                    )}
                                </>
                            ) : (
                                day.meetingMs > 0 && (
                                    <View
                                        testID={`meeting-free-bar-meetings-${day.dayStartMs}`}
                                        style={[
                                            localStyles.segment,
                                            localStyles.topSegment,
                                            { height: heightOf(day.meetingMs), backgroundColor: MEETING_COLOR },
                                        ]}
                                    />
                                )
                            )}
                            {day.freeMs > 0 && (
                                <View
                                    testID={`meeting-free-bar-free-${day.dayStartMs}`}
                                    style={[
                                        localStyles.segment,
                                        day.meetingMs <= 0 && localStyles.topSegment,
                                        day.noCalendarEntries && localStyles.unsureSegment,
                                        { height: heightOf(day.freeMs), backgroundColor: FREE_COLOR },
                                    ]}
                                />
                            )}
                        </View>
                    )}
                </View>
                <Text
                    style={[localStyles.columnLabel, (isToday || selected) && localStyles.columnLabelStrong]}
                    numberOfLines={1}
                >
                    {period === 'month' ? label.format('D') : label.format('dd')}
                </Text>
            </TouchableOpacity>
        )
    }

    const renderDayTimeline = day => {
        if (day.status === FREE_DAY_NON_WORKDAY || day.status === FREE_DAY_FUTURE) {
            return (
                <Text style={localStyles.empty} testID="meeting-free-day-empty">
                    {dayFigures(day)}
                </Text>
            )
        }
        const span = day.windowEndMs - day.windowStartMs
        return (
            <View style={localStyles.block}>
                <View
                    style={[
                        localStyles.timeline,
                        { backgroundColor: FREE_COLOR },
                        day.noCalendarEntries && localStyles.unsureSegment,
                    ]}
                    testID="meeting-free-timeline"
                    accessibilityRole="image"
                    accessibilityLabel={dayFigures(day)}
                >
                    {day.meetingIntervals.map(interval => (
                        <View
                            key={interval.startMs}
                            style={[
                                localStyles.timelineMeeting,
                                {
                                    left: `${((interval.startMs - day.windowStartMs) / span) * 100}%`,
                                    width: `${((interval.endMs - interval.startMs) / span) * 100}%`,
                                },
                            ]}
                        />
                    ))}
                </View>
                <View style={localStyles.timelineAxis}>
                    <Text style={localStyles.axisText}>{formatMeetingTime(day.windowStartMs, timeFormat)}</Text>
                    <Text style={localStyles.axisText}>{formatMeetingTime(day.windowEndMs, timeFormat)}</Text>
                </View>
            </View>
        )
    }

    const legend = (
        <View style={localStyles.legend}>
            <View style={localStyles.legendItem}>
                <View style={[localStyles.swatch, { backgroundColor: FREE_COLOR }]} />
                <Text style={localStyles.legendText}>{translate('Meeting free legend free')}</Text>
            </View>
            {scoped ? (
                <>
                    <View style={localStyles.legendItem}>
                        <View style={[localStyles.swatch, { backgroundColor: MEETING_COLOR }]} />
                        <Text style={localStyles.legendText}>
                            {translate('Meeting free legend scoped', { name: scopeProjectName })}
                        </Text>
                    </View>
                    <View style={localStyles.legendItem}>
                        <View style={[localStyles.swatch, { backgroundColor: OTHER_MEETING_COLOR }]} />
                        <Text style={localStyles.legendText}>{translate('Meeting free legend other')}</Text>
                    </View>
                </>
            ) : (
                <View style={localStyles.legendItem}>
                    <View style={[localStyles.swatch, { backgroundColor: MEETING_COLOR }]} />
                    <Text style={localStyles.legendText}>{translate('Meeting free legend meetings')}</Text>
                </View>
            )}
            <View style={localStyles.legendItem}>
                <View style={[localStyles.swatch, localStyles.unsureSegment, { backgroundColor: FREE_COLOR }]} />
                <Text style={localStyles.legendText}>{translate('Meeting free legend no entries')}</Text>
            </View>
        </View>
    )

    return (
        <View style={localStyles.container} testID="meeting-free-time">
            {header}
            {incomplete ? (
                <Text style={localStyles.warning} testID="meeting-free-incomplete">
                    {translate('Meeting free incomplete')}
                </Text>
            ) : null}

            {period === 'day' ? null : summary.completeWorkdays > 0 ? (
                <Text style={localStyles.summary} testID="meeting-free-summary">
                    {translate('Meeting free summary', {
                        average: hours(summary.averageFreeMs),
                        free: hours(summary.freeMs),
                        window: hours(summary.windowMs),
                        share: Math.round((summary.freeShare || 0) * 100),
                        days: summary.completeWorkdays,
                        meetings: hours(summary.meetingMs),
                    })}
                    {scoped
                        ? ` · ${translate('Meeting free scoped part', {
                              name: scopeProjectName,
                              time: hours(summary.scopedMeetingMs),
                          })}`
                        : ''}
                </Text>
            ) : (
                <Text style={localStyles.summaryMuted} testID="meeting-free-no-complete-day">
                    {translate('Meeting free no complete day')}
                </Text>
            )}
            {summary.noCalendarEntryDays > 0 ? (
                <Text style={localStyles.hint} testID="meeting-free-no-entries">
                    {translate('Meeting free no entries hint', { count: summary.noCalendarEntryDays })}
                </Text>
            ) : null}
            {summary.hasToday && period !== 'day' ? (
                <Text style={localStyles.hint}>{translate('Meeting free today hint')}</Text>
            ) : null}

            {period === 'day' ? (
                days[0] ? (
                    <View>
                        <Text style={localStyles.dayLine} testID="meeting-free-day-line">
                            {dayFigures(days[0])}
                        </Text>
                        {renderDayTimeline(days[0])}
                    </View>
                ) : null
            ) : (
                <View style={localStyles.block}>
                    {period === 'month' ? (
                        <ScrollView horizontal contentContainerStyle={localStyles.chartRow}>
                            {days.map(day => renderColumn(day, MONTH_COLUMN_WIDTH))}
                        </ScrollView>
                    ) : (
                        <View
                            style={localStyles.chartRow}
                            accessibilityRole="image"
                            accessibilityLabel={translate('Meeting free title')}
                        >
                            {days.map(day => renderColumn(day, null))}
                        </View>
                    )}
                    {selectedDay ? (
                        <Text style={localStyles.dayLine} testID="meeting-free-selected-day">
                            {`${dayLabel(selectedDay.dayStartMs, dateFormat)}: ${dayFigures(selectedDay)}`}
                        </Text>
                    ) : null}
                </View>
            )}
            {legend}

            {period !== 'day' ? (
                <View style={localStyles.block}>
                    <TouchableOpacity testID="meeting-free-table-toggle" onPress={() => setTableOpen(open => !open)}>
                        <Text style={localStyles.link}>
                            {translate(tableOpen ? 'Meeting free hide table' : 'Meeting free show table')}
                        </Text>
                    </TouchableOpacity>
                    {tableOpen ? (
                        <ScrollView horizontal contentContainerStyle={localStyles.table} testID="meeting-free-table">
                            <View>
                                <View style={localStyles.tableRow}>
                                    <Text style={[localStyles.headCell, localStyles.firstCell]}>
                                        {translate('Meeting free column day')}
                                    </Text>
                                    <Text style={localStyles.headCell}>{translate('Meeting free column window')}</Text>
                                    <Text style={localStyles.headCell}>
                                        {translate('Meeting free column meetings')}
                                    </Text>
                                    <Text style={localStyles.headCell}>{translate('Meeting free column free')}</Text>
                                    <Text style={[localStyles.headCell, localStyles.noteCell]}>
                                        {translate('Meeting free column note')}
                                    </Text>
                                </View>
                                {days.map(day => {
                                    const hasValues = day.status === FREE_DAY_COMPLETE || day.status === FREE_DAY_TODAY
                                    const notes = []
                                    if (day.status === FREE_DAY_NON_WORKDAY)
                                        notes.push(translate('Meeting free non workday'))
                                    if (day.status === FREE_DAY_FUTURE) notes.push(translate('Meeting free future'))
                                    if (day.status === FREE_DAY_TODAY) notes.push(translate('Meeting free note today'))
                                    if (day.noCalendarEntries) notes.push(translate('Meeting free note no entries'))
                                    if (scoped && hasValues)
                                        notes.push(
                                            translate('Meeting free scoped part', {
                                                name: scopeProjectName,
                                                time: hours(day.scopedMeetingMs),
                                            })
                                        )
                                    if (day.soloBlockCount > 0)
                                        notes.push(translate('Meeting free solo blocks', { count: day.soloBlockCount }))
                                    return (
                                        <View
                                            key={day.dayStartMs}
                                            style={localStyles.tableRow}
                                            testID={`meeting-free-row-${day.dayStartMs}`}
                                        >
                                            <Text style={[localStyles.cellText, localStyles.firstCell]}>
                                                {dayLabel(day.dayStartMs, dateFormat)}
                                            </Text>
                                            <Text style={[localStyles.cell, localStyles.cellText]}>
                                                {day.workday ? hours(day.windowMs) : '–'}
                                            </Text>
                                            <Text style={[localStyles.cell, localStyles.cellText]}>
                                                {hasValues ? hours(day.meetingMs) : '–'}
                                            </Text>
                                            <Text style={[localStyles.cell, localStyles.cellTextStrong]}>
                                                {hasValues ? hours(day.freeMs) : '–'}
                                            </Text>
                                            <Text style={[localStyles.cellNote, localStyles.noteCell]}>
                                                {notes.join(' · ')}
                                            </Text>
                                        </View>
                                    )
                                })}
                            </View>
                        </ScrollView>
                    ) : null}
                </View>
            ) : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 24,
    },
    title: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
    hint: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 4,
    },
    warning: {
        ...styles.body2,
        color: colors.UtilityOrange300,
        marginTop: 8,
    },
    empty: {
        ...styles.body2,
        color: colors.Text02,
        marginTop: 12,
    },
    summary: {
        ...styles.subtitle2,
        color: colors.Text01,
        marginTop: 12,
    },
    summaryMuted: {
        ...styles.body2,
        color: colors.Text02,
        marginTop: 12,
    },
    dayLine: {
        ...styles.body2,
        color: colors.Text01,
        marginTop: 8,
    },
    block: {
        marginTop: 12,
    },
    chartRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 4,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey300,
    },
    column: {
        alignItems: 'center',
    },
    columnFlex: {
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
    },
    columnValue: {
        ...styles.caption1,
        color: colors.Text02,
        minHeight: 16,
    },
    plot: {
        height: CHART_HEIGHT,
        width: '100%',
        maxWidth: 40,
        justifyContent: 'flex-end',
    },
    todayPlot: {
        opacity: 0.55,
    },
    stack: {
        width: '100%',
        gap: 2,
        justifyContent: 'flex-end',
    },
    stackSelected: {
        outlineStyle: 'solid',
        outlineWidth: 2,
        outlineColor: colors.Text02,
        outlineOffset: 1,
        borderRadius: 4,
    },
    segment: {
        width: '100%',
    },
    topSegment: {
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
    },
    unsureSegment: {
        opacity: 0.4,
    },
    futureBox: {
        width: '100%',
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.Grey300,
        borderBottomWidth: 0,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
    },
    nonWorkday: {
        width: '100%',
        height: 2,
        backgroundColor: colors.Grey300,
    },
    columnLabel: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 4,
    },
    columnLabelStrong: {
        color: colors.Text01,
        fontWeight: '600',
    },
    timeline: {
        height: 24,
        borderRadius: 4,
        overflow: 'hidden',
        position: 'relative',
    },
    timelineMeeting: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        backgroundColor: MEETING_COLOR,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: colors.Surface,
    },
    timelineAxis: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 2,
    },
    axisText: {
        ...styles.caption2,
        color: colors.Text03,
    },
    legend: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: 16,
        rowGap: 4,
        marginTop: 8,
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    swatch: {
        width: 10,
        height: 10,
        borderRadius: 2,
        marginRight: 6,
    },
    legendText: {
        ...styles.body2,
        color: colors.Text01,
    },
    link: {
        ...styles.subtitle2,
        color: colors.Primary100,
    },
    table: {
        flexDirection: 'column',
        marginTop: 4,
    },
    tableRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey200,
        minHeight: 32,
    },
    headCell: {
        ...styles.caption1,
        color: colors.Text03,
        width: 82,
        textAlign: 'right',
    },
    firstCell: {
        width: 80,
        textAlign: 'left',
    },
    noteCell: {
        width: 260,
        textAlign: 'left',
        paddingLeft: 16,
    },
    cell: {
        width: 82,
        textAlign: 'right',
        paddingVertical: 4,
    },
    cellText: {
        ...styles.body2,
        color: colors.Text01,
    },
    cellTextStrong: {
        ...styles.subtitle2,
        color: colors.Text01,
    },
    cellNote: {
        ...styles.caption2,
        color: colors.Text03,
    },
})
