import * as React from 'react'
import Svg, { Circle, Path } from 'react-native-svg'

function SvgComponent(props) {
    return (
        <Svg width={20} height={20} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <Circle cx={10} cy={10} r={10} fill="#007FFF" />
            <Path
                opacity={0.99}
                d="M15.32 5.327a.664.664 0 00-.458.202L8 12.39 5.138 9.529a.667.667 0 10-.943.943l3.334 3.333a.665.665 0 00.942 0l7.334-7.334a.667.667 0 00-.465-1.145h-.02z"
                fill="#fff"
            />
        </Svg>
    )
}

export default SvgComponent
