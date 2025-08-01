import * as React from 'react'
import Svg, { Path } from 'react-native-svg'

const GoogleGmail = props => (
    <Svg xmlns="http://www.w3.org/2000/svg" viewBox="52 42 88 66" {...props} width={20} height={20}>
        <Path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
        <Path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
        <Path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
        <Path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
        <Path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2C60.46 39.35 52 43.58 52 51" />
    </Svg>
)

export default GoogleGmail
