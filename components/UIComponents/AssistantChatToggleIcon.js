import React from 'react'
import Svg, { Path, Rect } from 'react-native-svg'

export default function AssistantChatToggleIcon({ expanded, color }) {
    return (
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            {!expanded && <Rect x={3} y={3} width={6} height={18} fill={color} fillOpacity={0.25} />}
            <Rect x={3} y={3} width={18} height={18} rx={2} stroke={color} strokeWidth={2} />
            <Path
                d={expanded ? 'm8 8 4 4-4 4' : 'M9 3v18'}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    )
}
