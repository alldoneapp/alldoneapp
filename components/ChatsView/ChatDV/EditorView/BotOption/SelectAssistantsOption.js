import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles from '../../../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../../../UIControls/Shortcut'
import { translate } from '../../../../../i18n/TranslationService'

export default function SelectAssistantsOption({ setShowAssistants }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const onPress = () => {
        setShowAssistants(true)
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={onPress}>
            <Hotkeys keyName={'A'} onKeyDown={onPress} filter={e => true}>
                <Text style={localStyles.text}>{translate('Select assistant')}</Text>
                {!smallScreenNavigation && <Shortcut text={'A'} theme={SHORTCUT_LIGHT} />}
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
    text: {
        ...styles.subtitle1,
        color: '#FFFFFF',
    },
})
