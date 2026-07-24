import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { TouchableOpacity } from 'react-native-gesture-handler'

import styles, { colors, hexColorToRGBa } from '../../styles/global'
import Icon from '../../Icon'
import TimePeriodItem from './TimePeriodItem'
import CustomDateRangeModal from './CustomDateRangeModal'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import MultilineParser from '../../Feeds/TextParser/MultilineParser'
import { generatorParserCustomElement, generatorParserTextElement } from '../../Feeds/Utils/HelperFunctions'
import CloseButton from '../../FollowUp/CloseButton'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'
import {
    STATISTIC_RANGE_ALL,
    STATISTIC_RANGE_CURRENT_MONTH,
    STATISTIC_RANGE_LAST_14_DAYS,
    STATISTIC_RANGE_LAST_7_DAYS,
    STATISTIC_RANGE_LAST_MONTH,
    STATISTIC_RANGE_TODAY,
} from '../statisticsHelper'

export default function SelectDateModal({
    updateFilterData,
    hidePopover,
    statisticsFilter,
    modalDescription,
    showWarningIconInModal,
}) {
    const [inCalendar, setInCalendar] = useState(false)

    const onCustomDatePress = () => {
        setInCalendar(inCalendar => !inCalendar)
    }

    const parseFeed = () => {
        const elementsData = []
        const icon = generatorParserCustomElement(
            <Icon style={{ marginTop: 2, marginRight: 4 }} name="info" size={18} color={colors.Text03} />
        )
        elementsData.push(icon)
        const text = generatorParserTextElement([localStyles.description, { overflow: 'hidden' }], modalDescription)
        elementsData.push(text)
        return elementsData
    }

    const elementsData = showWarningIconInModal ? parseFeed() : null

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
                    {showWarningIconInModal ? (
                        <MultilineParser
                            elementsData={elementsData}
                            externalContainerStyle={localStyles.descriptionContainer}
                        />
                    ) : (
                        <Text style={[localStyles.description, { marginLeft: 0 }]}>{translate(modalDescription)}</Text>
                    )}
                </View>
                <View style={{ marginTop: 20, paddingHorizontal: 16 }}>
                    <TimePeriodItem
                        updateFilterData={updateFilterData}
                        text={STATISTIC_RANGE_CURRENT_MONTH}
                        hidePopover={hidePopover}
                        selected={statisticsFilter === STATISTIC_RANGE_CURRENT_MONTH}
                        shortcutText={'1'}
                    />
                    <View style={localStyles.itemsContainer}>
                        <TimePeriodItem
                            updateFilterData={updateFilterData}
                            text={STATISTIC_RANGE_TODAY}
                            hidePopover={hidePopover}
                            selected={statisticsFilter === STATISTIC_RANGE_TODAY}
                            shortcutText={'2'}
                        />
                        <TimePeriodItem
                            updateFilterData={updateFilterData}
                            text={STATISTIC_RANGE_LAST_7_DAYS}
                            hidePopover={hidePopover}
                            selected={statisticsFilter === STATISTIC_RANGE_LAST_7_DAYS}
                            shortcutText={'3'}
                        />
                        <TimePeriodItem
                            updateFilterData={updateFilterData}
                            text={STATISTIC_RANGE_LAST_14_DAYS}
                            hidePopover={hidePopover}
                            selected={statisticsFilter === STATISTIC_RANGE_LAST_14_DAYS}
                            shortcutText={'4'}
                        />
                        <TimePeriodItem
                            updateFilterData={updateFilterData}
                            text={STATISTIC_RANGE_LAST_MONTH}
                            hidePopover={hidePopover}
                            selected={statisticsFilter === STATISTIC_RANGE_LAST_MONTH}
                            shortcutText={'5'}
                        />
                        <TimePeriodItem
                            updateFilterData={updateFilterData}
                            text={STATISTIC_RANGE_ALL}
                            hidePopover={hidePopover}
                            selected={statisticsFilter === STATISTIC_RANGE_ALL}
                            shortcutText={'6'}
                        />
                    </View>
                    <View style={{ paddingVertical: 8 }}>
                        <Hotkeys keyName={'7'} onKeyDown={onCustomDatePress} filter={e => true}>
                            <TouchableOpacity style={localStyles.custom} onPress={onCustomDatePress}>
                                <Text style={[styles.subtitle1, { color: 'white' }]}>
                                    {translate('Custom date range')}
                                </Text>
                                <View style={{ marginLeft: 'auto' }}>
                                    <Shortcut text={'7'} theme={SHORTCUT_LIGHT} />
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
    descriptionContainer: {
        paddingRight: 0,
        marginLeft: 0,
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginLeft: 4,
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
        marginTop: 8,
        borderTopColor: hexColorToRGBa('#FFFFFF', 0.2),
        borderTopWidth: 1,
        borderBottomColor: hexColorToRGBa('#FFFFFF', 0.2),
        borderBottomWidth: 1,
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    custom: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
    },
})
