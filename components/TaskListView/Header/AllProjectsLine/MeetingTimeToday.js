import React, { useCallback } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import NavigationService from '../../../../utils/NavigationService'
import { DV_TAB_SETTINGS_CUSTOMIZATIONS, DV_TAB_SETTINGS_INTEGRATIONS } from '../../../../utils/TabNavigationConstants'
import SettingsHelper from '../../../SettingsView/SettingsHelper'
import {
    MEETING_TIME_CALENDAR_LOADING,
    MEETING_TIME_CALENDAR_UNAVAILABLE,
    MEETING_TIME_NO_CALENDAR,
    MEETING_TIME_READY,
    formatDurationCompact,
    formatWorkingHoursRange,
} from '../../../../utils/meetingTimeToday'
import { CALENDAR_SYNC_FAILED, CALENDAR_SYNC_SYNCING } from '../../../../utils/calendarSyncStatus'

/**
 * AT-3136 — compact "Meetings 2h 30m · Calendar-free 5h 30m" in the All projects line.
 *
 * Presentational only; `view` comes from `useMeetingTimeToday` (see utils/meetingTimeToday.js for
 * the rules). The second figure is calendar availability inside the working hours, not measured
 * work, and is labelled so. Unknown values never render as numbers: without a connected calendar
 * only the working time and a "Connect calendar" link are shown.
 */

const buildTooltip = view => {
    const range = formatWorkingHoursRange(view.workingHours)
    const hours = view.workingHours.isDefault
        ? translate('meetingTime default working hours', { range })
        : translate('meetingTime working hours', { range })
    const parts = [hours]
    if (view.status === MEETING_TIME_READY) {
        parts.push(
            translate('meetingTime summary', {
                meetings: formatDurationCompact(view.meetingMinutes),
                free: formatDurationCompact(view.freeMinutes),
            })
        )
        if (view.syncStatus === CALENDAR_SYNC_SYNCING) parts.push(translate('meetingTime syncing'))
        if (view.syncStatus === CALENDAR_SYNC_FAILED) parts.push(translate('meetingTime sync failed hint'))
    } else if (view.status === MEETING_TIME_NO_CALENDAR) {
        parts.push(translate('meetingTime no calendar hint'))
    } else if (view.status === MEETING_TIME_CALENDAR_UNAVAILABLE) {
        parts.push(translate('meetingTime unavailable hint'))
    }
    return parts.join(' ')
}

const Separator = () => <Text style={localStyles.separator}> · </Text>

export default function MeetingTimeToday({ view }) {
    const mobile = useSelector(state => state.smallScreenNavigation)

    const tooltip = view && view.workingHours ? buildTooltip(view) : ''
    const setTooltip = useCallback(node => node?.setAttribute?.('title', tooltip), [tooltip])

    if (!view || !view.workingHours) return null

    // Settings > Customizations holds the meeting link settings (PublicBookingSettings) whose
    // working hours are used here.
    const openWorkingHoursSettings = () => {
        SettingsHelper.processURLSettingsTab(NavigationService, DV_TAB_SETTINGS_CUSTOMIZATIONS)
    }

    // Calendars are account-level connections in Settings > Integrations since the July 2026
    // integrations overhaul; the project properties no longer have a calendar section.
    const openCalendarConnection = () => {
        SettingsHelper.processURLSettingsTab(NavigationService, DV_TAB_SETTINGS_INTEGRATIONS)
    }

    const { status, workingHours } = view
    const range = formatWorkingHoursRange(workingHours)
    const hoursLabel = workingHours.isDefault ? translate('meetingTime default hours', { range }) : range
    const isReady = status === MEETING_TIME_READY
    const syncing = isReady && view.syncStatus === CALENDAR_SYNC_SYNCING
    const syncFailed = isReady && view.syncStatus === CALENDAR_SYNC_FAILED

    const hoursSegment = (
        <TouchableOpacity onPress={openWorkingHoursSettings} accessibilityRole="link" testID="meeting-time-hours">
            <Text style={[localStyles.text, localStyles.hours]} numberOfLines={1}>
                {hoursLabel}
            </Text>
        </TouchableOpacity>
    )

    let meetingsText = null
    let freeText = null
    let extra = null

    if (isReady) {
        meetingsText = `${translate('meetingTime meetings')} ${formatDurationCompact(view.meetingMinutes)}`
        freeText = `${translate('meetingTime calendar free')} ${formatDurationCompact(view.freeMinutes)}`
        if (syncFailed) {
            extra = (
                <Text style={[localStyles.text, localStyles.warning]} numberOfLines={1} testID="meeting-time-failed">
                    {translate('meetingTime sync failed')}
                </Text>
            )
        }
    } else if (status === MEETING_TIME_CALENDAR_LOADING) {
        meetingsText = `${translate('meetingTime meetings')} …`
        freeText = `${translate('meetingTime calendar free')} …`
    } else if (status === MEETING_TIME_CALENDAR_UNAVAILABLE) {
        meetingsText = translate('meetingTime calendar unavailable')
    } else if (status === MEETING_TIME_NO_CALENDAR) {
        meetingsText = `${translate('meetingTime working time')} ${formatDurationCompact(view.windowMinutes)}`
        extra = (
            <TouchableOpacity onPress={openCalendarConnection} accessibilityRole="link" testID="meeting-time-connect">
                <Text style={[localStyles.text, localStyles.link]} numberOfLines={1}>
                    {translate('meetingTime connect calendar')}
                </Text>
            </TouchableOpacity>
        )
    } else {
        return null
    }

    const valueStyle = [localStyles.text, syncing && localStyles.pending]

    // On mobile sizes AllProjectsLine puts this in its own row under the line (there is no room
    // beside the centred title), so the same single line is used and may wrap on very narrow
    // screens instead of overflowing.
    return (
        <View
            ref={setTooltip}
            style={[localStyles.container, mobile && localStyles.mobileContainer]}
            accessibilityLabel={tooltip}
            testID="meeting-time-today"
        >
            {hoursSegment}
            <Separator />
            <Text style={valueStyle} numberOfLines={1}>
                {meetingsText}
            </Text>
            {freeText && (
                <>
                    <Separator />
                    <Text style={valueStyle} numberOfLines={1}>
                        {freeText}
                    </Text>
                </>
            )}
            {extra && (
                <>
                    <Separator />
                    {extra}
                </>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
        marginRight: 4,
    },
    mobileContainer: {
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        flexShrink: 1,
        marginRight: 0,
    },
    text: {
        ...styles.caption2,
        color: colors.Text02,
    },
    hours: {
        color: colors.Text03,
    },
    separator: {
        ...styles.caption2,
        color: colors.Text03,
    },
    pending: {
        opacity: 0.6,
    },
    warning: {
        color: colors.UtilityOrange200,
    },
    link: {
        color: colors.Primary100,
    },
})
