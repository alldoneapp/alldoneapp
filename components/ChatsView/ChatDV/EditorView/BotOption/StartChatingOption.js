import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles from '../../../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../../../UIControls/Shortcut'
import { translate } from '../../../../../i18n/TranslationService'
import { setAssistantEnabled } from '../../../../../redux/actions'

export default function StartChatingOption({ closeModal, assistant, inChatTab }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const onPress = () => {
        closeModal()
        dispatch(setAssistantEnabled(true))
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={onPress}>
            <Hotkeys keyName={'C'} onKeyDown={onPress} filter={e => true}>
                <Text style={localStyles.text}>
                    {translate(inChatTab ? 'Just chat with' : 'New chat with', { name: assistant.displayName })}
                </Text>
                {!smallScreenNavigation && <Shortcut text={'C'} theme={SHORTCUT_LIGHT} />}
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
