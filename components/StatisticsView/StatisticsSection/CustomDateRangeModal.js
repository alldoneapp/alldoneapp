import React, { useState, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { Calendar, LocaleConfig } from 'react-native-calendars'
import moment from 'moment'
import Hotkeys from 'react-hot-keys'

import styles, { colors, hexColorToRGBa } from '../../styles/global'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import { translate } from '../../../i18n/TranslationService'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import { useSelector } from 'react-redux'
import { locales } from './CalendarLocales'
import { STATISTIC_RANGE_CUSTOM } from '../statisticsHelper'

LocaleConfig.locales = locales

export default function CustomDateRangeModal({ hidePopover, onGoBackPress, updateFilterData }) {
    const language = useSelector(state => state.loggedUser.language)
    const mondayFirstInCalendar = useSelector(state => state.loggedUser.mondayFirstInCalendar)
    const [markedDates, setMarkedDates] = useState({})
    const hasFirstDayRef = useRef(false)
    LocaleConfig.defaultLocale = language

    const onPressClose = () => {
        hidePopover()
    }

    const onPress = () => {
        const customDateRange = Object.keys(markedDates).sort((a, b) =>
            moment(a, 'YYYY-MM-DD').diff(moment(b, 'YYYY-MM-DD'))
        )
        hidePopover()
        updateFilterData(STATISTIC_RANGE_CUSTOM, customDateRange)
    }

    const funnyWhite = hexColorToRGBa('#FFFFFF', 0.2)
    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={localStyles.innerContainer}>
                <View style={localStyles.heading}>
                    <View style={localStyles.title}>
                        <Text style={[styles.title7, { color: 'white' }]}>{translate('Custom date range')}</Text>
                        <Text style={[styles.body2, { flex: 1, color: colors.Text03 }]}>
                            {translate('Custom date range subtitle')}
                        </Text>
                    </View>

                    <View style={localStyles.closeContainer}>
                        <TouchableOpacity style={localStyles.closeSubContainer} onPress={onPressClose}>
                            <Icon name="x" size={24} color={colors.Text03} />
                        </TouchableOpacity>
                    </View>
                </View>
                <View
                    style={{
                        marginTop: 20,
                        paddingHorizontal: 16,
                        borderBottomColor: funnyWhite,
                        paddingBottom: 16,
                    }}
                >
                    <Calendar
                        current={moment().format('YYYY-MM-DD')}
                        maxDate={moment().format('YYYY-MM-DD')}
                        onDayPress={e => {
                            setMarkedDates(stateMarkedDates => {
                                let markedDates = { ...stateMarkedDates } // markedDates must be immutable or the calendar won't update

                                const previousDate = moment(e.dateString, 'YYYY-MM-DD')
                                    .subtract(1, 'day')
                                    .format('YYYY-MM-DD')

                                if (e.dateString in markedDates) {
                                    if (markedDates[e.dateString].startingDay) {
                                        hasFirstDayRef.current = false
                                        return {}
                                    } else if (markedDates[e.dateString].endingDay) {
                                        markedDates[previousDate].endingDay = true
                                        delete markedDates[e.dateString]
                                        return markedDates
                                    } else {
                                        markedDates[e.dateString].endingDay = true
                                        const endDate = moment(e.dateString, 'YYYY-MM-DD')

                                        for (let date in markedDates) {
                                            if (moment(date, 'YYYY-MM-DD').diff(endDate, 'days') > 0) {
                                                delete markedDates[date]
                                            }
                                        }
                                        return markedDates
                                    }
                                } else {
                                    if (hasFirstDayRef.current) {
                                        let endDate

                                        for (let date in markedDates) {
                                            if (markedDates[date].endingDay) {
                                                endDate = moment(date, 'YYYY-MM-DD')
                                            }
                                        }
                                        const pressedDate = moment(e.dateString, 'YYYY-MM-DD')
                                        let diff = pressedDate.diff(endDate, 'days') + 1
                                        if (diff > 0) {
                                            markedDates[endDate.format('YYYY-MM-DD')].endingDay = false
                                            for (let i = 1; i < diff - 1; i++) {
                                                markedDates[endDate.clone().add(i, 'day').format('YYYY-MM-DD')] = {
                                                    color: colors.Primary200,
                                                    selected: true,
                                                    startingDay: false,
                                                    endingDay: false,
                                                }
                                            }
                                            markedDates[
                                                endDate
                                                    .clone()
                                                    .add(diff - 1, 'day')
                                                    .format('YYYY-MM-DD')
                                            ] = {
                                                color: colors.Primary200,
                                                selected: true,
                                                startingDay: false,
                                                endingDay: true,
                                            }
                                        }
                                        return markedDates
                                    } else {
                                        markedDates[e.dateString] = {
                                            startingDay: true,
                                            color: colors.Primary200,
                                            selected: true,
                                            endingDay: true,
                                        }
                                        hasFirstDayRef.current = true
                                        return markedDates
                                    }
                                }
                            })
                        }}
                        firstDay={mondayFirstInCalendar}
                        markingType={'period'}
                        markedDates={markedDates}
                        renderArrow={direction =>
                            direction === 'left' ? (
                                <View style={{ marginLeft: -10 }}>
                                    <Icon name="chevron-left" size={24} color={colors.Text03} />
                                </View>
                            ) : (
                                <View style={{ marginRight: -10 }}>
                                    <Icon name="chevron-right" size={24} color={colors.Text03} />
                                </View>
                            )
                        }
                        theme={calendarTheme}
                    />
                </View>
                <Hotkeys keyName={'B'} onKeyDown={onGoBackPress} filter={e => true}>
                    <TouchableOpacity
                        style={{
                            height: 56,
                            paddingLeft: 16,
                            flexDirection: 'row',
                            alignItems: 'center',
                            borderTopWidth: 1,
                            borderTopColor: funnyWhite,
                            borderBottomWidth: 1,
                            borderBottomColor: funnyWhite,
                        }}
                        onPress={onGoBackPress}
                    >
                        <Icon name="chevron-left" size={24} color={colors.Text03} />
                        <View style={{ marginLeft: 6 }}>
                            <Text style={[styles.subtitle1, { color: 'white' }]}>{translate('Back')}</Text>
                        </View>

                        <View style={localStyles.shortcut}>
                            <Shortcut text={'B'} theme={SHORTCUT_LIGHT} />
                        </View>
                    </TouchableOpacity>
                </Hotkeys>
                <View style={localStyles.buttonContainer}>
                    <Button title={translate('Show range')} type={'primary'} onPress={onPress} />
                </View>
            </View>
        </View>
    )
}

const calendarTheme = {
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

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    innerContainer: {
        flex: 1,
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    closeSubContainer: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: -4,
    },
    closeContainer: {
        position: 'absolute',
        top: 7,
        right: 0,
        height: 40,
        transform: [{ translateX: -10 }],
    },
    heading: {
        flex: 1,
        flexDirection: 'row',
        paddingLeft: 16,
        paddingTop: 8,
        paddingRight: 8,
    },
    title: {
        flex: 1,
        flexDirection: 'column',
        marginTop: 8,
    },
    shortcut: {
        position: 'absolute',
        right: 16,
    },
    buttonContainer: {
        flex: 1,
        flexDirection: 'row',
        height: 72,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
    },
})
