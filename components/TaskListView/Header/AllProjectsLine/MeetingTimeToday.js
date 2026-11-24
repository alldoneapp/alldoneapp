import React, { useCallback } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import NavigationService from '../../../../utils/NavigationService'
import { DV_TAB_SETTINGS_INTEGRATIONS, DV_TAB_SETTINGS_MEETING_TIME } from '../../../../utils/TabNavigationConstants'
import SettingsHelper from '../../../SettingsView/SettingsHelper'
import {
    MEETING_TIME_CALENDAR_LOADING,
    MEETING_TIME_CALENDAR_UNAVAILABLE,
    MEETING_TIME_NO_CALENDAR,
    MEETING_TIME_READY,
    WORKDAY_AFTER,
    formatClockTime,
    formatDurationCompact,
    formatWorkingHoursRange,
} from '../../../../utils/meetingTimeToday'
import { CALENDAR_SYNC_FAILED, CALENDAR_SYNC_SYNCING } from '../../../../utils/calendarSyncStatus'

/**
 * AT-3136 — today's "time to work" in the All projects line. The free time inside the working
 * hours is the one large figure; everything else stands to its RIGHT as two small stacked lines:
 *
 *     1h 30m  Time to work
 *             7h 30m meetings
 *
 * Nothing stands before the figure. The working hours ("9–18", or the assumed default) are not
 * shown in the line; the tooltip (`title`) and the accessibility label carry them together with
 * the full explanation, and the whole display opens Settings → Meeting time (the meeting
 * statistics, AT-3145), which links on to the settings where the working hours are edited.
 *
 * Presentational only; `view` comes from `useMeetingTimeToday` (see utils/meetingTimeToday.js for
 * the rules). The large figure is the calendar-free time still AHEAD inside today's working hours
 * (from now, or from the start before the working day, until the end; 0 after it), not measured
 * work. The meeting figure is the whole working day's. The tooltip says both, with the clock times
 * ("from 14:05 to 17:00"), and is re-rendered with every minute tick of the hook. Unknown values never render as numbers: without a connected calendar
 * or with unavailable calendar data there is no large figure at all.
 *
 * `density` comes from AllProjectsLine, which measures the room in its row (mobile sizes put the
 * display in the same row as "All projects", see getMeetingTimeDensity):
 * - full: figure + "Time to work" / "7h 30m meetings"
 * - compact: figure + "7h 30m" / "Meetings" (the "Time to work" label is left out)
 * - minimal: the figure only; the meeting time stays in the tooltip and the accessibility label
 */

export const MEETING_TIME_DENSITY_FULL = 'full'
export const MEETING_TIME_DENSITY_COMPACT = 'compact'
export const MEETING_TIME_DENSITY_MINIMAL = 'minimal'

// Widths of the whole All projects line (its onLayout width, padding included) from which the
// display gets the compact and the full form on mobile sizes. Measured in the browser with the
// German labels (the longest of en/de/es in this display is "Tiempo para trabajar"): at 390px the
// line is ~358px wide and has room for the compact form beside the avatar, "All projects" and the
// menu; at 360px and below only the figure fits.
export const MEETING_TIME_COMPACT_MIN_LINE_WIDTH = 340
export const MEETING_TIME_FULL_MIN_LINE_WIDTH = 440

// Room taken by the sync warning icon (12px + margin, with some slack).
export const MEETING_TIME_WARNING_WIDTH = 20

// `withWarning`: the sync warning icon is shown too, so each form needs that much more room
// (otherwise "All projects" is the one that gets truncated).
export const getMeetingTimeDensity = (mobile, lineWidth, withWarning = false) => {
    if (!mobile) return MEETING_TIME_DENSITY_FULL
    // Not measured yet: start small, so the first frame never overlaps the title.
    if (!lineWidth) return MEETING_TIME_DENSITY_MINIMAL
    const room = lineWidth - (withWarning ? MEETING_TIME_WARNING_WIDTH : 0)
    if (room >= MEETING_TIME_FULL_MIN_LINE_WIDTH) return MEETING_TIME_DENSITY_FULL
    if (room >= MEETING_TIME_COMPACT_MIN_LINE_WIDTH) return MEETING_TIME_DENSITY_COMPACT
    return MEETING_TIME_DENSITY_MINIMAL
}

