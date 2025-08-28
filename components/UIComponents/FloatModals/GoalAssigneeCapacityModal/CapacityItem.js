import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { capacityDataMap } from '../../../GoalsView/GoalsHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function CapacityItem({ capacityKey, updateCapacity, closeModal, isSelected }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { shortcutKey, optionText, description } = capacityDataMap[capacityKey]

    const selectCapacity = () => {
        closeModal()
        updateCapacity(capacityKey)
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={selectCapacity}>
            <Hotkeys keyName={shortcutKey} onKeyDown={selectCapacity} filter={e => true}>
                <View style={localStyles.containerOption}>
                    <Text style={localStyles.text}>{optionText}</Text>
                    <Text style={[localStyles.description, { marginHorizontal: 4 }]}>•</Text>
                    <Text style={localStyles.description}>{translate(description)}</Text>
                </View>
                {!smallScreenNavigation && <Shortcut text={shortcutKey} theme={SHORTCUT_LIGHT} />}
            </Hotkeys>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 48,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    containerOption: {
        flexDirection: 'row',
    },
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    description: {
        ...styles.subtitle1,
        color: colors.Text03,
    },
})
