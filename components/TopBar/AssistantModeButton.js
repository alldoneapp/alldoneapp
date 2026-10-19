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
            style={[localStyles.button, hovered && localStyles.hovered, !inline && localStyles.centered]}
            hitSlop={{ top: 8, bottom: 8, left: 3, right: 3 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onPress={() => {
                onOpen?.()
                if (closeSidebar) closeSidebar()
                else showChat()
            }}
        >
            <span style={localStyles.glyph} title={label} aria-hidden="true">
                <View style={[localStyles.panel, expanded && localStyles.shiftedPanel]}>
                    <AssistantModePanelIcon
                        expanded={expanded}
                        color={highlighted ? colors.Primary100 : colors.Text03}
                    />
                </View>
                <View
                    style={[
                        localStyles.avatar,
                        expanded ? localStyles.avatarLeft : localStyles.avatarRight,
                        hovered && localStyles.hoveredAvatar,
                    ]}
                >
                    <AssistantAvatar
                        photoURL={assistant.photoURL50 || assistant.photoURL300 || assistant.photoURL}
                        assistantId={assistant.uid}
                        size={14}
                    />
                </View>
            </span>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        // Keep the panel at Search's 24px size, with room for the overlapping avatar.
        width: 38,
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
        width: 34,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    panel: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: 24,
        height: 24,
    },
    shiftedPanel: {
        left: 10,
    },
    avatar: {
        position: 'absolute',
        top: 4,
        width: 16,
        height: 16,
        borderWidth: 1,
        borderColor: '#FFFFFF',
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
    },
    avatarLeft: {
        left: 0,
    },
    avatarRight: {
        right: 0,
    },
    hoveredAvatar: {
        borderColor: '#E2EFFF',
    },
    centered: {
        position: 'absolute',
        left: '50%',
        marginLeft: -19,
        top: 14,
    },
})
