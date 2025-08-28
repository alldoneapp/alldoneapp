import * as React from 'react'
import Svg, { Circle, Path } from 'react-native-svg'

function SvgComponent(props) {
    return (
        <Svg width={32} height={32} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <Circle cx={16} cy={16} r={16} fill="#FFAE47" />
            <Path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M24.485 24.636a1.5 1.5 0 01-2.12 0 9 9 0 00-12.729 0 1.5 1.5 0 01-2.121-2.121 12 12 0 0116.97 0 1.5 1.5 0 010 2.12z"
                fill="#091540"
            />
            <Circle cx={9.5} cy={12.5} r={3.5} fill="#091540" />
            <Circle cx={22.5} cy={12.5} r={3.5} fill="#091540" />
            <Circle cx={11} cy={11} r={1} fill="#fff" />
            <Circle cx={24} cy={11} r={1} fill="#fff" />
        </Svg>
    )
}

export default SvgComponent
