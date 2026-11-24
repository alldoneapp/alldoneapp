import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import URLsSettings, { URL_SETTINGS_MEETING_TIME } from '../../URLSystem/Settings/URLsSettings'
import {
    MEETING_CATEGORY_COLORS,
    MEETING_CATEGORY_LABEL_KEYS,
    MEETING_UNRATED_SYMBOL,
    MEETING_USEFULNESS_EMOJI,
    MEETING_USEFULNESS_LABEL_KEYS,
} from '../../functions/shared/meetingReview/meetingReviewConstants'
import {
    MEETING_CATEGORY_OPEN,
    MEETING_ROW_COUNTED,
    MEETING_ROW_EXCLUDED,
    MEETING_ROW_NOT_ATTENDED,
    MEETING_ROW_PLANNED,
    MEETING_UNRATED,
    USEFULNESS_BUCKETS,
    computeMeetingTimeStats,
    filterMeetingStatRows,
} from '../../functions/shared/meetingReview/meetingTimeStats'
import { buildMeetingStatsEntries } from '../../utils/meetingReview/buildMeetingStatsEntries'
import {
    fetchMeetingReviewsInRange,
    fetchMeetingStatsTasks,
    fetchWorkingHoursSettings,
} from '../../utils/meetingReview/meetingReviewBackend'
import { removeMeetingCategoryRule } from '../../utils/meetingReview/meetingReviewActions'
import { requestMeetingReview, useMeetingReviewSelector } from '../../utils/meetingReview/meetingReviewStore'
import {
    MEETING_STATS_PERIODS,
    MEETING_STATS_PERIOD_DAY,
    MEETING_STATS_PERIOD_WEEK,
    formatMeetingDuration,
    formatMeetingHours,
    formatMeetingTime,
    getMeetingStatsRange,
    getMeetingStatsRangeLabel,
    shiftMeetingStatsAnchor,
} from '../../utils/meetingReview/meetingReviewFormat'
import { localizedMoment } from '../../i18n/localizedMoment'
import { getDateFormat, getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { formatWorkingHoursRange, resolveWorkingHours } from '../../utils/meetingTimeToday'
import SettingsHelper from '../SettingsView/SettingsHelper'
import NavigationService from '../../utils/NavigationService'
import { DV_TAB_SETTINGS_CUSTOMIZATIONS } from '../../utils/TabNavigationConstants'
import { computeMeetingFreeWorkTime, resolveIncludeWeekends } from '../../utils/meetingReview/meetingFreeWorkTime'
import MeetingFreeTimeSeries from './MeetingFreeTimeSeries'

const DAY_MS = 24 * 60 * 60 * 1000

// Validated with the dataviz palette script (light #FCFCFB and dark #151A23 surfaces): lightness
// band, chroma, CVD and normal-vision separation pass for the three rated segments. "Unrated" is a
// deliberately neutral gray: it is not a judgement. Every segment also carries emoji + label.
const USEFULNESS_COLORS = {
    worthwhile: '#07A873',
    partly: '#D97706',
    not_helpful: '#E00000',
    [MEETING_UNRATED]: colors.Grey400,
}

const PERIOD_LABEL_KEYS = {
    day: 'Meeting period day',
    week: 'Meeting period week',
    month: 'Meeting period month',
}

const EXCLUSION_LABEL_KEYS = {
    all_day: 'Meeting excluded all day',
    cancelled: 'Meeting excluded cancelled',
    declined: 'Meeting excluded declined',
    invalid: 'Meeting excluded invalid',
}

const bucketLabel = bucket =>
    bucket === MEETING_UNRATED
        ? `${MEETING_UNRATED_SYMBOL} ${translate('Meeting unrated')}`
        : `${MEETING_USEFULNESS_EMOJI[bucket]} ${translate(MEETING_USEFULNESS_LABEL_KEYS[bucket])}`

const categoryLabel = key =>
    key === MEETING_CATEGORY_OPEN ? translate('Meeting category open') : translate(MEETING_CATEGORY_LABEL_KEYS[key])

// The working hours "Time to work" is computed from are edited with the meeting link settings in
// Settings > Customizations (AT-3136); the statistics only link there (AT-3145).
const openWorkingHoursSettings = () => {
    SettingsHelper.processURLSettingsTab(NavigationService, DV_TAB_SETTINGS_CUSTOMIZATIONS)
}

/**
 * AT-3137 — Settings → Meeting time: day / week / month statistics with one denominator
 * ("recorded calendar time"), unrated time as its own segment, the "not helpful" range, the
 * category × usefulness matrix and a drill-down to the appointments (concept W7–W9).
 *
 * AT-3145 — broken down by project: in Settings a "By project" table whose rows narrow the whole
 * view to one project; in the project details (`projectId`) the same view fixed to that project.
 * Either way it is the signed-in user's own appointments and private ratings only (the callable
 * returns the caller's tasks, the reviews live under users/{uid}). Overlaps are always split
 * against every project, so per-project figures add up to the all-projects total.
 * "Time to work" in the All projects line opens this tab; the working hours line links back to
 * where they are edited.
 *
 * AT-3145 (follow-up) — "Meeting-free work time per day" (`MeetingFreeTimeSeries`): the working
 * window minus the union of ALL own meetings per day over the selected period, calendar-derived, not
 * measured. A project scope only highlights that project's part; the free time stays global.
 */
export default function MeetingTimeStatistics({ projectId = null }) {
    const uid = useSelector(state => state.loggedUser?.uid)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    // Same signal as "Time to work" (getCalendarConnectedProjectIdsFromApis), inlined so this view
    // does not load the Firestore backend for it.
    const calendarConnected = useSelector(state =>
        Object.values(state.loggedUser?.apisConnected || {}).some(apis => !!apis?.calendar)
    )
    const [period, setPeriod] = useState(MEETING_STATS_PERIOD_WEEK)
    const [anchorMs, setAnchorMs] = useState(() => Date.now())
    const [loadState, setLoadState] = useState({ loading: true, error: '', tasks: [], reviews: {}, failed: [] })
    const [filter, setFilter] = useState(null)
    const [projectFilter, setProjectFilter] = useState(null)
    const [workingHours, setWorkingHours] = useState(null)
    const [includeWeekends, setIncludeWeekends] = useState(false)
    const [workingHoursFailed, setWorkingHoursFailed] = useState(false)
    const scopeProjectId = projectId || projectFilter
    const liveReviews = useMeetingReviewSelector(state => state.reviews)
    const seriesCategories = useMeetingReviewSelector(state => state.seriesCategories)
    const rules = useMeetingReviewSelector(state => state.rules)

    const range = useMemo(() => getMeetingStatsRange(period, anchorMs), [period, anchorMs])

    useEffect(() => {
        // The project tab writes its own URL (ProjectMeetingTimeView).
        if (!projectId) URLsSettings.push(URL_SETTINGS_MEETING_TIME)
    }, [projectId])

    useEffect(() => {
        if (!uid) return undefined
        let cancelled = false
        fetchWorkingHoursSettings(uid)
            .then(settings => {
                if (cancelled) return
                setWorkingHours(resolveWorkingHours(settings))
                setIncludeWeekends(resolveIncludeWeekends(settings))
            })
            .catch(error => {
                // The link to the settings stays; only the hours (and the meeting-free time) are left out.
                if (!cancelled) setWorkingHoursFailed(true)
                console.warn('[meetingReview] working hours could not be read', error?.message)
            })
        return () => {
            cancelled = true
        }
    }, [uid])

    useEffect(() => {
        setFilter(null)
    }, [scopeProjectId])

    const projectsById = useMemo(
        () => new Map((Array.isArray(loggedUserProjects) ? loggedUserProjects : []).map(item => [item.id, item])),
        [loggedUserProjects]
    )
    const projectName = id => projectsById.get(id)?.name || translate('Meeting project unknown')

    useEffect(() => {
        if (!uid) return undefined
        let cancelled = false
        setLoadState(current => ({ ...current, loading: true, error: '' }))
        setFilter(null)
        Promise.all([
            fetchMeetingStatsTasks(range.startMs, range.endMs),
            fetchMeetingReviewsInRange(uid, range.startMs - DAY_MS, range.endMs + DAY_MS),
        ])
            .then(([data, reviews]) => {
                if (cancelled) return
                setLoadState({
                    loading: false,
                    error: '',
                    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
                    reviews: reviews || {},
                    failed: data?.failedProjectIds || [],
                    truncated: !!data?.truncated,
                })
            })
            .catch(error => {
                if (cancelled) return
                console.error('[meetingReview] statistics could not be loaded', error)
                setLoadState({
                    loading: false,
                    error:
                        error?.code === 'offline'
                            ? translate('Meeting statistics offline')
                            : translate('Meeting statistics failed'),
                    tasks: [],
                    reviews: {},
                    failed: [],
                })
            })
        return () => {
            cancelled = true
        }
    }, [uid, range.startMs, range.endMs])

    const { stats, allStats, tasksById, entries } = useMemo(() => {
        // Live reviews win: a rating changed in the sheet shows here at once.
        const reviews = { ...loadState.reviews, ...liveReviews }
        const entries = buildMeetingStatsEntries({ tasks: loadState.tasks, reviews, seriesCategories, rules })
        const compute = scope =>
            computeMeetingTimeStats({
                entries,
                rangeStartMs: range.startMs,
                rangeEndMs: range.endMs,
                dayStartsMs: range.dayStartsMs,
                nowMs: Date.now(),
                projectId: scope,
            })
        const scoped = compute(scopeProjectId)
        return {
            stats: scoped,
            // The "By project" table always lists every project, also while one is selected.
            allStats: scopeProjectId ? compute(null) : scoped,
            tasksById: new Map(entries.map(entry => [entry.id, entry.task])),
            entries,
        }
    }, [loadState, liveReviews, seriesCategories, rules, range, scopeProjectId])

    const freeTimeSeries = useMemo(
        () =>
            workingHours
                ? computeMeetingFreeWorkTime({
                      entries,
                      workingHours,
                      includeWeekends,
                      dayStartsMs: range.dayStartsMs,
                      rangeEndMs: range.endMs,
                      nowMs: Date.now(),
                      projectId: scopeProjectId,
                  })
                : null,
        [entries, workingHours, includeWeekends, range, scopeProjectId]
    )

    const dateFormat = getDateFormat()
    const timeFormat = getTimeFormat()
    const total = stats.totalMs

    const openTask = id => {
        const task = tasksById.get(id)
        if (task) requestMeetingReview({ task, projectId: task.projectId, isEdit: true })
    }

    const drillRows =
        filter !== null ? filterMeetingStatRows(stats, filter) : period === MEETING_STATS_PERIOD_DAY ? stats.rows : []

    const renderRow = row => {
        const start = localizedMoment(row.startMs)
        const when =
            period === MEETING_STATS_PERIOD_DAY
                ? `${formatMeetingTime(row.startMs, timeFormat)}–${formatMeetingTime(row.endMs, timeFormat)}`
                : `${start.format('dd')} ${formatMeetingTime(row.startMs, timeFormat)}`
        let detail
        if (row.status === MEETING_ROW_EXCLUDED)
            detail = translate(EXCLUSION_LABEL_KEYS[row.excludedReason] || 'Meeting excluded invalid')
        else if (row.status === MEETING_ROW_NOT_ATTENDED) detail = translate('Meeting not attended short')
        else if (row.status === MEETING_ROW_PLANNED) detail = translate('Meeting still planned short')
        else {
            const parts = [formatMeetingDuration(row.countedMs)]
            if (row.adjusted)
                parts.push(
                    `✎ (${translate('Meeting planned short', { duration: formatMeetingDuration(row.plannedMs) })})`
                )
            if (row.overlapMs >= 60000) {
                const others = row.overlapWith
                    .map(id => stats.rows.find(item => item.id === id)?.name)
                    .filter(Boolean)
                    .join(', ')
                parts.push(`⚠ ${translate('Meeting overlap with', { names: others })}`)
            }
            if (row.notCheckedOff) parts.push(translate('Meeting not checked off'))
            detail = parts.join(' · ')
        }
        const categoryText = row.category
            ? categoryLabel(row.category)
            : row.suggestedCategory
              ? `${categoryLabel(row.suggestedCategory)}?`
              : translate('Meeting category open short')
        const usefulnessText = row.usefulness ? MEETING_USEFULNESS_EMOJI[row.usefulness] : MEETING_UNRATED_SYMBOL
        const counted = row.status === MEETING_ROW_COUNTED
        return (
            <TouchableOpacity
                key={row.id}
                testID={`meeting-stats-row-${row.id}`}
                onPress={() => openTask(row.id)}
                style={localStyles.drillRow}
            >
                <Text style={[localStyles.drillWhen, !counted && localStyles.muted]}>{when}</Text>
                <Text style={[localStyles.drillName, !counted && localStyles.muted]} numberOfLines={1}>
                    {row.name}
                </Text>
                {counted && (
                    <Text style={localStyles.drillCategory} numberOfLines={1}>
                        {`${categoryText} ${usefulnessText}`}
                    </Text>
                )}
                <Text style={[localStyles.drillDetail, !counted && localStyles.muted]}>{detail}</Text>
            </TouchableOpacity>
        )
    }

    const cell = (rowKey, bucket, ms, extraStyle) => (
        <TouchableOpacity
            key={`${rowKey}-${bucket}`}
            testID={`meeting-stats-cell-${rowKey}-${bucket || 'all'}`}
            disabled={!(ms > 0)}
            onPress={() => setFilter({ categoryRow: rowKey, usefulnessBucket: bucket })}
            style={[localStyles.cell, extraStyle]}
        >
            <Text style={[localStyles.cellText, !(ms > 0) && localStyles.muted]}>
                {ms > 0 ? formatMeetingHours(ms) : '–'}
            </Text>
        </TouchableOpacity>
    )

    return (
        <View style={localStyles.container} testID="meeting-time-statistics">
            <View style={[localStyles.header, mobile && localStyles.headerMobile]} testID="meeting-stats-header">
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Meeting time statistics')}</Text>
                <View style={localStyles.periodRow}>
                    {MEETING_STATS_PERIODS.map(value => (
                        <TouchableOpacity
                            key={value}
                            testID={`meeting-stats-period-${value}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected: period === value }}
                            onPress={() => setPeriod(value)}
                            style={[localStyles.periodButton, period === value && localStyles.periodButtonActive]}
                        >
                            <Text style={[localStyles.periodText, period === value && localStyles.periodTextActive]}>
                                {translate(PERIOD_LABEL_KEYS[value])}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>
            <Text style={localStyles.privacy}>{translate('Meeting statistics private hint')}</Text>
            {projectId ? (
                <Text style={localStyles.privacy} testID="meeting-stats-project-hint">
                    {translate('Meeting project scope hint')}
                </Text>
            ) : null}
            <View style={localStyles.workingHoursRow} testID="meeting-stats-working-hours">
                <Text style={localStyles.workingHoursText}>
                    {workingHours
                        ? translate(
                              workingHours.isDefault ? 'Meeting working window default' : 'Meeting working window',
                              { range: formatWorkingHoursRange(workingHours) }
                          )
                        : translate('Meeting working window unknown')}
                </Text>
                <TouchableOpacity
                    testID="meeting-stats-working-hours-link"
                    accessibilityRole="link"
                    onPress={openWorkingHoursSettings}
                >
                    <Text style={localStyles.link}>{translate('Meeting edit working window')}</Text>
                </TouchableOpacity>
            </View>
            {projectFilter && !projectId ? (
                <View style={localStyles.projectFilterRow} testID="meeting-stats-project-filter">
                    <Text style={localStyles.projectFilterText} numberOfLines={1}>
                        {translate('Meeting project filter', { name: projectName(projectFilter) })}
                    </Text>
                    <TouchableOpacity
                        testID="meeting-stats-project-filter-clear"
                        onPress={() => setProjectFilter(null)}
                    >
                        <Text style={localStyles.link}>{translate('Meeting show all projects')}</Text>
                    </TouchableOpacity>
                </View>
            ) : null}

            <View style={localStyles.navRow}>
                <TouchableOpacity
                    testID="meeting-stats-prev"
                    onPress={() => setAnchorMs(shiftMeetingStatsAnchor(period, anchorMs, -1))}
                >
                    <Text style={localStyles.navArrow}>‹</Text>
                </TouchableOpacity>
                <Text style={localStyles.rangeLabel} testID="meeting-stats-range">
                    {period === MEETING_STATS_PERIOD_WEEK ? `${translate('Meeting week short')} ` : ''}
                    {getMeetingStatsRangeLabel(range, dateFormat)}
                </Text>
                <TouchableOpacity
                    testID="meeting-stats-next"
                    onPress={() => setAnchorMs(shiftMeetingStatsAnchor(period, anchorMs, 1))}
                >
                    <Text style={localStyles.navArrow}>›</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="meeting-stats-today" onPress={() => setAnchorMs(Date.now())}>
                    <Text style={localStyles.link}>{translate('Today')}</Text>
                </TouchableOpacity>
            </View>

            {loadState.loading ? (
                <ActivityIndicator color={colors.Primary100} style={{ marginTop: 24 }} />
            ) : loadState.error ? (
                <Text style={localStyles.warning} testID="meeting-stats-error">
                    {loadState.error}
                </Text>
            ) : (
                <View>
                    {loadState.failed.length > 0 || loadState.truncated ? (
                        <Text style={localStyles.warning} testID="meeting-stats-incomplete">
                            {translate('Meeting statistics incomplete')}
                        </Text>
                    ) : null}

                    <MeetingFreeTimeSeries
                        key={`${period}-${range.startMs}`}
                        series={freeTimeSeries}
                        period={period}
                        calendarConnected={calendarConnected}
                        incomplete={loadState.failed.length > 0 || !!loadState.truncated}
                        workingHours={workingHours}
                        workingHoursFailed={workingHoursFailed}
                        includeWeekends={includeWeekends}
                        scopeProjectName={scopeProjectId ? projectName(scopeProjectId) : ''}
                        dateFormat={dateFormat}
                        timeFormat={timeFormat}
                    />

                    {total <= 0 ? (
                        <Text style={localStyles.empty} testID="meeting-stats-empty">
                            {translate('Meeting statistics empty')}
                        </Text>
                    ) : (
                        <View>
                            <Text style={localStyles.summary} testID="meeting-stats-summary">
                                {translate('Meeting stats summary', {
                                    total: formatMeetingHours(total),
                                    count: stats.countedAppointments,
                                    rated: Math.round(stats.ratedShare * 100),
                                })}
                            </Text>

                            <View
                                style={localStyles.bar}
                                accessibilityRole="image"
                                accessibilityLabel={translate('Meeting stats bar label')}
                            >
                                {stats.usefulnessSegments
                                    .filter(segment => segment.totalMs > 0)
                                    .map(segment => (
                                        <View
                                            key={segment.key}
                                            testID={`meeting-stats-bar-${segment.key}`}
                                            style={[
                                                localStyles.barSegment,
                                                {
                                                    flexGrow: segment.totalMs,
                                                    backgroundColor: USEFULNESS_COLORS[segment.key],
                                                },
                                            ]}
                                        />
                                    ))}
                            </View>
                            <View style={localStyles.legend}>
                                {stats.usefulnessSegments.map(segment => (
                                    <TouchableOpacity
                                        key={segment.key}
                                        testID={`meeting-stats-segment-${segment.key}`}
                                        disabled={!(segment.totalMs > 0)}
                                        onPress={() => setFilter({ categoryRow: null, usefulnessBucket: segment.key })}
                                        style={localStyles.legendItem}
                                    >
                                        <View
                                            style={[
                                                localStyles.legendSwatch,
                                                { backgroundColor: USEFULNESS_COLORS[segment.key] },
                                            ]}
                                        />
                                        <Text style={localStyles.legendText}>
                                            {`${bucketLabel(segment.key)} ${formatMeetingHours(segment.totalMs)} (${segment.sharePercent} %)`}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <Text style={localStyles.hint}>
                                {translate('Meeting shares of', { total: formatMeetingHours(total) })}
                            </Text>
                            {stats.limited && (
                                <Text style={localStyles.warning} testID="meeting-stats-limited">
                                    {translate('Meeting stats limited', {
                                        unrated: formatMeetingHours(stats.unratedMs),
                                    })}
                                </Text>
                            )}

                            <View style={localStyles.block}>
                                <Text style={localStyles.blockTitle} testID="meeting-stats-not-helpful">
                                    {translate('Meeting not helpful range', {
                                        min: formatMeetingHours(stats.notHelpfulRange.minMs),
                                        max: formatMeetingHours(stats.notHelpfulRange.maxMs),
                                    })}
                                    {stats.averagePerDay && period !== MEETING_STATS_PERIOD_DAY
                                        ? `  ${translate('Meeting per day average', {
                                              min: formatMeetingHours(stats.averagePerDay.notHelpfulMinMs),
                                              max: formatMeetingHours(stats.averagePerDay.notHelpfulMaxMs),
                                              days: stats.daysWithTime,
                                          })}`
                                        : ''}
                                </Text>
                                <Text style={localStyles.hint}>
                                    {translate('Meeting not helpful range explanation', {
                                        unrated: formatMeetingHours(stats.unratedMs),
                                    })}
                                </Text>
                            </View>

                            <ScrollView horizontal style={localStyles.block} contentContainerStyle={localStyles.table}>
                                <View>
                                    <View style={localStyles.tableRow}>
                                        <Text style={[localStyles.headCell, localStyles.firstCell]}>
                                            {translate('Meeting category')}
                                        </Text>
                                        <Text style={localStyles.headCell}>{translate('Meeting total')}</Text>
                                        <Text style={localStyles.headCell}>{translate('Meeting share')}</Text>
                                        {USEFULNESS_BUCKETS.map(bucket => (
                                            <Text key={bucket} style={localStyles.headCell}>
                                                {bucket === MEETING_UNRATED
                                                    ? MEETING_UNRATED_SYMBOL
                                                    : MEETING_USEFULNESS_EMOJI[bucket]}
                                            </Text>
                                        ))}
                                    </View>
                                    {stats.categoryRows.map(row => (
                                        <View
                                            key={row.key}
                                            style={localStyles.tableRow}
                                            testID={`meeting-stats-category-${row.key}`}
                                        >
                                            <View style={[localStyles.firstCell, localStyles.categoryCell]}>
                                                {row.key !== MEETING_CATEGORY_OPEN && (
                                                    <View
                                                        style={[
                                                            localStyles.dot,
                                                            { backgroundColor: MEETING_CATEGORY_COLORS[row.key] },
                                                        ]}
                                                    />
                                                )}
                                                <Text style={localStyles.cellText} numberOfLines={1}>
                                                    {categoryLabel(row.key)}
                                                </Text>
                                            </View>
                                            {cell(row.key, null, row.totalMs)}
                                            <Text
                                                style={[localStyles.cell, localStyles.cellText]}
                                            >{`${row.sharePercent} %`}</Text>
                                            {USEFULNESS_BUCKETS.map(bucket =>
                                                cell(row.key, bucket, row.byUsefulness[bucket])
                                            )}
                                        </View>
                                    ))}
                                    <View style={[localStyles.tableRow, localStyles.sumRow]}>
                                        <Text style={[localStyles.firstCell, localStyles.cellTextStrong]}>
                                            {translate('Meeting sum')}
                                        </Text>
                                        <Text style={[localStyles.cell, localStyles.cellTextStrong]}>
                                            {formatMeetingHours(total)}
                                        </Text>
                                        <Text style={[localStyles.cell, localStyles.cellTextStrong]}>100 %</Text>
                                        {stats.usefulnessSegments.map(segment => (
                                            <Text
                                                key={segment.key}
                                                style={[localStyles.cell, localStyles.cellTextStrong]}
                                            >
                                                {formatMeetingHours(segment.totalMs)}
                                            </Text>
                                        ))}
                                    </View>
                                </View>
                            </ScrollView>

                            <Text style={localStyles.hint} testID="meeting-stats-basis">
                                {translate('Meeting basis line', {
                                    planned: formatMeetingHours(stats.plannedBasisMs),
                                    adjusted: formatMeetingHours(stats.adjustedBasisMs),
                                    overlap: formatMeetingHours(stats.overlapSplitMs),
                                })}
                            </Text>
                            {stats.notCheckedOffMs > 0 && (
                                <Text style={localStyles.hint}>
                                    {translate('Meeting not checked off line', {
                                        time: formatMeetingHours(stats.notCheckedOffMs),
                                    })}
                                </Text>
                            )}
                        </View>
                    )}
                    {!projectId && allStats.projectRows.length > 0 && (
                        <ScrollView
                            horizontal
                            style={localStyles.block}
                            contentContainerStyle={localStyles.table}
                            testID="meeting-stats-projects"
                        >
                            <View>
                                <Text style={[localStyles.blockTitle, localStyles.tableTitle]}>
                                    {translate('Meeting by project')}
                                </Text>
                                <View style={localStyles.tableRow}>
                                    <Text style={[localStyles.headCell, localStyles.firstCell]}>
                                        {translate('Meeting project')}
                                    </Text>
                                    <Text style={localStyles.headCell}>{translate('Meeting total')}</Text>
                                    <Text style={localStyles.headCell}>{translate('Meeting share')}</Text>
                                    {USEFULNESS_BUCKETS.map(bucket => (
                                        <Text key={bucket} style={localStyles.headCell}>
                                            {bucket === MEETING_UNRATED
                                                ? MEETING_UNRATED_SYMBOL
                                                : MEETING_USEFULNESS_EMOJI[bucket]}
                                        </Text>
                                    ))}
                                </View>
                                {allStats.projectRows.map(row => {
                                    const selected = row.key === projectFilter
                                    return (
                                        <TouchableOpacity
                                            key={row.key}
                                            testID={`meeting-stats-project-${row.key}`}
                                            accessibilityRole="button"
                                            accessibilityState={{ selected }}
                                            onPress={() => setProjectFilter(selected ? null : row.key)}
                                            style={[localStyles.tableRow, selected && localStyles.selectedRow]}
                                        >
                                            <View style={[localStyles.firstCell, localStyles.categoryCell]}>
                                                <View
                                                    style={[
                                                        localStyles.dot,
                                                        {
                                                            backgroundColor:
                                                                projectsById.get(row.key)?.color || colors.Grey400,
                                                        },
                                                    ]}
                                                />
                                                <Text
                                                    style={[
                                                        localStyles.cellText,
                                                        localStyles.projectName,
                                                        selected && localStyles.cellTextSelected,
                                                    ]}
                                                    numberOfLines={1}
                                                >
                                                    {projectName(row.key)}
                                                </Text>
                                            </View>
                                            <Text style={[localStyles.cell, localStyles.cellText]}>
                                                {formatMeetingHours(row.totalMs)}
                                            </Text>
                                            <Text
                                                style={[localStyles.cell, localStyles.cellText]}
                                            >{`${row.sharePercent} %`}</Text>
                                            {USEFULNESS_BUCKETS.map(bucket => (
                                                <Text
                                                    key={bucket}
                                                    style={[
                                                        localStyles.cell,
                                                        localStyles.cellText,
                                                        !(row.byUsefulness[bucket] > 0) && localStyles.muted,
                                                    ]}
                                                >
                                                    {row.byUsefulness[bucket] > 0
                                                        ? formatMeetingHours(row.byUsefulness[bucket])
                                                        : '–'}
                                                </Text>
                                            ))}
                                        </TouchableOpacity>
                                    )
                                })}
                                <Text style={localStyles.hint}>{translate('Meeting by project hint')}</Text>
                            </View>
                        </ScrollView>
                    )}

                    {stats.stillPlannedMs > 0 && (
                        <Text style={localStyles.hint} testID="meeting-stats-still-planned">
                            {translate('Meeting still planned', { time: formatMeetingHours(stats.stillPlannedMs) })}
                        </Text>
                    )}

                    {drillRows.length > 0 || filter ? (
                        <View style={localStyles.block} testID="meeting-stats-drilldown">
                            <View style={localStyles.drillHeader}>
                                <Text style={localStyles.blockTitle}>
                                    {filter
                                        ? [
                                              filter.categoryRow ? categoryLabel(filter.categoryRow) : null,
                                              filter.usefulnessBucket ? bucketLabel(filter.usefulnessBucket) : null,
                                          ]
                                              .filter(Boolean)
                                              .join(' · ')
                                        : translate('Meeting appointments')}
                                    {filter
                                        ? ` · ${formatMeetingHours(drillRows.reduce((sum, row) => sum + row.countedMs, 0))}`
                                        : ''}
                                </Text>
                                {filter && (
                                    <TouchableOpacity
                                        testID="meeting-stats-clear-filter"
                                        onPress={() => setFilter(null)}
                                    >
                                        <Text style={localStyles.link}>{translate('Close')}</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                            {drillRows.map(renderRow)}
                            <Text style={localStyles.hint}>{translate('Meeting drilldown hint')}</Text>
                        </View>
                    ) : null}

                    {!projectId && rules.length > 0 && (
                        <View style={localStyles.block} testID="meeting-stats-rules">
                            <Text style={localStyles.blockTitle}>{translate('Meeting learned rules')}</Text>
                            {rules.map(rule => (
                                <View key={rule.pattern} style={localStyles.ruleRow}>
                                    <Text style={localStyles.cellText}>
                                        {translate('Meeting rule line', {
                                            pattern: rule.pattern,
                                            category: categoryLabel(rule.category),
                                            count: rule.corrections || 1,
                                        })}
                                    </Text>
                                    <TouchableOpacity
                                        testID={`meeting-rule-delete-${rule.pattern}`}
                                        onPress={() =>
                                            removeMeetingCategoryRule(uid, rule).catch(error =>
                                                console.error('[meetingReview] could not delete the rule', error)
                                            )
                                        }
                                    >
                                        <Text style={localStyles.link}>{translate('Meeting delete rule')}</Text>
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    )}
                </View>
            )}
            <Text style={[localStyles.hint, { marginTop: 24 }]}>
                {translate('Meeting statistics rules footer', { date: localizedMoment(Date.now()).format(dateFormat) })}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingBottom: 64,
    },
    // Same header box as the Statistics and Happiness tabs (StatisticsHeader, StatisticsSectionHeader,
    // UserHappiness): 32 px above the title row, 12 px below, on desktop and mobile. Without the top
    // padding the wrapping row packs to the top and sits on the tab divider (AT-3145 screenshot).
    header: {
        minHeight: 72,
        paddingTop: 32,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        rowGap: 8,
    },
    headerMobile: {
        flexDirection: 'column',
        alignItems: 'flex-start',
    },
    periodRow: {
        flexDirection: 'row',
        gap: 4,
    },
    periodButton: {
        paddingVertical: 4,
        paddingHorizontal: 12,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
    },
    periodButtonActive: {
        backgroundColor: colors.Primary100,
        borderColor: colors.Primary100,
    },
    periodText: {
        ...styles.subtitle2,
        color: colors.Text02,
    },
    periodTextActive: {
        color: '#ffffff',
    },
    privacy: {
        ...styles.caption2,
        color: colors.Text03,
    },
    workingHoursRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 8,
        rowGap: 2,
        marginTop: 8,
    },
    workingHoursText: {
        ...styles.body2,
        color: colors.Text02,
    },
    projectFilterRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 12,
        rowGap: 2,
        marginTop: 12,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Primary100,
        alignSelf: 'flex-start',
        maxWidth: '100%',
    },
    projectFilterText: {
        ...styles.subtitle2,
        color: colors.Text01,
        flexShrink: 1,
    },
    navRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 12,
    },
    navArrow: {
        ...styles.title6,
        color: colors.Text02,
        paddingHorizontal: 4,
    },
    rangeLabel: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
    summary: {
        ...styles.subtitle1,
        color: colors.Text01,
        marginTop: 16,
    },
    bar: {
        flexDirection: 'row',
        height: 16,
        marginTop: 8,
        gap: 2,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: colors.Surface,
    },
    barSegment: {
        flexBasis: 0,
        height: '100%',
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
    legendSwatch: {
        width: 10,
        height: 10,
        borderRadius: 2,
        marginRight: 6,
    },
    legendText: {
        ...styles.body2,
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
        marginTop: 24,
    },
    block: {
        marginTop: 24,
    },
    blockTitle: {
        ...styles.subtitle2,
        color: colors.Text01,
    },
    table: {
        flexDirection: 'column',
    },
    tableRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey200,
        minHeight: 32,
    },
    sumRow: {
        borderBottomWidth: 0,
    },
    selectedRow: {
        backgroundColor: colors.Grey200,
    },
    tableTitle: {
        marginBottom: 4,
    },
    projectName: {
        flexShrink: 1,
    },
    cellTextSelected: {
        ...styles.subtitle2,
    },
    headCell: {
        ...styles.caption1,
        color: colors.Text03,
        width: 72,
        textAlign: 'right',
    },
    firstCell: {
        width: 180,
        textAlign: 'left',
    },
    categoryCell: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    cell: {
        width: 72,
        alignItems: 'flex-end',
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
        textAlign: 'right',
    },
    muted: {
        color: colors.Text03,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    link: {
        ...styles.subtitle2,
        color: colors.Primary100,
    },
    drillHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    drillRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 12,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey200,
    },
    drillWhen: {
        ...styles.body2,
        color: colors.Text02,
        width: 96,
    },
    drillName: {
        ...styles.body2,
        color: colors.Text01,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 120,
    },
    drillCategory: {
        ...styles.caption1,
        color: colors.Text02,
    },
    drillDetail: {
        ...styles.caption2,
        color: colors.Text03,
    },
    ruleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 4,
    },
})
