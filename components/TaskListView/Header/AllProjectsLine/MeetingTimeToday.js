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
 * AT-3136 — today's "time to work" in the All projects line: the free time inside the working
 * hours is the one large figure ("6h 30m Time to work"); the working hours, the meeting time and
 * any sync/connect note sit before it as small secondary text ("9–18 · Meetings 2h 30m").
 *
 * Presentational only; `view` comes from `useMeetingTimeToday` (see utils/meetingTimeToday.js for
 * the rules). The large figure is calendar availability inside the working hours, not measured
 * work; the tooltip says so. Unknown values never render as numbers: without a connected calendar
 * there is no large figure at all, only the working time and a "Connect calendar" link.
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
            <Text style={localStyles.text} numberOfLines={1}>
                {hoursLabel}
            </Text>
        </TouchableOpacity>
    )

    let meetingsText = null
    // The large figure: the free working time, "…" while the meetings load, absent when unknown.
    let primaryValue = null
    let extra = null

    if (isReady) {
        meetingsText = `${translate('meetingTime meetings')} ${formatDurationCompact(view.meetingMinutes)}`
        primaryValue = formatDurationCompact(view.freeMinutes)
        if (syncFailed) {
            extra = (
                <Text style={[localStyles.text, localStyles.warning]} numberOfLines={1} testID="meeting-time-failed">
                    {translate('meetingTime sync failed')}
                </Text>
            )
        }
    } else if (status === MEETING_TIME_CALENDAR_LOADING) {
        meetingsText = `${translate('meetingTime meetings')} …`
        primaryValue = '…'
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

    const pending = (syncing || status === MEETING_TIME_CALENDAR_LOADING) && localStyles.pending

    // On mobile sizes AllProjectsLine puts this in its own row under the line (there is no room
    // beside the centred title). On narrow screens the secondary text wraps onto its own line under
    // the large figure (see mobileContainer); the figure and its label stay together.
    return (
        <View
            ref={setTooltip}
            style={[localStyles.container, mobile && localStyles.mobileContainer]}
            accessibilityLabel={tooltip}
            testID="meeting-time-today"
        >
            <View
                style={[localStyles.secondary, mobile && localStyles.mobileSecondary]}
                testID="meeting-time-secondary"
            >
                {hoursSegment}
                <Separator />
                <Text style={[localStyles.text, pending]} numberOfLines={1}>
                    {meetingsText}
                </Text>
                {extra && (
                    <>
                        <Separator />
                        {extra}
                    </>
                )}
            </View>
            {primaryValue && (
                <View style={[localStyles.primary, pending]} testID="meeting-time-primary">
                    <Text style={localStyles.primaryValue} numberOfLines={1} testID="meeting-time-primary-value">
                        {primaryValue}
                    </Text>
                    <Text style={localStyles.primaryLabel} numberOfLines={1}>
                        {translate('meetingTime time to work')}
                    </Text>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    // Baseline aligned, so the small secondary text sits on the large figure's baseline.
    container: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexShrink: 0,
        marginRight: 4,
    },
    // When the line has to wrap on a narrow screen, `wrap-reverse` stacks the large figure on top
    // and the secondary text under it, instead of leaving the figure below the small print.
    mobileContainer: {
        flexWrap: 'wrap-reverse',
        justifyContent: 'flex-end',
        flexShrink: 1,
        marginRight: 0,
    },
    secondary: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    mobileSecondary: {
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        flexShrink: 1,
    },
    primary: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginLeft: 12,
    },
    primaryValue: {
        ...styles.title6,
        lineHeight: 24,
        color: colors.Text01,
    },
    primaryLabel: {
        ...styles.caption2,
        color: colors.Text02,
        marginLeft: 6,
    },
    text: {
        ...styles.body3,
        color: colors.Text03,
    },
    separator: {
        ...styles.body3,
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
