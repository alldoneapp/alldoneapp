import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import Backend from '../../../utils/BackendBridge'
import useWindowSize from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import moment from 'moment'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import store from '../../../redux/store'
import { translate } from '../../../i18n/TranslationService'
import { setUserDateFormat, setUserFirstDayInCalendar } from '../../../utils/backends/Users/usersFirestore'

export const DATE_FORMAT_EUROPE = 'DD.MM.YYYY'
export const DATE_FORMAT_AMERICA = 'MM.DD.YYYY'

export const TIME_FORMAT_EUROPE = 'HH:mm'
export const TIME_FORMAT_AMERICA = 'hh:mm a'
export const TIME_FORMAT_EUROPE_S = 'HH:mm:ss'
export const TIME_FORMAT_AMERICA_S = 'hh:mm:ss a'

export const SUNDAY_FIRST_IN_CALENDAR = 0
export const MONDAY_FIRST_IN_CALENDAR = 1

export default function DateFormatPickerModal({ userId, dateFormat, closePopover }) {
    const formatOptions = [
        { symbol: 'DMY', format: DATE_FORMAT_EUROPE, shortcut: '1' },
        { symbol: 'MDY', format: DATE_FORMAT_AMERICA, shortcut: '2' },
    ]
    const [width, height] = useWindowSize()
    const mobile = useSelector(state => state.smallScreenNavigation)

    const renderItem = (format, i) => {
        const today = moment()
        const isSelected =
            (dateFormat != null && dateFormat === format.format) ||
            (dateFormat == null && DATE_FORMAT_EUROPE === format.format)

        const onPress = e => {
            if (e != null) {
                e.preventDefault()
                e.stopPropagation()
            }

            setUserDateFormat(userId, format.format)
            setUserFirstDayInCalendar(
                userId,
                format.format === DATE_FORMAT_EUROPE ? MONDAY_FIRST_IN_CALENDAR : SUNDAY_FIRST_IN_CALENDAR
            )
            closePopover()
        }

        return (
            <View key={i}>
                <Hotkeys
                    key={i}
                    keyName={format.shortcut}
                    onKeyDown={(sht, event) => onPress(event)}
                    filter={e => true}
                >
                    <TouchableOpacity style={localStyles.dateSectionItem} onPress={onPress}>
                        <View style={localStyles.dateSectionItem}>
                            <View style={localStyles.sectionItemText}>
                                <Text style={[styles.subtitle1, { color: '#ffffff' }]}>{format.symbol}</Text>
                                <Text style={[styles.subtitle1, { color: colors.Text03 }]}>
                                    {' • '}
                                    {today.format(format.format)}
                                    {' • '}
                                    {format.format === DATE_FORMAT_EUROPE
                                        ? translate(mobile ? 'Monday' : 'Monday first')
                                        : translate(mobile ? 'Sunday' : 'Sunday first')}
                                </Text>
                            </View>
                            <View style={localStyles.sectionItemCheck}>
                                {isSelected && <Icon name={'check'} size={24} color={'#ffffff'} />}
                                {!mobile && (
                                    <Shortcut
                                        text={format.shortcut}
                                        theme={SHORTCUT_LIGHT}
                                        containerStyle={{ marginLeft: 4 }}
                                    />
                                )}
                            </View>
                        </View>
                    </TouchableOpacity>
                </Hotkeys>
            </View>
        )
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <Hotkeys keyName={'esc'} onKeyDown={closePopover} filter={e => true}>
                    <View style={{ marginBottom: 20 }}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Select date format')}</Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate('Date format will be applied to across the app')}
                        </Text>
                    </View>
                </Hotkeys>

                {formatOptions.map((item, i) => renderItem(item, i))}

                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeButton} onPress={closePopover}>
                        <Icon name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
            </CustomScrollView>
        </View>
    )
}

export const getDateFormat = (removeYear = false, twoDigitYear = false) => {
    const dateFormat = store.getState().dateFormat || DATE_FORMAT_EUROPE
    return removeYear ? dateFormat.substr(0, 5) : twoDigitYear ? dateFormat.substr(0, 8) : dateFormat
}

export const getTimeFormat = (showSeconds = false) => {
    const dateFormat = store.getState().dateFormat || DATE_FORMAT_EUROPE
    return dateFormat === DATE_FORMAT_EUROPE
        ? showSeconds
            ? TIME_FORMAT_EUROPE_S
            : TIME_FORMAT_EUROPE
        : showSeconds
        ? TIME_FORMAT_AMERICA_S
        : TIME_FORMAT_AMERICA
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
        paddingBottom: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: -4,
        right: -4,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    dateSectionItem: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'visible',
    },
    sectionItemText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    sectionItemCheck: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
})