// "17:00" → "17:00", "08:30" → "8:30" (same 24 h form as formatClockTime).
const shortClock = clock => {
    const [hours, minutes] = clock.split(':')
    return `${Number(hours)}:${minutes}`
}

const buildSummary = view => {
    const meetings = formatDurationCompact(view.meetingMinutes)
    if (view.workdayPhase === WORKDAY_AFTER) return translate('meetingTime summary after hours', { meetings })
    return translate('meetingTime summary', {
        meetings,
        free: formatDurationCompact(view.freeMinutes),
        from: Number.isFinite(view.remainingFromMs)
            ? formatClockTime(view.remainingFromMs)
            : shortClock(view.workingHours.start),
        until: shortClock(view.workingHours.end),
    })
}

const buildTooltip = view => {
    const range = formatWorkingHoursRange(view.workingHours)
    const hours = view.workingHours.isDefault
        ? translate('meetingTime default working hours', { range })
        : translate('meetingTime working hours', { range })
    const parts = [hours]
    if (view.status === MEETING_TIME_READY) {
        parts.push(buildSummary(view))
        if (view.workBlockCount > 0)
            parts.push(translate('meetingTime work blocks hint', { count: view.workBlockCount }))
        if (view.syncStatus === CALENDAR_SYNC_SYNCING) parts.push(translate('meetingTime syncing'))
        if (view.syncStatus === CALENDAR_SYNC_FAILED) parts.push(translate('meetingTime sync failed hint'))
    } else if (view.status === MEETING_TIME_CALENDAR_LOADING) {
        parts.push(translate('meetingTime loading hint'))
    } else if (view.status === MEETING_TIME_NO_CALENDAR) {
        parts.push(translate('meetingTime no calendar hint'))
    } else if (view.status === MEETING_TIME_CALENDAR_UNAVAILABLE) {
        parts.push(translate('meetingTime unavailable hint'))
    }
    return parts.join(' ')
}

// AT-3145: the display leads to the meeting time statistics (categories and usefulness of the
// meetings behind the figure). They link on to Settings > Customizations, where the working hours
// used here are edited (meeting link settings, PublicBookingSettings).
const openMeetingStatistics = () => {
    SettingsHelper.processURLSettingsTab(NavigationService, DV_TAB_SETTINGS_MEETING_TIME)
}

// Calendars are account-level connections in Settings > Integrations since the July 2026
// integrations overhaul; the project properties no longer have a calendar section.
const openCalendarConnection = () => {
    SettingsHelper.processURLSettingsTab(NavigationService, DV_TAB_SETTINGS_INTEGRATIONS)
}

const SyncFailedIcon = () => (
    <View style={localStyles.warningIcon} testID="meeting-time-failed">
        <Icon name="alert-circle" size={12} color={colors.UtilityOrange200} />
    </View>
)

// Minimal form without a figure: an icon stands for the text, which stays in the tooltip and the
// accessibility label ("Connect calendar" in link blue, "Calendar data unavailable" in orange).
const StatusIcon = ({ name, color, testID }) => (
    <View testID={testID}>
        <Icon name={name} size={18} color={color} />
    </View>
)

