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
            width={24}
            height={24}
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
            style={[localStyles.button, highlighted && localStyles.highlighted, !inline && localStyles.centered]}
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
                <View style={[localStyles.avatar, expanded && localStyles.activeAvatar]}>
                    <AssistantAvatar
                        photoURL={assistant.photoURL50 || assistant.photoURL300 || assistant.photoURL}
                        assistantId={assistant.uid}
                        size={20}
                    />
                </View>
            </span>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        backgroundColor: '#FFFFFF',
    },
    highlighted: {
        backgroundColor: '#E2EFFF',
    },
    glyph: {
        display: 'flex',
        position: 'relative',
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    panel: {
        transform: [{ translateX: -2 }, { translateY: 2 }],
    },
    avatar: {
        position: 'absolute',
        top: 0,
        right: 2,
        width: 24,
        height: 24,
        borderWidth: 2,
        borderColor: '#FFFFFF',
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
    },
    activeAvatar: {
        borderColor: '#E2EFFF',
    },
    centered: {
        position: 'absolute',
        left: '50%',
        marginLeft: -22,
        top: 6,
    },
})
