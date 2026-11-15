import React, { useContext, useState } from 'react'
import { useSelector } from 'react-redux'
import { Dimensions, StyleSheet, View } from 'react-native-web'

import TopBar from './TopBar'
import TopBarMobile from './TopBarMobile/TopBarMobile'
import { getTopBarLayout } from './topBarLayout'
import AnnaTopStripContext from '../Anna/AnnaTopStripContext'

export default function TopBarContainer({ containerStyle }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const [width, setWidth] = useState(() => Dimensions.get('window').width)
    const layout = getTopBarLayout({ width, smallScreenNavigation, isMiddleScreen, sidebarExpanded })
    // Desktop assistant mode shows gold, search, chats and updates in the strip above both cards.
    // A pane narrow enough for mobile navigation keeps its own bar: it carries the sidebar menu.
    const inAnnaStrip = useContext(AnnaTopStripContext)
    if (inAnnaStrip && !smallScreenNavigation) return null

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
