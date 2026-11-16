import React, { useContext, useLayoutEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { Dimensions, StyleSheet, View } from 'react-native-web'

import TopBar from './TopBar'
import TopBarMobile from './TopBarMobile/TopBarMobile'
import { getTopBarLayout } from './topBarLayout'
import AnnaTopStripContext, { AnnaStripSlotContext } from '../Anna/AnnaTopStripContext'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'

export default function TopBarContainer({ containerStyle }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const [width, setWidth] = useState(() => Dimensions.get('window').width)
    const layout = getTopBarLayout({ width, smallScreenNavigation, isMiddleScreen, sidebarExpanded })
    // On desktop AnnaShell's strip is the top bar. In plain Alldone it sits here, right of the sidebar,
    // like this bar did (AnnaStripSlotContext); in assistant mode AnnaShell shows it above everything.
    const inAnnaStrip = useContext(AnnaTopStripContext)
    const stripSlot = useContext(AnnaStripSlotContext)
    const claimStripSlot = stripSlot?.claim
    useLayoutEffect(() => claimStripSlot?.(), [claimStripSlot])
    // The collapsed sidebar floats over the content, which keeps clear of it (MainViewsContainer).
    const { overlay } = useCollapsibleSidebar()
    if (inAnnaStrip) {
        if (!stripSlot) return null
        return (
            <View style={[containerStyle, overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH }]}>
                {stripSlot.strip}
            </View>
        )
    }

    return (
        <View style={containerStyle} onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
            {layout.compact ? (
                <View style={[layout.margins, !smallScreenNavigation && localStyles.tabletHeader]}>
                    <TopBarMobile compact={layout.compactStatistics} showMenu={smallScreenNavigation} />
                </View>
            ) : (
                <TopBar />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    tabletHeader: {
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        overflow: 'hidden',
    },
})
