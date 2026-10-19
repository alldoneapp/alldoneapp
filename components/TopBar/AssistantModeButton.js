import React, { useContext, useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Svg, { Path, Rect } from 'react-native-svg'
import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'
import AnnaChatNavigationContext, { AnnaSidebarCloseContext } from '../Anna/AnnaChatNavigationContext'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

function AssistantModePanelIcon({ expanded, color }) {
    return (
        <Svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <Rect x={3} y={3} width={18} height={18} rx={2} />
            <Path d="M9 3v18" />
            <Path d={expanded ? 'm16 8-4 4 4 4' : 'm13 8 4 4-4 4'} />
        </Svg>
    )
}

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
            <span style={localStyles.glyph} title={label} aria-hidden="true">
                <View style={localStyles.panel}>
                    <AssistantModePanelIcon
                        expanded={expanded}
                        color={highlighted ? colors.Primary100 : colors.Text03}
                    />
                </View>
                <View style={[localStyles.avatar, hovered && localStyles.hoveredAvatar]}>
                    <AssistantAvatar
                        photoURL={assistant.photoURL50 || assistant.photoURL300 || assistant.photoURL}
                        assistantId={assistant.uid}
                        size={12}
                    />
                </View>
            </span>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        // Match Search's 28px control and 24px total icon footprint.
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
    },
    hovered: {
        backgroundColor: '#E2EFFF',
    },
    glyph: {
        display: 'flex',
        position: 'relative',
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    panel: {
        transform: [{ translateX: -3 }, { translateY: 3 }],
    },
    avatar: {
        position: 'absolute',
        top: 0,
        right: 0,
        width: 14,
        height: 14,
        borderWidth: 1,
        borderColor: '#FFFFFF',
        borderRadius: 7,
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
    },
    hoveredAvatar: {
        borderColor: '#E2EFFF',
    },
    centered: {
        position: 'absolute',
        left: '50%',
        marginLeft: -14,
        top: 14,
    },
})
