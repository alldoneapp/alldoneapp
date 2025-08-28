import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { CAPACITY_AUTOMATIC } from '../../../GoalsView/GoalsHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function AutomaticOption({ automaticCapacity, showBackground, updateCapacity, isSelected }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const capacityValue = `${automaticCapacity} ${translate(
        automaticCapacity.toString() === '1' || automaticCapacity.toString() === '-1' ? 'Day' : 'Days'
    )}`

    const selectCapacity = () => {
        updateCapacity(CAPACITY_AUTOMATIC)
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={selectCapacity}>
            {isSelected && showBackground && <View style={localStyles.selectedItemBackground} />}
            <Hotkeys keyName={'alt+1'} onKeyDown={selectCapacity} filter={e => true}>
                <View style={localStyles.containerOption}>
                    <Text style={[localStyles.text, isSelected && localStyles.textSelected]}>
                        {translate('Automatic')}
                    </Text>
                </View>
                <View style={{ flexDirection: 'row' }}>
                    {
                        <View
                            style={[
                                localStyles.capacityValueContainer,
                                isSelected && localStyles.capacityValueContainerSelected,
                            ]}
                        >
                            <Text style={[localStyles.capacityValue, isSelected && localStyles.capacityValueSelected]}>
                                {capacityValue}
                            </Text>
                        </View>
                    }
                    {!smallScreenNavigation && (
                        <Shortcut
                            text="Alt + 1"
                            theme={SHORTCUT_LIGHT}
                            containerStyle={{ backgroundColor: 'transparent' }}
                        />
                    )}
                </View>
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
    textSelected: {
        color: colors.Primary100,
    },
    capacityValueContainer: {
        borderRadius: 12,
        height: 24,
        backgroundColor: colors.Grey300,
        paddingHorizontal: 8,
        paddingVertical: 1,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
    },
    capacityValueContainerSelected: {
        backgroundColor: colors.Primary200,
    },
    capacityValue: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    capacityValueSelected: {
        color: '#ffffff',
    },
    selectedItemBackground: {
        position: 'absolute',
        left: -8,
        top: 0,
        right: -8,
        bottom: 0,
        backgroundColor: colors.Text03,
        opacity: 0.16,
        borderRadius: 4,
    },
})
