import { getResponsiveLayoutState } from '../../../utils/responsiveLayout'
import { computeSafeAreaModalMaxWidth, computeSafeAreaOverlayPadding } from '../../../utils/modalSafeArea'
import { POPOVER_DESKTOP_WIDTH, POPOVER_MOBILE_WIDTH, POPOVER_TABLET_WIDTH } from '../../styles/global'

/**
 * Where the "A new day has begun" popup is placed (AT-3083).
 *
 * App mode (`alldone`) keeps the popup in the Alldone pane, as before. In Assistant
 * (`chat`) and Both (`split`) the popup covers the whole browser window: the pane can be
 * hidden there (Assistant mode, a phone or narrow window with the chat in front, the
 * browser or VM screen), and a pane-scoped overlay is then hidden with it while it still
 * holds the daily reload. Decided with the product owner on 2026-11-18: in both assistant
 * layouts it always uses the whole window, including over the chat.
 */
export const isNewDayFullWindowLayout = layout => layout === 'chat' || layout === 'split'

/**
 * Card width, compact flag and overlay padding for the whole-window placement.
 *
 * The redux screen flags (`smallScreenNavigation`, `isMiddleScreen`) and the shared
 * popup helpers follow the Alldone pane in assistant mode, which is the wrong box
 * once the popup covers the window. The same breakpoints are applied to the window here.
 */
export const getNewDayFullWindowLayout = ({ windowWidth, insets } = {}) => {
    const width = Number.isFinite(windowWidth) ? windowWidth : 0
    const { smallScreenNavigation, isMiddleScreen } = getResponsiveLayoutState({ width })
    const maxWidth = computeSafeAreaModalMaxWidth({ windowWidth: width, insets })
    const desired = smallScreenNavigation ? maxWidth : isMiddleScreen ? POPOVER_TABLET_WIDTH : POPOVER_DESKTOP_WIDTH
    const cardWidth =
        maxWidth > 0 ? Math.min(desired, maxWidth) : smallScreenNavigation ? POPOVER_MOBILE_WIDTH : desired
    return {
        compact: smallScreenNavigation || isMiddleScreen,
        cardStyle: { minWidth: cardWidth, maxWidth: cardWidth, width: cardWidth },
        overlayPadding: computeSafeAreaOverlayPadding({ insets }),
    }
}
