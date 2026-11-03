import React, { useState } from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import AssistantModeIcon from '../UIComponents/AssistantModeIcon'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { useAnnaAppPaneState } from './annaAppPaneBridge'

/**
 * The "expand to the left" button in the header of an embed window (IframeModal, McpAppModal):
 * switches to assistant mode with the assistant sidebar on the left and this app in the right pane
 * (AT-2951). Same icon and gating as the top bar's assistant-mode button; hidden where there is no
 * assistant shell to switch to.
 */
export default function OpenInAssistantPaneButton({
    onPress,
    color = colors.Text03,
    hoverColor = colors.Primary100,
    hoverBackground = '#E2EFFF',
    style,
}) {
    const paneState = useAnnaAppPaneState()
    const hasAssistant = useSelector(state => !!state.defaultAssistant?.uid)
    const isAnonymous = useSelector(state => !!state.loggedUser?.isAnonymous)
    const [hovered, setHovered] = useState(false)

    if (paneState === 'none' || isAnonymous || !hasAssistant) return null

    const label = translate('Open app in assistant mode')
    return (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={label}
            testID="embed-open-in-assistant-mode"
            style={[styles.button, hovered && { backgroundColor: hoverBackground }, style]}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onPress={onPress}
        >
            <AssistantModeIcon expanded={false} color={hovered ? hoverColor : color} title={label} />
        </TouchableOpacity>
    )
}

const styles = StyleSheet.create({
    button: {
        width: 32,
        height: 32,
        borderRadius: 6,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
    },
})
