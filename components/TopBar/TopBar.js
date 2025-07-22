import React, { useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import TopBarStatisticArea from './TopBarStatisticArea'
import NotificationArea from './NotificationArea'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { setTopBarWidth } from '../../redux/actions'

export default function TopBar() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const userIsAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const containerRef = useRef(null)

    const theme = getTheme(Themes, themeName, 'TopBar')

    const onLayout = ({
        nativeEvent: {
            layout: { width },
        },
    }) => {
        dispatch(setTopBarWidth(width))
    }

    return (
        <View
            ref={containerRef}
            style={[
                localStyles.container,
                theme.container,
                !smallScreenNavigation && {
                    marginHorizontal: isMiddleScreen ? 56 : 104,
                },
                !smallScreenNavigation && !sidebarExpanded && { marginLeft: isMiddleScreen ? 112 : 160 },
            ]}
            onLayout={onLayout}
        >
            {userIsAnonymous ? <View style={{ flex: 1 }} /> : <TopBarStatisticArea />}
            <NotificationArea />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        paddingRight: 24,
        paddingLeft: 10,
        height: 48,
    },
})
