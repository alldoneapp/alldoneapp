import {
    SCREEN_BREAKPOINT,
    SCREEN_BREAKPOINT_MIDDLE,
    SCREEN_BREAKPOINT_NAV,
    SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED,
    SCREEN_SMALL_BREAKPOINT_NAV,
    SIDEBAR_MENU_WIDTH,
} from '../components/styles/global'

const DETAIL_VIEW_ROUTES = new Set([
    'NotesDetailedView',
    'ChatDetailedView',
    'ContactDetailedView',
    'GoalDetailedView',
    'SkillDetailedView',
    'AssistantDetailedView',
    'TaskDetailedView',
    'UserDetailedView',
])

/**
 * Resolve every responsive Redux flag from one viewport measurement.
 *
 * AppNavigator used to calculate these only from the outer View's first
 * `onLayout`. On a phone that means the cached task board can paint once with
 * the store's desktop defaults before React Native Web reports its width. Keep
 * this calculation pure so boot and later layout changes use the exact same
 * breakpoints.
 */
export const getResponsiveLayoutState = ({
    width,
    sidebarExpanded = false,
    route = '',
    preferCompactNavigation = false,
    underStrip = false,
}) => {
    // Below the desktop assistant strip (AnnaTopStrip) Alldone has no bar of its own to open a
    // mobile sidebar from, so it always keeps the desktop sidebar: collapsed, floating open on
    // hover, wherever the expanded one does not fit (`sidebarCompact`). AnnaShell only puts
    // Alldone beside the chat where it gets the collapsed sidebar's width
    // (SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED); narrower, it shows one or the other.
    // Elsewhere the split workspace on a phone needs the compact navigation before the
    // desktop top bar runs out of room, even when the user's sidebar preference is collapsed.
    const navigationBreakpoint =
        sidebarExpanded || preferCompactNavigation ? SCREEN_BREAKPOINT_NAV : SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED
    const smallScreenNavigation = !underStrip && width <= navigationBreakpoint
    // Preserve AppNavigator's original boundary behavior: navigation switches
    // at <=, while content width starts accounting for the sidebar at the exact
    // breakpoint. Below the strip the sidebar is always there.
    const contentWidth = !underStrip && width < navigationBreakpoint ? width : width - SIDEBAR_MENU_WIDTH

    return {
        isMiddleScreen: contentWidth <= SCREEN_BREAKPOINT_MIDDLE - SIDEBAR_MENU_WIDTH,
        isMiddleScreenNoteDV: contentWidth <= SCREEN_BREAKPOINT_MIDDLE && DETAIL_VIEW_ROUTES.has(route),
        smallScreen: contentWidth <= SCREEN_BREAKPOINT,
        smallScreenNavigation,
        reallySmallScreenNavigation: width <= SCREEN_SMALL_BREAKPOINT_NAV,
        smallScreenNavSidebarCollapsed: width <= SCREEN_BREAKPOINT_NAV,
        sidebarCompact: underStrip && width <= SCREEN_BREAKPOINT_NAV,
    }
}
