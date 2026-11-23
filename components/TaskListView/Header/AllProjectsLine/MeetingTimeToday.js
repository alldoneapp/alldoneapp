import React, { useCallback } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { navigateToSettings, setSelectedNavItem } from '../../../../redux/actions'
import NavigationService from '../../../../utils/NavigationService'
import { DV_TAB_PROJECT_PROPERTIES, DV_TAB_SETTINGS_CUSTOMIZATIONS } from '../../../../utils/TabNavigationConstants'
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
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const defaultProjectIndex = useSelector(state => {
        const { defaultProjectId, projectIds } = state.loggedUser
        const projectId = defaultProjectId || (projectIds || [])[0]
        return state.loggedUserProjectsMap?.[projectId]?.index
    })

    const tooltip = view && view.workingHours ? buildTooltip(view) : ''
    const setTooltip = useCallback(node => node?.setAttribute?.('title', tooltip), [tooltip])

    if (!view || !view.workingHours) return null

    const openWorkingHoursSettings = () => {
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_CUSTOMIZATIONS }))
        NavigationService.navigate('SettingsView')
    }

    const openCalendarConnection = () => {
        dispatch(setSelectedNavItem(DV_TAB_PROJECT_PROPERTIES))
        NavigationService.navigate('ProjectDetailedView', { projectIndex: defaultProjectIndex })
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

    const valueStyle = [localStyles.text, mobile && localStyles.mobileText, syncing && localStyles.pending]

    if (mobile) {
        // Two short lines; the working hours stay reachable through the tooltip / settings.
        return (
            <View
                ref={setTooltip}
                style={localStyles.mobileContainer}
                accessibilityLabel={tooltip}
                testID="meeting-time-today"
            >
                <Text style={valueStyle} numberOfLines={1}>
                    {meetingsText}
                </Text>
                {freeText ? (
                    <Text style={valueStyle} numberOfLines={1}>
                        {freeText}
                        {workingHours.isDefault ? ` (${range})` : ''}
                        {syncFailed ? ' ⚠' : ''}
                    </Text>
                ) : (
                    extra
                )}
            </View>
        )
    }

    return (
        <View ref={setTooltip} style={localStyles.container} accessibilityLabel={tooltip} testID="meeting-time-today">
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
        flexDirection: 'column',
        alignItems: 'flex-end',
        justifyContent: 'center',
        flexShrink: 0,
        marginRight: 2,
    },
    text: {
        ...styles.caption2,
        color: colors.Text02,
    },
    mobileText: {
        fontSize: 11,
        lineHeight: 16,
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
