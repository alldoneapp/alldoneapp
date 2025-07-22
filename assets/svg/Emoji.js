import * as React from 'react'
import Svg, { Circle, Path } from 'react-native-svg'

function Emoji(props) {
    return (
        <Svg width={48} height={48} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <Circle cx={24} cy={24} r={24} fill="#FFAE47" />
            <Path d="M39 28.5a15 15 0 01-30 0h30z" fill="#091540" />
            <Path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M33.92 39.751a15 15 0 01-19.844-.002 15 15 0 0119.843.002z"
                fill="#BD0303"
            />
            <Circle cx={14.25} cy={18.75} r={5.25} fill="#091540" />
            <Circle cx={33.75} cy={18.75} r={5.25} fill="#091540" />
            <Circle cx={16.5} cy={16.5} r={1.5} fill="#fff" />
            <Circle cx={36} cy={16.5} r={1.5} fill="#fff" />
        </Svg>
    )
}

export default Emoji
