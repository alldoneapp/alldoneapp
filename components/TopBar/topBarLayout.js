import { SCREEN_SMALL_BREAKPOINT_NAV } from '../styles/global'

export const COMPACT_TOP_BAR_WIDTH = 720

export const getDesktopTopBarMargins = ({ isMiddleScreen, sidebarExpanded }) => ({
    marginLeft: (isMiddleScreen ? 56 : 104) + (sidebarExpanded ? 0 : 56),
    marginRight: isMiddleScreen ? 56 : 104,
})

export const getTopBarLayout = ({ width, smallScreenNavigation, isMiddleScreen, sidebarExpanded }) => {
    const margins = smallScreenNavigation
        ? { marginLeft: 0, marginRight: 0 }
        : getDesktopTopBarMargins({ isMiddleScreen, sidebarExpanded })
    const availableWidth = Math.max(0, width - margins.marginLeft - margins.marginRight)

    return {
        margins,
        compact: smallScreenNavigation || availableWidth <= COMPACT_TOP_BAR_WIDTH,
        compactStatistics: availableWidth <= SCREEN_SMALL_BREAKPOINT_NAV,
    }
}
