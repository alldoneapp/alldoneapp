import React, { useState } from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'

import Icon from '../../../Icon'
import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

/**
 * The "open in new tab" button left of the X in the embed window's header (AT-2954). Same size and
 * hover treatment as the header's assistant-mode button; the tooltip comes from a native `title`,
 * which react-native-web's TouchableOpacity does not render.
 */
export default function OpenEmbeddedAppInNewTabButton({
    onPress,
    color = colors.Text03,
    hoverColor = colors.Primary100,
    hoverBackground = '#E2EFFF',
    style,
}) {
    const [hovered, setHovered] = useState(false)
    const label = translate('Open app in new tab')
    return (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={label}
            testID="embed-open-in-new-tab"
            style={[styles.button, hovered && { backgroundColor: hoverBackground }, style]}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onPress={onPress}
        >
            <span style={styles.glyph} title={label} aria-hidden="true">
                <Icon name="new-window" size={18} color={hovered ? hoverColor : color} />
            </span>
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
    glyph: {
        display: 'flex',
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
