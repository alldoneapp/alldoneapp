import * as React from 'react'
import Svg, { Circle } from 'react-native-svg'

function SvgComponent(props) {
    return (
        <Svg width={20} height={20} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <Circle cx={10} cy={10} r={9.5} fill="#fff" stroke="#8A94A6" />
        </Svg>
    )
}

export default SvgComponent
