import * as React from 'react'
import Svg, { Path, Rect } from 'react-native-svg'

function SVGShortcutIcon(props) {
    return (
        <Svg {...props} xmlns="http://www.w3.org/2000/svg" width={34} height={34} viewBox="0 0 34 34" fill="none">
            <Rect width={34} height={34} rx={4} fill="#D8F4F8" />
            <Rect x={4} y={14} width={26} height={15} rx={2} fill="#0097A7" />
            <Path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M23 5a1 1 0 011 1v2a3 3 0 01-3 3h-8a1 1 0 00-1 1v5h-2v-5a3 3 0 013-3h8a1 1 0 001-1V6a1 1 0 011-1z"
                fill="#0A44A5"
            />
            <Rect x={4} y={14} width={24} height={13} rx={1} fill="#48CADA" />
            <Path
                d="M9 16a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2zm4 2a1 1 0 00-1 1v.5h-2a1 1 0 100 2h3a1 1 0 001-1V19a1 1 0 00-1-1zm-15 1.5a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2zM13 23a1 1 0 100 2h6a1 1 0 100-2h-6z"
                fill="#0d55cf"
            />
        </Svg>
    )
}

export default SVGShortcutIcon
