import React, { useState } from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { adaptiveColor } from '../../../Themes/colorMode'

export const EDIT_ASSISTANT_BUTTON_TEST_ID = 'assistant-line-edit-assistant'

/**
 * AT-3069 — the edit pencil at the top left of the assistant line. It replaced the assistant-mode
 * (panel) button there and shows on every line: it opens the line's assistant's settings. Same
 * 28px footprint and hover as the button it replaced.
 *
 * The press stops propagating: the line's header sits inside touchables of its own.
 */
export default function EditAssistantButton({ onPress, style, testID = EDIT_ASSISTANT_BUTTON_TEST_ID }) {
    const [hovered, setHovered] = useState(false)

    const editAssistant = event => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        onPress?.()
    }

    return (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={translate('Edit assistant')}
            testID={testID}
            style={[localStyles.button, hovered && localStyles.hovered, style]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onPress={editAssistant}
        >
            <Icon name="edit-2" size={16} color={hovered ? colors.Primary100 : colors.Text03} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        width: 28,
        height: 28,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
    },
    hovered: {
        backgroundColor: adaptiveColor('#E2EFFF'),
    },
})
