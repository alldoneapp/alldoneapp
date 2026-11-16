import React, { useContext, useLayoutEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { Dimensions, StyleSheet, View } from 'react-native-web'

import TopBar from './TopBar'
import TopBarMobile from './TopBarMobile/TopBarMobile'
import { getDesktopTopBarMargins, getTopBarLayout } from './topBarLayout'
import AnnaTopStripContext, { AnnaStripSlotContext } from '../Anna/AnnaTopStripContext'
import { AnnaViewSwitchContext } from '../Anna/AnnaViewSwitch'
import { selectSidebarExpanded } from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'

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
    // In its slot the strip is a card as wide as the content below, like TopBar: the same margins,
    // clear of a collapsed sidebar too (the shown state, not the stored preference).
    const shownSidebarExpanded = useSelector(selectSidebarExpanded)
    const viewSwitch = useContext(AnnaViewSwitchContext)
    if (inAnnaStrip) {
        if (!stripSlot) return null
        return (
            <View
                style={[
                    containerStyle,
                    getDesktopTopBarMargins({ isMiddleScreen, sidebarExpanded: shownSidebarExpanded }),
                ]}
                dataSet={{ annaStripSlot: 'app' }}
            >
                {stripSlot.strip}
            </View>
        )
    }

    // Inside AnnaShell in its phone layout (a window up to 760px) Alldone always takes its phone bar,
    // which carries the Anna | App switch and leaves the XP bar to its second row, even where its
    // own navigation is still the desktop one (a collapsed sidebar keeps it down to 612px).
    const phoneLayout = !!viewSwitch
    return (
        <View style={containerStyle} onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
            {layout.compact || phoneLayout ? (
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
