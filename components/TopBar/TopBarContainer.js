import React from 'react'
import { useSelector } from 'react-redux'
import { View } from 'react-native-web'

import TopBar from './TopBar'
import TopBarMobile from './TopBarMobile/TopBarMobile'

export default function TopBarContainer({ containerStyle }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    return <View style={containerStyle}>{smallScreenNavigation ? <TopBarMobile /> : <TopBar />}</View>
}
