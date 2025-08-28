import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../../Icon'
import styles from '../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'
import { STATISTIC_RANGE_ALL } from '../statisticsHelper'

export default function TimePeriodItem({ updateFilterData, text, hidePopover, selected, shortcutText }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const optionText = text === STATISTIC_RANGE_ALL ? 'All statistics' : text

    const onPress = () => {
        hidePopover()
        updateFilterData(text, null)
    }

    return (
        <Hotkeys keyName={shortcutText} onKeyDown={onPress} filter={e => true}>
            <TouchableOpacity style={localStyles.container} onPress={onPress}>
                <Text style={[styles.subtitle1, { color: 'white' }]}>{translate(optionText)}</Text>
                <View style={localStyles.shortcut}>
                    {selected && <Icon name="check" size={24} color="white" />}
                    {!mobile && (
                        <Shortcut text={shortcutText} theme={SHORTCUT_LIGHT} containerStyle={{ marginLeft: 4 }} />
                    )}
                </View>
            </TouchableOpacity>
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
    },
    shortcut: {
        flexDirection: 'row',
        position: 'absolute',
        right: 0,
    },
})
