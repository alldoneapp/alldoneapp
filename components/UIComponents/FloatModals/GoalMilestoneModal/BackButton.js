import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import Line from './Line'
import { translate } from '../../../../i18n/TranslationService'

export default function BackButton({ onPress }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    return (
        <View>
            <Line />
            <TouchableOpacity style={localStyles.container} onPress={onPress}>
                <Hotkeys keyName="B" onKeyDown={onPress} filter={e => true}>
                    <View style={localStyles.containerOption}>
                        <Icon name={'chevron-left'} size={24} color={colors.Text03} style={{ marginRight: 8 }} />
                        <Text style={localStyles.pickDateText}>{translate('Back')}</Text>
                    </View>
                    <View>{!smallScreenNavigation && <Shortcut text="B" theme={SHORTCUT_LIGHT} />}</View>
                </Hotkeys>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    containerOption: {
        flexDirection: 'row',
    },
    pickDateText: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
})
