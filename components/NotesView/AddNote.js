import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import Shortcut from '../UIControls/Shortcut'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'

export default function AddNote({ onPress }) {
    const showShortcuts = useSelector(state => state.showShortcuts)

    return (
        <TouchableOpacity style={localStyles.container} onPress={onPress}>
            <Icon name="plus-square" size={24} color={colors.Primary100} />
            <View style={{ marginLeft: 12 }}>
                <Text style={localStyles.text}>{translate('Type note title to add new note')}</Text>
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
})
