import * as React from 'react'
import { StyleSheet } from 'react-native'
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

function SvgComponent(props) {
    const style = StyleSheet.create({
        container: {
            position: 'relative',
            top: (props.height ? props.height : 596) - 596,
        },
    })
    return (
        <Svg
            {...props}
            width={3416}
            height={596}
            viewBox="0 0 3416 596"
            fill="none"
            style={props.height && style.container}
        >
            <Path fill={`url(#prefix__paint0_radial${props.svgid})`} d="M0 0h3416v596H0z" />
            <Rect
                opacity={0.08}
                width={33.483}
                height={33.483}
                rx={6}
                transform="rotate(31.502 411.677 4719.045)"
                fill="#45AFFC"
            />
            <Rect
                opacity={0.08}
                width={33.483}
                height={33.483}
                rx={6}
                transform="rotate(31.502 765.886 4689.91)"
                fill="#45AFFC"
            />
            <Path
                opacity={0.08}
                d="M547.123 370.874c9.052-1.824 16.685 6.835 13.739 15.586l-9.943 29.537c-2.946 8.751-14.262 11.032-20.367 4.104l-20.608-23.379c-6.106-6.927-2.423-17.866 6.629-19.69l30.55-6.158zM2804.38 119.313c8.2 4.257 8.71 15.788.92 20.756l-26.27 16.766c-7.78 4.967-18.02-.354-18.43-9.579l-1.39-31.134c-.41-9.225 9.32-15.435 17.52-11.177l27.65 14.368zM2554.12 319.874c9.06-1.824 16.69 6.835 13.74 15.586l-9.94 29.537c-2.95 8.751-14.26 11.032-20.37 4.104l-20.61-23.379c-6.1-6.927-2.42-17.866 6.63-19.69l30.55-6.158zM2614.12 506.874c9.06-1.824 16.69 6.835 13.74 15.586l-9.94 29.537c-2.95 8.751-14.26 11.032-20.37 4.104l-20.61-23.379c-6.1-6.927-2.42-17.866 6.63-19.69l30.55-6.158zM553.123 112.874c9.052-1.824 16.685 6.835 13.739 15.586l-9.943 29.537c-2.946 8.751-14.262 11.032-20.367 4.104l-20.608-23.379c-6.106-6.927-2.423-17.866 6.629-19.69l30.55-6.158zM226.123 234.874c9.052-1.824 16.685 6.835 13.739 15.586l-9.943 29.537c-2.946 8.751-14.262 11.032-20.367 4.104l-20.608-23.379c-6.106-6.927-2.423-17.866 6.629-19.69l30.55-6.158z"
                fill="#ADF0D9"
            />
            <Circle opacity={0.08} cx={1854} cy={40} r={25} fill="#48CADA" />
            <Circle opacity={0.08} cx={3270} cy={102} r={31} fill="#48CADA" />
            <Circle opacity={0.08} cx={1545} cy={465} r={25} fill="#48CADA" />
            <Circle opacity={0.08} cx={255.5} cy={157.5} r={23.5} fill="#06EEC1" />
            <Circle opacity={0.08} cx={255.5} cy={539.5} r={18.5} fill="#06EEC1" />
            <Circle opacity={0.08} cx={2261.5} cy={101.283} r={33.5} fill="#1DE686" />
            <Circle opacity={0.08} cx={1042.5} cy={384.5} r={40.5} fill="#1DE686" />
            <Path
                opacity={0.08}
                d="M2406.39 162.852c8.5-1.713 15.67 6.421 12.91 14.642l-9.34 27.748c-2.77 8.221-13.4 10.363-19.14 3.856l-19.36-21.963c-5.73-6.508-2.27-16.784 6.23-18.498l28.7-5.785zM1594.36 444.447c12.04-2.426 22.19 9.091 18.27 20.732l-13.22 39.287c-3.92 11.64-18.97 14.674-27.09 5.46l-27.41-31.097c-8.13-9.214-3.23-23.765 8.81-26.192l40.64-8.19zM3129.36 217.447c12.04-2.426 22.19 9.091 18.27 20.732l-13.22 39.287c-3.92 11.64-18.97 14.674-27.09 5.46l-27.41-31.097c-8.13-9.214-3.23-23.765 8.81-26.192l40.64-8.19z"
                fill="#ADF0D9"
            />
            <Rect
                opacity={0.08}
                width={34.039}
                height={34.039}
                rx={4}
                transform="rotate(45 1195.665 3094.11)"
                fill="#FFB59E"
            />
            <Rect
                opacity={0.08}
                width={34.039}
                height={34.039}
                rx={4}
                transform="rotate(45 1541.99 3937.778)"
                fill="#FFB59E"
            />
            <Rect
                opacity={0.08}
                x={2023.12}
                y={496}
                width={60.251}
                height={60.251}
                rx={16}
                transform="rotate(30 2023.12 496)"
                fill="#FFB59E"
            />
            <Rect
                opacity={0.08}
                x={1807.12}
                y={177}
                width={41.926}
                height={41.926}
                rx={16}
                transform="rotate(30 1807.12 177)"
                fill="#FFB59E"
            />
            <Rect
                opacity={0.08}
                x={1229.58}
                y={81}
                width={83.165}
                height={83.165}
                rx={12}
                transform="rotate(30 1229.58 81)"
                fill="#FFB59E"
            />
            <Rect
                opacity={0.08}
                x={2924.51}
                y={323.718}
                width={42.377}
                height={42.377}
                rx={12}
                transform="rotate(30 2924.51 323.718)"
                fill="#FFB59E"
            />
            <Rect
                opacity={0.08}
                x={3302.95}
                y={381.509}
                width={63.028}
                height={63.028}
                rx={12}
                transform="rotate(30 3302.95 381.509)"
                fill="#FFB59E"
            />
            <Rect
                opacity={0.08}
                x={2253.58}
                y={275}
                width={83.165}
                height={83.165}
                rx={12}
                transform="rotate(30 2253.58 275)"
                fill="#FFB59E"
            />
            <Rect
                opacity={0.08}
                x={599.59}
                y={79.939}
                width={65.465}
                height={65.465}
                rx={12}
                transform="rotate(66.381 599.59 79.939)"
                fill="#FFB59E"
            />
            <Circle opacity={0.08} cx={40.5} cy={464.5} r={17.5} fill="#06EEC1" />
            <Circle opacity={0.08} cx={274.5} cy={532.5} r={13.5} fill="#06EEC1" />
            <Circle opacity={0.08} cx={1415.5} cy={363.5} r={40.5} fill="#1DE686" />
            <Circle opacity={0.08} cx={2931.5} cy={410.5} r={46.5} fill="#1DE686" />
            <Circle opacity={0.08} cx={2935.5} cy={121.5} r={25.5} fill="#1DE686" />
            <Circle opacity={0.08} cx={2646.5} cy={530.5} r={16.5} fill="#1DE686" />
            <Defs>
                <RadialGradient
                    id={`prefix__paint0_radial${props.svgid}`}
                    cx={0}
                    cy={0}
                    r={1}
                    gradientUnits="userSpaceOnUse"
                    gradientTransform="matrix(0 463.88 -3306.75 0 1843.45 94.132)"
                >
                    <Stop stopColor="#0D55CF" />
                    <Stop offset={0.711} stopColor="#308CF5" />
                    <Stop offset={1} stopColor="#2D95FF" />
                </RadialGradient>
            </Defs>
        </Svg>
    )
}

export default SvgComponent
