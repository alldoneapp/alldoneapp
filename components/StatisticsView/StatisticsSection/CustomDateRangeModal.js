import React, { useState, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import moment from 'moment'
import Hotkeys from 'react-hot-keys'

import styles, { colors, hexColorToRGBa } from '../../styles/global'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import { translate } from '../../../i18n/TranslationService'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import AppCalendar from '../../UIComponents/Calendar/AppCalendar'
import { computeDateRangeSelection } from './dateRangeSelection'
import { STATISTIC_RANGE_CUSTOM } from '../statisticsHelper'

export default function CustomDateRangeModal({ hidePopover, onGoBackPress, updateFilterData }) {
    const [markedDates, setMarkedDates] = useState({})
    const hasFirstDayRef = useRef(false)

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
                    <AppCalendar
                        current={moment().format('YYYY-MM-DD')}
                        maxDate={moment().format('YYYY-MM-DD')}
                        onDayPress={e => {
                            setMarkedDates(stateMarkedDates => {
                                const next = computeDateRangeSelection(
                                    stateMarkedDates,
                                    hasFirstDayRef.current,
                                    e.dateString
                                )
                                hasFirstDayRef.current = next.hasFirstDay
                                return next.markedDates
                            })
                        }}
                        markingType={'period'}
                        markedDates={markedDates}
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

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        width: 305,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
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
