import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles from '../../../styles/global'
import Icon from '../../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { translate } from '../../../../i18n/TranslationService'

export default function OptionItem({ option, selectedReasoningEffort, selectReasoningEffort }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const selectOption = () => selectReasoningEffort(option.reasoningEffort)

    return (
        <TouchableOpacity style={localStyles.container} onPress={selectOption}>
            <Hotkeys keyName={option.shortcutKey} onKeyDown={selectOption} filter={event => true}>
                <View style={localStyles.containerOption}>
                    <Text style={localStyles.text}>{translate(option.text)}</Text>
                </View>
                <View style={localStyles.selection}>
                    {selectedReasoningEffort === option.reasoningEffort && (
                        <Icon name={'check'} size={24} color="#fff" style={localStyles.check} />
                    )}
                    {!smallScreenNavigation && <Shortcut text={option.shortcutKey} theme={SHORTCUT_LIGHT} />}
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
    selection: {
        justifyContent: 'center',
        flexDirection: 'row',
    },
    check: {
        marginLeft: 'auto',
        marginRight: 4,
    },
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
})
