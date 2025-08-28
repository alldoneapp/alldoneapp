import React from 'react'
import { Animated } from 'react-native'

import AnonymousUserSidebarBody from './AnonymousUserSidebarBody'
import AnonymousUserSidebarHeader from './AnonymousUserSidebarHeader'

export default function AnonymousUserSidebar({ containerStyle }) {
    return (
        <Animated.View style={containerStyle}>
            <AnonymousUserSidebarHeader />
            <AnonymousUserSidebarBody />
        </Animated.View>
    )
}
