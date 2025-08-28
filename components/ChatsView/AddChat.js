import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import Shortcut from '../UIControls/Shortcut'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'

export default function AddChat({ onPress }) {
    const showShortcuts = useSelector(state => state.showShortcuts)
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <TouchableOpacity style={localStyles.container} onPress={onPress}>
            <Icon name="plus-square" size={24} color={colors.Primary100} style={localStyles.icon} />
            <View style={{ marginLeft: 16 }}>
                <Text style={localStyles.text}>
                    {translate(
                        mobile ? 'Type to add a new chat' : 'Type a topic to start a new chat with your teammates'
                    )}
                </Text>
            </View>

            {showShortcuts && (
                <View style={{ position: 'absolute', top: 0, right: 0 }}>
                    <Shortcut text={'+'} />
                </View>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
    },
    text: {
        ...styles.body1,
        color: colors.Text03,
    },
    icon: {
        width: 48,
        alignItems: 'center',
    },
})
