import React from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'

export default function AssistantModeIcon({ assistant, expanded, color, hovered = false, title }) {
    return (
        <span style={localStyles.glyph} title={title} aria-hidden="true">
            <View style={[localStyles.panel, !expanded && localStyles.shiftedPanel]}>
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
                    <Path d={expanded ? 'm13 8 4 4-4 4' : 'm16 8-4 4 4 4'} />
                </Svg>
            </View>
            <View
                style={[
                    localStyles.avatar,
                    expanded ? localStyles.avatarRight : localStyles.avatarLeft,
                    hovered && localStyles.hoveredAvatar,
                ]}
            >
                <AssistantAvatar
                    photoURL={assistant.photoURL50 || assistant.photoURL300 || assistant.photoURL}
                    assistantId={assistant.uid}
                    size={22}
                />
            </View>
        </span>
    )
}

const localStyles = StyleSheet.create({
    glyph: {
        display: 'flex',
        position: 'relative',
        width: 42,
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
        left: 18,
    },
    avatar: {
        position: 'absolute',
        top: 0,
        width: 24,
        height: 24,
        borderWidth: 1,
        borderColor: '#FFFFFF',
        borderRadius: 12,
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
})
