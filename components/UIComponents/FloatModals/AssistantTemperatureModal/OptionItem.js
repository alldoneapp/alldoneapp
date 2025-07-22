import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles from '../../../styles/global'
import Icon from '../../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { translate } from '../../../../i18n/TranslationService'

export default function OptionItem({ temperatureData, selectedTemperature, selectTemperature, disabledShorcut }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    let { text, temperature, shortcutKey } = temperatureData

    const selectOption = () => {
        selectTemperature(temperature)
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={selectOption}>
            <Hotkeys keyName={shortcutKey} onKeyDown={selectOption} filter={e => true} disabled={disabledShorcut}>
                <View style={localStyles.containerOption}>
                    <Text style={localStyles.text}>{translate(text)}</Text>
                </View>
                <View style={{ justifyContent: 'center', flexDirection: 'row' }}>
                    {selectedTemperature === temperature && (
                        <Icon name={'check'} size={24} color="#fff" style={{ marginLeft: 'auto', marginRight: 4 }} />
                    )}
                    {!smallScreenNavigation && <Shortcut text={shortcutKey} theme={SHORTCUT_LIGHT} />}
                </View>
            </Hotkeys>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 40,
        paddingVertical: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    containerOption: {
        flexDirection: 'row',
    },

    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
})
