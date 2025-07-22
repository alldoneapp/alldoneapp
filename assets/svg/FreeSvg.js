import * as React from 'react'
import Svg, { Rect, Path, Circle } from 'react-native-svg'

function FreeSvg(props) {
    return (
        <Svg height={props.height} width={props.width} viewBox="0 0 34 34" fill="none" {...props}>
            <Rect width={34} height={34} rx={4} fill="#C7E3FF" />
            <Circle cx={17} cy={8} r={4} fill="#0D55CF" />
            <Path d="M6 20c0-6.075 4.925-11 11-11s11 4.925 11 11v8H6v-8z" fill="#007FFF" />
            <Path
                d="M18.372 9.088a10.74 10.74 0 00-2.744 0c-2.803 1.567-4.674 3.286-5.86 5.273C8.429 16.603 8 19.12 8 22h1.125c0-2.772.414-5.06 1.607-7.057.957-1.602 2.44-3.06 4.7-4.434-1.807 3.573-1.807 7.368-1.807 11.418V22h1.125c0-4.54.013-8.393 2.25-11.985 2.237 3.592 2.25 7.446 2.25 11.985h1.125v-.073c0-4.05 0-7.845-1.806-11.418 2.26 1.374 3.742 2.832 4.699 4.434 1.193 1.998 1.607 4.285 1.607 7.057H26c0-2.88-.43-5.397-1.768-7.639-1.186-1.987-3.057-3.706-5.86-5.273z"
                fill="#0A44A5"
            />
            <Rect x={4} y={20} width={26} height={8} rx={2} fill="#0D55CF" />
            <Rect x={7} y={21} width={2} height={6} rx={1} fill="#007FFF" />
            <Rect x={13} y={21} width={2} height={6} rx={1} fill="#007FFF" />
            <Rect x={19} y={21} width={2} height={6} rx={1} fill="#007FFF" />
            <Rect x={25} y={21} width={2} height={6} rx={1} fill="#007FFF" />
        </Svg>
    )
}

export default FreeSvg
