import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import GhostButton from '../../UIControls/GhostButton'
import { execShortcutFn } from '../../../utils/HelperFunctions'

export default function Premium({ projectId, task, disabled }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const blockShortcuts = useSelector(state => state.blockShortcuts)

    const changePremiumContentStatus = () => {}

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="crown" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Premium')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <Hotkeys
                    keyName={`alt+'C'`}
                    disabled={disabled || blockShortcuts}
                    onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, showPopover, event)}
                    filter={e => true}
                >
                    <GhostButton
                        ref={ref => (this.buttonRef = ref)}
                        title={smallScreen ? null : task.isPremium ? translate('Premium') : translate('Free')}
                        type={'ghost'}
                        noBorder={smallScreen}
                        icon="crown"
                        onPress={changePremiumContentStatus}
                        disabled={disabled}
                        shortcutText={'C'}
                        accessible={false}
                    />
                </Hotkeys>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
