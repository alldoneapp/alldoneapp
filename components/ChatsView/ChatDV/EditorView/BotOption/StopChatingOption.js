import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles from '../../../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../../../UIControls/Shortcut'
import { translate } from '../../../../../i18n/TranslationService'
import { setAssistantEnabled } from '../../../../../redux/actions'

export default function StopChatingOption({ closeModal }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const onPress = () => {
        closeModal()
        dispatch(setAssistantEnabled(false))
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={onPress}>
            <Hotkeys keyName={'S'} onKeyDown={onPress} filter={e => true}>
                <Text style={localStyles.text}>{translate('Do not answer me')}</Text>
                {!smallScreenNavigation && <Shortcut text={'S'} theme={SHORTCUT_LIGHT} />}
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
