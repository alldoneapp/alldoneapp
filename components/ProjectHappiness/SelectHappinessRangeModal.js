import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { TouchableOpacity } from 'react-native-gesture-handler'

import styles, { colors, hexColorToRGBa } from '../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../UIControls/Shortcut'
import CloseButton from '../FollowUp/CloseButton'
import TimePeriodItem from '../StatisticsView/StatisticsSection/TimePeriodItem'
import CustomDateRangeModal from '../StatisticsView/StatisticsSection/CustomDateRangeModal'
import { applyPopoverWidth } from '../../utils/HelperFunctions'
import { translate } from '../../i18n/TranslationService'
import {
    HAPPINESS_RANGE_CURRENT_YEAR,
    HAPPINESS_RANGE_LAST_12_MONTHS,
    HAPPINESS_RANGE_LAST_30_DAYS,
    HAPPINESS_RANGE_LAST_3_MONTHS,
    HAPPINESS_RANGE_LAST_YEAR,
} from '../../utils/ProjectHappinessHelper'

const RANGE_OPTIONS = [
    HAPPINESS_RANGE_LAST_30_DAYS,
    HAPPINESS_RANGE_LAST_3_MONTHS,
    HAPPINESS_RANGE_LAST_12_MONTHS,
    HAPPINESS_RANGE_LAST_YEAR,
    HAPPINESS_RANGE_CURRENT_YEAR,
]

export default function SelectHappinessRangeModal({ updateFilterData, hidePopover, happinessFilter }) {
    const [inCalendar, setInCalendar] = useState(false)

    const onCustomDatePress = () => {
        setInCalendar(inCalendar => !inCalendar)
    }

    const customShortcut = `${RANGE_OPTIONS.length + 1}`

    return inCalendar ? (
        <CustomDateRangeModal
            hidePopover={hidePopover}
            onGoBackPress={onCustomDatePress}
            updateFilterData={updateFilterData}
        />
    ) : (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={localStyles.innerContainer}>
                <View style={localStyles.heading}>
                    <Text style={[styles.title7, { color: 'white' }]}>{translate('Select time period')}</Text>
                </View>
                <View style={{ marginTop: 20, paddingHorizontal: 16 }}>
                    <View style={localStyles.itemsContainer}>
                        {RANGE_OPTIONS.map((option, i) => (
                            <TimePeriodItem
                                key={option}
                                updateFilterData={updateFilterData}
                                text={option}
                                hidePopover={hidePopover}
                                selected={happinessFilter === option}
                                shortcutText={`${i + 1}`}
                            />
                        ))}
                    </View>
                    <View style={{ paddingVertical: 8 }}>
                        <Hotkeys keyName={customShortcut} onKeyDown={onCustomDatePress} filter={e => true}>
                            <TouchableOpacity style={localStyles.custom} onPress={onCustomDatePress}>
                                <Text style={[styles.subtitle1, { color: 'white' }]}>
                                    {translate('Custom date range')}
                                </Text>
                                <View style={{ marginLeft: 'auto' }}>
                                    <Shortcut text={customShortcut} theme={SHORTCUT_LIGHT} />
                                </View>
                            </TouchableOpacity>
                        </Hotkeys>
                    </View>
                </View>
            </View>
            <CloseButton close={hidePopover} />
        </View>
    )
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
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    heading: {
        flexDirection: 'column',
        paddingLeft: 16,
        paddingTop: 16,
        paddingRight: 16,
    },
    itemsContainer: {
        borderBottomColor: hexColorToRGBa('#FFFFFF', 0.2),
        borderBottomWidth: 1,
        paddingBottom: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    custom: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
    },
})
