import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { translate } from '../../../../i18n/TranslationService'
import AssistantModelGoldRate from '../../AssistantModelGoldRate'

/**
 * `text` is a TRANSLATION KEY, never a finished string — it is passed straight to `translate()`.
 *
 * An option whose label needs a runtime value (the thread picker names the assistant's own model)
 * must therefore supply that value as `textParams` and let the key interpolate it, rather than
 * building the sentence itself: a pre-translated string reaches `translate()` as an unknown key
 * and renders as `[missing "en.…" translation]` (AT-2512).
 *
 * `subtitleKey` (also a translation key) adds a secondary line under the label. The thread picker
 * uses it to name the model its "Use assistant model" entry stands for (AT-3162), in the place where
 * the model entries show their Gold rate.
 */
export default function OptionItem({ modelData, selectedModel, selectModel, disabledShorcut }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    let { text, textParams, subtitleKey, model, shortcutKey, tokensPerGold } = modelData

    const selectOption = () => {
        selectModel(model)
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={selectOption}>
            <Hotkeys keyName={shortcutKey} onKeyDown={selectOption} filter={e => true} disabled={disabledShorcut}>
                <View style={localStyles.containerOption}>
                    <Text style={localStyles.text}>{translate(text, textParams)}</Text>
                    {!!subtitleKey && <Text style={localStyles.subtitle}>{translate(subtitleKey)}</Text>}
                    <AssistantModelGoldRate tokensPerGold={tokensPerGold} />
                </View>
                <View style={{ justifyContent: 'center', flexDirection: 'row' }}>
                    {selectedModel === model && (
                        <Icon name={'check'} size={24} color="#fff" style={{ marginLeft: 'auto', marginRight: 4 }} />
                    )}
                    {!smallScreenNavigation && <Shortcut text={shortcutKey} theme={SHORTCUT_LIGHT} />}
                </View>
            </Hotkeys>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        minHeight: 52,
        paddingVertical: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    containerOption: {
        flexDirection: 'column',
    },

    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    // Same secondary line as the assistant popup's "Select model" row (SelectModelOption).
    subtitle: {
        ...styles.caption1,
        color: colors.Text03,
        marginTop: 2,
    },
})
