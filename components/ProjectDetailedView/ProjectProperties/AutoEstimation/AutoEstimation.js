import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import GhostButton from '../../../UIControls/GhostButton'
import { execShortcutFn } from '../../../../utils/HelperFunctions'
import { setProjectAutoEstimation } from '../../../../utils/backends/Projects/projectsFirestore'

export default function AutoEstimation({ projectId, disabled, autoEstimation }) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)

    const toogleAutoEstimation = () => {
        setProjectAutoEstimation(projectId, !autoEstimation)
    }

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="timer" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Auto Estimation')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <Hotkeys
                    keyName={`alt+A`}
                    disabled={disabled || blockShortcuts}
                    onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, toogleAutoEstimation, event)}
                    filter={e => true}
                >
                    <GhostButton
                        ref={ref => (this.buttonRef = ref)}
                        title={translate(autoEstimation ? 'Auto' : 'Manual')}
                        type={'ghost'}
                        icon="timer"
                        onPress={toogleAutoEstimation}
                        disabled={disabled}
                        shortcutText={'A'}
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
