import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../../../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../../../UIControls/Shortcut'
import { translate } from '../../../../../i18n/TranslationService'
import { getThreadAssistantModelName } from '../../../../../functions/Assistant/threadAssistantModel'

/**
 * The "Select model" row of the assistant popup (AT-2502).
 *
 * It always names the model the next answer in this thread will use, because the whole point of
 * the feature is that this thread can differ from the assistant's own setting — a row that only
 * said "Select model" would leave the user opening the picker just to find out where they are.
 * The subtitle distinguishes the two states in words rather than only by which name is shown:
 * a pinned thread reads "Only for this thread", an unpinned one names the assistant's default.
 */
export default function SelectModelOption({ threadModel, assistantModel, onPress }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const pinnedName = getThreadAssistantModelName(threadModel)
    const assistantName = getThreadAssistantModelName(assistantModel)
    // An assistant configured with a model outside the selectable menu (a retired key) has no
    // friendly name. Saying "Assistant default" is still true and is better than an empty line.
    const displayName = pinnedName || assistantName || translate('Assistant default')
    const subtitle = pinnedName ? translate('Only for this thread') : translate('Assistant default')

    return (
        <TouchableOpacity style={localStyles.container} onPress={onPress}>
            <Hotkeys keyName={'M'} onKeyDown={onPress} filter={e => true}>
                <View style={localStyles.labelArea}>
                    <Text style={localStyles.text}>{translate('Select model')}</Text>
                    <Text style={[localStyles.subtitle, pinnedName && localStyles.subtitlePinned]}>
                        {`${displayName} · ${subtitle}`}
                    </Text>
                </View>
                {!smallScreenNavigation && <Shortcut text={'M'} theme={SHORTCUT_LIGHT} />}
            </Hotkeys>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        minHeight: 48,
        paddingVertical: 6,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    labelArea: {
        flexDirection: 'column',
        flexShrink: 1,
    },
    text: {
        ...styles.subtitle1,
        color: '#FFFFFF',
    },
    subtitle: {
        ...styles.caption1,
        color: colors.Text03,
        marginTop: 2,
    },
    subtitlePinned: {
        color: colors.Primary100,
    },
})
