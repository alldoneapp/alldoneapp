import * as React from 'react'
import Svg, { Defs, LinearGradient, Stop, RadialGradient, G, Rect, Path } from 'react-native-svg'

function SVGGenericUser(props) {
    return (
        <Svg
            {...props}
            viewBox="0 0 343.958 343.958"
            height={props.height || 1300}
            width={props.width || 1300}
            style={{ overflow: 'visible' }}
        >
            <Defs>
                <LinearGradient id={`${props.svgid}prefix__c`}>
                    <Stop offset={0} stopColor="#0884ff" />
                    <Stop offset={0.271} stopColor="#5fafff" />
                    <Stop offset={1} stopColor="#d9ecff" />
                </LinearGradient>
                <LinearGradient id={`${props.svgid}prefix__b`}>
                    <Stop offset={0} stopColor="#c0e0ff" />
                    <Stop offset={0.705} stopColor="#82c0ff" />
                    <Stop offset={1} stopColor="#4da6ff" />
                </LinearGradient>
                <LinearGradient id={`${props.svgid}prefix__a`}>
                    <Stop offset={0} stopColor="#65b2ff" />
                    <Stop offset={1} stopColor="#d9ecff" />
                </LinearGradient>
                <RadialGradient
                    gradientUnits="userSpaceOnUse"
                    gradientTransform="scale(-2.6301) rotate(-45 -47.829 560.521)"
                    r={61.434}
                    fy={102.456}
                    fx={307.173}
                    cy={102.456}
                    cx={307.173}
                    id={`${props.svgid}prefix__e`}
                    xlinkHref={`#${props.svgid}prefix__b`}
                />
                <RadialGradient
                    gradientUnits="userSpaceOnUse"
                    gradientTransform="rotate(135 787.986 738.732) scale(1.39542 1.39543)"
                    r={547.021}
                    fy={589.924}
                    fx={647.026}
                    cy={589.924}
                    cx={647.026}
                    id={`${props.svgid}prefix__d`}
                    xlinkHref={`#${props.svgid}prefix__c`}
                />
            </Defs>
            <G transform="translate(-146.277 4.158)">
                <Rect ry={1} y={-4.158} x={146.277} height={343.958} width={343.958} fill="#e7ecef" />
                <Path
                    transform="matrix(.26458 0 0 .26458 146.277 -4.158)"
                    d="M647.025 674.781L505.076 696.5l5.557 124.754c2.673 60.035-34.896 96.585-85.863 123.238-73.407 38.388-141.01 42.63-217.688 72.768-54.044 21.242-107.076 81.064-107.076 154.387V1300h1094.04v-128.353c0-73.323-53.031-133.145-107.075-154.387-76.68-30.139-144.282-34.38-217.688-72.768-50.967-26.653-88.537-63.203-85.863-123.238l5.557-124.754z"
                    fill={`url(#${props.svgid}prefix__d)`}
                />
                <Path
                    d="M317.469 37.885c-17.27 0-32.538 2.566-46.52 15.896-8.9 8.485-13.283 20.62-13.838 33.368-.49 11.266 1.726 21.229 3.36 31.774h.007c-2.47.93-4.057 3.436-4.322 6.104-.548 5.529.868 12.494 2.08 17.385 1.644 6.63 5.33 15.219 11.21 18.435 3.504 15.13 8.366 24.986 16.51 35.427 7.844 10.057 20.703 17.471 31.513 17.471 10.81 0 23.668-7.414 31.513-17.471 8.144-10.44 13.005-20.297 16.51-35.427 5.879-3.216 9.566-11.804 11.21-18.435 1.212-4.891 2.627-11.856 2.08-17.385-.265-2.668-1.853-5.173-4.322-6.104h.006c1.634-10.545 3.85-20.508 3.36-31.774-.554-12.748-4.938-24.883-13.837-33.368-13.982-13.33-29.25-15.896-46.52-15.896z"
                    style={{
                        fontVariationSettings: 'normal',
                    }}
                    fill={`url(#${props.svgid}prefix__e)`}
                />
            </G>
        </Svg>
    )
}

export default SVGGenericUser
