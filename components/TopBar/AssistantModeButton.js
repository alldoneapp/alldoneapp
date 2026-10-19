import React, { useContext, useState } from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'
import AnnaChatNavigationContext, { AnnaSidebarCloseContext } from '../Anna/AnnaChatNavigationContext'
import AssistantModeIcon from '../UIComponents/AssistantModeIcon'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

export default function AssistantModeButton({ onOpen, inline = false }) {
    const assistant = useSelector(state => state.defaultAssistant)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const showChat = useContext(AnnaChatNavigationContext)
    const closeSidebar = useContext(AnnaSidebarCloseContext)
    const [hovered, setHovered] = useState(false)

    if (isAnonymous || !assistant?.uid) return null

    const expanded = !!closeSidebar
    const highlighted = expanded || hovered
    const name = assistant.displayName?.trim() || translate('Assistant')
    const label = `${name}: ${translate(expanded ? 'Close assistant chat' : 'Open assistant chat')}`
    return (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={label}
            aria-pressed={expanded}
            testID="top-bar-assistant-mode"
            style={[localStyles.button, hovered && localStyles.hovered, !inline && localStyles.centered]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onPress={() => {
                onOpen?.()
                if (closeSidebar) closeSidebar()
                else showChat()
            }}
        >
            <AssistantModeIcon
                expanded={expanded}
                color={highlighted ? colors.Primary100 : colors.Text03}
                title={label}
            />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        // Match Search's 28px control and 24px icon footprint.
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
    },
    hovered: {
        backgroundColor: '#E2EFFF',
    },
    centered: {
        position: 'absolute',
        left: '50%',
        marginLeft: -14,
        top: 14,
    },
})
