import { StyleSheet } from 'react-native'

import { colors, hexColorToRGBa } from '../styles/global'
import { FLOATING_ACTION_CLEARANCE } from '../UIComponents/floatingActionLayout'

const undoActionBarStyles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100000,
        alignItems: 'center',
    },
    viewport: {
        // SafeAreaView's web styles use paddingLeft/paddingRight, which override paddingHorizontal.
        width: '100%',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    mobileViewport: {
        paddingHorizontal: 24,
    },
    container: {
        // Clear the task board's bottom-right floating action at narrow widths,
        // where this full-width banner and the action share horizontal space.
        marginBottom: FLOATING_ACTION_CLEARANCE,
        minHeight: 48,
        maxWidth: 560,
        width: '100%',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: hexColorToRGBa(colors.Text01, 0.8),
        flexDirection: 'row',
        alignItems: 'center',
        boxShadow: '0px 4px 8px rgba(0,0,0,0.20)',
        elevation: 8,
        // AT-2503 — clips the countdown line to the card's rounded corners. `overflow` clips
        // descendants only; an element's own `box-shadow` is painted outside its border box and is
        // unaffected, so the banner keeps its drop shadow.
        overflow: 'hidden',
    },
    dismissArea: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        borderRadius: 8,
    },
    /**
     * AT-2626 — the message must be able to shrink below its longest unbreakable word. A flex
     * item's `min-width: auto` resolves to its min-content width, and react-native-web's
     * `overflow-wrap: break-word` does not lower that, so a label containing a long link grew
     * wider than the card and the card's `overflow: hidden` clipped the Undo button off the end.
     * `minWidth: 0` lets the text give way, and `anywhere` lets the link wrap inside the two
     * clamped lines instead of overflowing them.
     */
    message: {
        color: '#FFFFFF',
        flex: 1,
        minWidth: 0,
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
        marginRight: 16,
    },
    // The action (Undo / Redo / Dismiss / spinner) is never the thing that yields space.
    actionSlot: {
        flexShrink: 0,
    },
    action: {
        color: colors.UtilityBlue200,
    },
    /**
     * AT-2503 — the auto-hide countdown, drawn. A bare draining fill with NO track behind it: a
     * grey rail would announce a UI control in what is otherwise a sentence and a button, and it
     * would still be sitting there after the bar had emptied. Same reasoning as the task-completion
     * progress bar in AT-2404.
     *
     * `transformOrigin` is what makes the line drain from the right edge leftwards rather than
     * shrinking towards its own middle; react-native-web passes it through to CSS `transform-origin`.
     */
    countdown: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
        backgroundColor: hexColorToRGBa(colors.UtilityBlue200, 0.85),
        transformOrigin: 'left center',
    },
})

export default undoActionBarStyles
