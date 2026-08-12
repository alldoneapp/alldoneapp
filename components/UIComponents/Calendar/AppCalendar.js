import React from 'react'
import { View } from 'react-native'
import { Calendar, LocaleConfig } from 'react-native-calendars'
import { useSelector } from 'react-redux'

import styles, { colors, hexColorToRGBa } from '../../styles/global'
import Icon from '../../Icon'
import { locales } from '../../StatisticsView/StatisticsSection/CalendarLocales'

LocaleConfig.locales = locales

/**
 * The ONE calendar-grid configuration (MODAL_IMPROVEMENT_PLAN.md,
 * calendar-grids consolidation). Before this, the same react-native-calendars
 * theme + chevron arrows + locale wiring were copy-pasted into
 * DueDateCalendarModal, CustomFollowUpDateModal and CustomDateRangeModal, with
 * a fourth, drifted copy inline in ProjectHappinessView (different selection
 * colors, missing week styles). Every date picker renders this instead and
 * passes only what actually differs: min/max date, marking, day component.
 *
 * `firstDay` note: the legacy call sites passed `mondayFirstInCalendar` raw —
 * a boolean (or null via ContactsHelper) fed into a 0..6 numeric prop, working
 * only through JS arithmetic coercion. The ternary below preserves those exact
 * semantics explicitly.
 */
export default function AppCalendar(calendarProps) {
    const language = useSelector(state => state.loggedUser.language)
    const mondayFirstInCalendar = useSelector(state => state.loggedUser.mondayFirstInCalendar)
    LocaleConfig.defaultLocale = language

    return (
        <Calendar
            firstDay={mondayFirstInCalendar ? 1 : 0}
            renderArrow={renderCalendarArrow}
            theme={calendarTheme}
            {...calendarProps}
        />
    )
}

export const renderCalendarArrow = direction =>
    direction === 'left' ? (
        <View style={{ marginLeft: -10 }}>
            <Icon name="chevron-left" size={24} color={colors.Text03} />
        </View>
    ) : (
        <View style={{ marginRight: -10 }}>
            <Icon name="chevron-right" size={24} color={colors.Text03} />
        </View>
    )

export const calendarTheme = {
    backgroundColor: colors.Secondary400,
    calendarBackground: colors.Secondary400,
    textSectionTitleColor: colors.Text03,
    selectedDayBackgroundColor: '#00adf5',
    selectedDayTextColor: '#ffffff',
    todayTextColor: 'white',
    dayTextColor: colors.Text03,
    textDisabledColor: colors.Text02,
    dotColor: '#00adf5',
    selectedDotColor: '#ffffff',
    arrowColor: 'orange',
    disabledArrowColor: '#d9e1e8',
    monthTextColor: 'white',
    indicatorColor: 'blue',
    textDayFontFamily: styles.overline.fontFamily,
    textDayFontSize: 16,
    textDayFontWeight: '300',
    textDayHeaderFontFamily: styles.overline.fontFamily,
    textDayHeaderFontWeight: 'normal',
    textDayHeaderFontSize: styles.overline.fontSize,
    textMonthFontFamily: styles.subtitle1.fontFamily,
    textMonthFontWeight: '500',
    textMonthFontSize: styles.subtitle1.fontSize,
    'stylesheet.calendar.header': {
        header: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingVertical: 0,
            marginTop: 0,
            alignItems: 'center',
            paddingHorizontal: 0,
        },
        week: {
            marginTop: 5,
            flexDirection: 'row',
            justifyContent: 'space-between',
            borderBottomWidth: 1,
            paddingHorizontal: 0,
            paddingTop: 12,
            paddingBottom: 4,
            marginHorizontal: 0,
            borderBottomColor: hexColorToRGBa('#ffffff', 0.2),
        },
    },
    'stylesheet.calendar.main': {
        week: {
            marginTop: 7,
            marginBottom: 7,
            marginHorizontal: -4,
            flexDirection: 'row',
            justifyContent: 'space-around',
        },
    },
}
