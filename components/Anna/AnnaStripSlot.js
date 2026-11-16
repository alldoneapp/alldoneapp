import React, { useContext, useLayoutEffect } from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, View } from 'react-native-web'

import { AnnaStripSlotContext } from './AnnaTopStripContext'
import { getDesktopTopBarMargins } from '../TopBar/topBarLayout'
import { selectSidebarExpanded } from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'

/**
 * Plain Alldone on desktop: AnnaShell's top strip in the screen's own top bar slot, right of the
 * sidebar, which then runs up to the top. The strip is a card as wide as the content below, with
 * TopBar's margins, clear of a collapsed sidebar too (the shown state, not the stored preference).
 * Renders nothing in assistant mode and on phones, where AnnaShell places the strip itself.
 */
export default function AnnaStripSlot({ style }) {
    const stripSlot = useContext(AnnaStripSlotContext)
    return stripSlot ? <ClaimedStripSlot slot={stripSlot} style={style} /> : null
}

function ClaimedStripSlot({ slot: { strip, claim }, style }) {
    useLayoutEffect(() => claim(), [claim])
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const sidebarExpanded = useSelector(selectSidebarExpanded)
    return (
        <View
            style={[localStyles.slot, style, getDesktopTopBarMargins({ isMiddleScreen, sidebarExpanded })]}
            dataSet={{ annaStripSlot: 'app' }}
        >
            {strip}
        </View>
    )
}

const localStyles = StyleSheet.create({
    // Above the content, like RootView's top bar, for the strip's own menus.
    slot: {
        zIndex: 10,
    },
})
