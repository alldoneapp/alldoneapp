import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import { useSelector } from 'react-redux'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import Circle from './Circle'
import { translate } from '../../../../i18n/TranslationService'

export default function ColorItem({ data, selectedColor, onPress, closeModal }) {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <TouchableOpacity
            onPress={e => {
                if (closeModal) closeModal()
                onPress(e, data)
            }}
            accessible={false}
        >
            <Hotkeys
                keyName={data.shortcut}
                onKeyDown={(sht, event) => {
                    if (closeModal) closeModal()
                    onPress(event, data)
                }}
                filter={e => true}
            >
                <View style={localStyles.container}>
                    <View style={localStyles.left}>
                        <Circle color={data.color} selectedColor={selectedColor} />
                        <Text style={[localStyles.text, data.color === selectedColor && { color: colors.Primary100 }]}>
                            {translate(data.name)}
                        </Text>
                    </View>
                    <View>{!mobile && <Shortcut text={data.shortcut} theme={SHORTCUT_LIGHT} />}</View>
                </View>
            </Hotkeys>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        minHeight: 40,
    },
    left: {
        flexDirection: 'row',
    },
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginLeft: 8,
    },
})
