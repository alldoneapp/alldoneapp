import React from 'react'
import { StyleSheet } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'

export default function AssistantModeIcon({ expanded, color, title }) {
    return (
        <span style={localStyles.glyph} title={title} aria-hidden="true">
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
        </span>
    )
}

const localStyles = StyleSheet.create({
    glyph: {
        display: 'flex',
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
