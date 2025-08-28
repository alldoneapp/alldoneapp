import * as React from 'react'
import Svg, { Rect, Path, Circle, Ellipse } from 'react-native-svg'

function PremiumSvg(props) {
    return (
        <Svg
            height={props.height}
            width={props.width}
            viewBox="0 0 34 34"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <Rect width={34} height={34} rx={4} fill="#FFE6C7" />
            <Path d="M6 9.946L7.235 26h18.53L27 9.946l-6.794 4.162L16.5 4l-3.706 10.108L6 9.946z" fill="#F69B28" />
            <Path d="M16.5 4v18h9.573L27 9.946l-6.794 4.162L16.5 4z" fill="#EB880A" />
            <Rect x={5} y={21} width={23} height={8} rx={2} fill="#FFAE47" />
            <Circle cx={6} cy={10} r={2} fill="#F58E0A" />
            <Circle cx={27} cy={10} r={2} fill="#F58E0A" />
            <Circle cx={16.5} cy={5.5} r={2.5} fill="#F58E0A" />
            <Ellipse cx={9.5} cy={25} rx={1.5} ry={2} fill="#8743FF" />
            <Ellipse cx={23.5} cy={25} rx={1.5} ry={2} fill="#8743FF" />
            <Ellipse cx={16.5} cy={25} rx={1.5} ry={3} fill="#00ACC1" />
        </Svg>
    )
}

export default PremiumSvg
