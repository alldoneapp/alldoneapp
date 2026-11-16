import React, { useContext } from 'react'
import { StyleSheet, View } from 'react-native-web'

import TopBarContainer from './TopBarContainer'
import AnnaTopStripContext from '../Anna/AnnaTopStripContext'
import { AnnaViewSwitchContext } from '../Anna/AnnaViewSwitch'

/**
 * The column right of a detail view's sidebar, with Alldone's top bar at its top as RootView has it:
 * inside AnnaShell, AnnaShell's strip on desktop (AnnaStripSlot, as wide as the content, so the
 * sidebar runs up to the top) and the phone bar in its phone layout. Outside AnnaShell (shared links)
 * the detail views keep having no top bar. The tree is the same with or without the bar, so switching
 * views never remounts the screen, and the content keeps its own positioning (an absolute back button
 * sits at the top of the content, below the bar).
 */
export default function TopBarColumn({ children }) {
    const underStrip = useContext(AnnaTopStripContext)
    const phoneLayout = !!useContext(AnnaViewSwitchContext)
    return (
        <View style={localStyles.column}>
            {(underStrip || phoneLayout) && <TopBarContainer containerStyle={localStyles.topBar} />}
            <View style={localStyles.content}>{children}</View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    column: {
        flex: 1,
    },
    // Above the content, like RootView's top bar, for the bar's own menus.
    topBar: {
        zIndex: 10,
    },
    content: {
        flex: 1,
    },
})
