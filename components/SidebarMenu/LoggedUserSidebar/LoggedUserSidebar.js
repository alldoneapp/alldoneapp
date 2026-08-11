import React, { useRef } from 'react'
import { Animated } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import LoggedUserSidebarHeader from './LoggedUserSidebarHeader'
import LoggedUserSidebarBody from './LoggedUserSidebarBody'
import { setHoverSidebar } from '../../../redux/actions'

export default function LoggedUserSidebar({ navigation, expanded, containerStyle }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const sidebarHovered = useSelector(state => state.sidebarHovered)
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const scrollView = useRef()

    const handleMouseEnter = e => {
        dispatch(setHoverSidebar(true))
    }

    const handleMouseLeave = e => {
        dispatch(setHoverSidebar(false))
    }

    return (
        <Animated.View
            style={containerStyle}
            onMouseEnter={!sidebarExpanded && !smallScreenNavigation && !sidebarHovered ? handleMouseEnter : undefined}
            onMouseLeave={!sidebarExpanded && !smallScreenNavigation && sidebarHovered ? handleMouseLeave : undefined}
        >
            <LoggedUserSidebarHeader expanded={expanded} navigation={navigation} scrollView={scrollView} />
            <LoggedUserSidebarBody expanded={expanded} navigation={navigation} scrollView={scrollView} />
        </Animated.View>
    )
}
