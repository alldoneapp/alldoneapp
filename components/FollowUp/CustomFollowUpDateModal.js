import React, { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors, hexColorToRGBa } from '../styles/global'
import Icon from '../Icon'
import { TouchableOpacity } from 'react-native-gesture-handler'
import moment from 'moment'
import CloseButton from './CloseButton'
import Shortcut, { SHORTCUT_LIGHT } from '../UIControls/Shortcut'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import { FOLLOW_UP_CUSTOM_DUE_DATE_MODAL_ID, removeModal, storeModal } from '../ModalsManager/modalsManager'
import AppCalendar from '../UIComponents/Calendar/AppCalendar'
import { translate } from '../../i18n/TranslationService'
import { applyPopoverWidth } from '../../utils/HelperFunctions'

const funnyWhite = hexColorToRGBa('#FFFFFF', 0.2)
export default function CustomFollowUpDateModal({ selectDate, backToDueDate, hidePopover }) {
    const mobile = useSelector(state => state.smallScreenNavigation)

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
                <AppCalendar
                    current={moment().format('YYYY-MM-DD')}
                    minDate={moment().format('YYYY-MM-DD')}
                    onDayPress={onPress}
                    markingType={'simple'}
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

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        // width: 305,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
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
