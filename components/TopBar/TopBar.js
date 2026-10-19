import React, { useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import TopBarStatisticArea from './TopBarStatisticArea'
import NotificationArea from './NotificationArea'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { setTopBarWidth } from '../../redux/actions'
import HomeButton from './HomeButton'
import AssistantModeButton from './AssistantModeButton'
import ConnectionStatusChip from './ConnectionStatusChip'
import { showConnectionChipBelowHeader } from './connectionChipPlacement'
import { getDesktopTopBarMargins } from './topBarLayout'

export default function TopBar() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const chipBelowHeader = useSelector(showConnectionChipBelowHeader)
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
                !smallScreenNavigation && getDesktopTopBarMargins({ isMiddleScreen, sidebarExpanded }),
            ]}
            onLayout={onLayout}
            testID="top-bar-desktop"
        >
            <View style={localStyles.leftArea}>
                <AssistantModeButton inline style={localStyles.leadingButton} />
                {!userIsAnonymous && <TopBarStatisticArea />}
            </View>
            <View style={localStyles.rightArea}>
                {/* Renders nothing while the connection is live (PT-4660), so this
                    row collapses to exactly the previous layout in the normal case.
                    On tablet-and-narrower it renders nothing at all: this row has no
                    slack for a labelled chip (measured 141-183px depending on language),
                    so `MainViewsContainer` stacks it below the header instead
                    (AT-2426). */}
                {!chipBelowHeader && <ConnectionStatusChip />}
                <NotificationArea />
            </View>
            <HomeButton color={theme.homeIcon} style={localStyles.homeButton} />
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
    leftArea: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        maxWidth: '50%',
        minWidth: 0,
        paddingRight: 32,
    },
    rightArea: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    leadingButton: {
        marginRight: 8,
    },
    homeButton: {
        position: 'absolute',
        left: '50%',
        marginLeft: -14,
        top: 10,
    },
})
