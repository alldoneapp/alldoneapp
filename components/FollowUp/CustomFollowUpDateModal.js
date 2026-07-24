import React, { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors, hexColorToRGBa } from '../styles/global'
import Icon from '../Icon'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { Calendar, LocaleConfig } from 'react-native-calendars'
import moment from 'moment'
import CloseButton from './CloseButton'
import Shortcut, { SHORTCUT_LIGHT } from '../UIControls/Shortcut'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import { FOLLOW_UP_CUSTOM_DUE_DATE_MODAL_ID, removeModal, storeModal } from '../ModalsManager/modalsManager'
import { locales } from '../StatisticsView/StatisticsSection/CalendarLocales'
import { translate } from '../../i18n/TranslationService'
import { applyPopoverWidth } from '../../utils/HelperFunctions'

LocaleConfig.locales = locales

const funnyWhite = hexColorToRGBa('#FFFFFF', 0.2)
export default function CustomFollowUpDateModal({ selectDate, backToDueDate, hidePopover }) {
    const language = useSelector(state => state.loggedUser.language)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const mondayFirstInCalendar = useSelector(state => state.loggedUser.mondayFirstInCalendar)
    LocaleConfig.defaultLocale = language

    const onPress = e => {
        selectDate('', moment(e.dateString, 'YYYY-MM-DD'))
    }

    const closePopup = e => {
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }
        hidePopover()
    }

    useEffect(() => {
        storeModal(FOLLOW_UP_CUSTOM_DUE_DATE_MODAL_ID)
        return () => {
            removeModal(FOLLOW_UP_CUSTOM_DUE_DATE_MODAL_ID)
        }
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={localStyles.heading}>
                <View style={localStyles.title}>
                    <Text style={[styles.title7, { color: 'white' }]}>{translate('Custom date')}</Text>
                    <Text style={[styles.body2, { color: colors.Text03, width: 273 }]}>
                        {translate('Pick a date for the follow up')}
                    </Text>
                </View>
            </View>
            <View style={localStyles.calendarContainer}>
                <Calendar
                    current={moment().format('YYYY-MM-DD')}
                    minDate={moment().format('YYYY-MM-DD')}
                    onDayPress={onPress}
                    firstDay={mondayFirstInCalendar}
                    markingType={'simple'}
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
            <Hotkeys keyName={'B'} onKeyDown={backToDueDate} filter={e => true}>
                <TouchableOpacity style={localStyles.backContainer} onPress={backToDueDate}>
                    <Icon name="chevron-left" size={24} color={colors.Text03} />
                    <Text style={[styles.subtitle1, localStyles.backText]}>{translate('Select reminder')}</Text>

                    {!mobile && (
                        <View style={localStyles.shortcut}>
                            <Shortcut text={'B'} theme={SHORTCUT_LIGHT} />
                        </View>
                    )}
                </TouchableOpacity>
            </Hotkeys>
            <CloseButton close={closePopup} />
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
        // width: 305,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    closeSubContainer: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: -4,
    },
    closeContainer: {
        height: 40,
        transform: [{ translateX: -10 }],
    },
    heading: {
        flexDirection: 'row',
        paddingLeft: 16,
        paddingRight: 8,
    },
    calendarContainer: {
        marginTop: 10,
        paddingHorizontal: 16,
        borderBottomColor: funnyWhite,
    },
    backContainer: {
        flexDirection: 'row',
        paddingVertical: 16,
        paddingLeft: 16,
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
    },
    backText: {
        color: '#FFFFFF',
        fontWeight: '500',
        marginLeft: 8,
    },
    shortcut: {
        position: 'absolute',
        marginTop: 4,
        right: 16,
    },
})