export default function MeetingTimeToday({ view, density = MEETING_TIME_DENSITY_FULL }) {
    const tooltip = view && view.workingHours ? buildTooltip(view) : ''
    const setTooltip = useCallback(node => node?.setAttribute?.('title', tooltip), [tooltip])

    if (!view || !view.workingHours) return null

    const { status } = view
    const isReady = status === MEETING_TIME_READY
    const loading = status === MEETING_TIME_CALENDAR_LOADING
    const syncing = isReady && view.syncStatus === CALENDAR_SYNC_SYNCING
    const syncFailed = isReady && view.syncStatus === CALENDAR_SYNC_FAILED
    const full = density === MEETING_TIME_DENSITY_FULL
    const compact = density === MEETING_TIME_DENSITY_COMPACT

    // The large figure: the free working time, "…" while the meetings load, absent when unknown.
    let primaryValue = null
    // The two small lines to the right of the figure (either may be left out).
    let firstLine = null
    let secondLine = null
    let linkStyle = false
    let statusIcon = null

    if (isReady || loading) {
        const meetings = isReady ? formatDurationCompact(view.meetingMinutes) : '…'
        primaryValue = isReady ? formatDurationCompact(view.freeMinutes) : '…'
        if (full) {
            firstLine = translate('meetingTime time to work')
            secondLine = translate('meetingTime meetings duration', { duration: meetings })
        } else if (compact) {
            firstLine = meetings
            secondLine = translate('meetingTime meetings')
        }
    } else if (status === MEETING_TIME_NO_CALENDAR) {
        if (full) firstLine = translate('meetingTime time to work')
        if (full || compact) secondLine = translate('meetingTime connect calendar')
        else statusIcon = { name: 'calendar', color: colors.Primary100, testID: 'meeting-time-connect-icon' }
        linkStyle = true
    } else if (status === MEETING_TIME_CALENDAR_UNAVAILABLE) {
        if (full) firstLine = translate('meetingTime time to work')
        if (full || compact) secondLine = translate('meetingTime calendar unavailable')
        else
            statusIcon = {
                name: 'alert-circle',
                color: colors.UtilityOrange200,
                testID: 'meeting-time-unavailable-icon',
            }
    } else {
        return null
    }

    const pending = (syncing || loading) && localStyles.pending
    // Without a calendar the display is the way to connect one; otherwise it leads to the meeting
    // statistics (which link to the working hours it is computed from).
    const onPress = status === MEETING_TIME_NO_CALENDAR ? openCalendarConnection : openMeetingStatistics
    const hasLines = !!(firstLine || secondLine)

    return (
        <TouchableOpacity
            onPress={onPress}
            accessibilityRole={status === MEETING_TIME_NO_CALENDAR ? 'link' : 'button'}
            accessibilityLabel={tooltip}
            style={[localStyles.touchable, !full && localStyles.touchableNarrow]}
            testID="meeting-time-today"
        >
            <View ref={setTooltip} style={localStyles.container}>
                {primaryValue && (
                    <Text
                        style={[localStyles.primaryValue, !full && localStyles.primaryValueNarrow, pending]}
                        numberOfLines={1}
                        testID="meeting-time-primary-value"
                    >
                        {primaryValue}
                    </Text>
                )}
                {hasLines && (
                    <View
                        style={[
                            localStyles.lines,
                            primaryValue && (full ? localStyles.linesBesideValue : localStyles.linesBesideValueNarrow),
                        ]}
                        testID="meeting-time-secondary"
                    >
                        {firstLine && (
                            <Text style={localStyles.firstLine} numberOfLines={1} testID="meeting-time-first-line">
                                {firstLine}
                            </Text>
                        )}
                        {secondLine && (
                            <View style={localStyles.secondLineRow}>
                                <Text
                                    style={[localStyles.secondLine, pending, linkStyle && localStyles.link]}
                                    numberOfLines={1}
                                    testID={linkStyle ? 'meeting-time-connect' : 'meeting-time-second-line'}
                                >
                                    {secondLine}
                                </Text>
                                {syncFailed && <SyncFailedIcon />}
                            </View>
                        )}
                    </View>
                )}
                {statusIcon && <StatusIcon {...statusIcon} />}
                {/* Minimal form: the warning stays visible beside the figure alone. */}
                {syncFailed && !secondLine && <SyncFailedIcon />}
            </View>
        </TouchableOpacity>
    )
}

const SMALL_LINE = {
    ...styles.body3,
    fontSize: 11,
    lineHeight: 14,
}

const localStyles = StyleSheet.create({
    touchable: {
        flexShrink: 1,
        minWidth: 0,
        marginRight: 4,
    },
    // Compact and minimal forms (narrow mobile lines): tighter, so "All projects" keeps its room.
    touchableNarrow: {
        marginRight: 0,
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        minWidth: 0,
    },
    primaryValue: {
        ...styles.title6,
        lineHeight: 24,
        color: colors.Text01,
        flexShrink: 0,
    },
    primaryValueNarrow: {
        fontSize: 18,
        lineHeight: 22,
    },
    lines: {
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-start',
        flexShrink: 1,
        minWidth: 0,
    },
    linesBesideValue: {
        marginLeft: 8,
    },
    linesBesideValueNarrow: {
        marginLeft: 6,
    },
    firstLine: {
        ...SMALL_LINE,
        color: colors.Text02,
    },
    secondLineRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minWidth: 0,
    },
    secondLine: {
        ...SMALL_LINE,
        color: colors.Text03,
        flexShrink: 1,
    },
    warningIcon: {
        marginLeft: 4,
    },
    pending: {
        opacity: 0.6,
    },
    link: {
        color: colors.Primary100,
    },
})
