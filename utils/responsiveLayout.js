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
export const getResponsiveLayoutState = ({ width, sidebarExpanded = false, route = '' }) => {
    const navigationBreakpoint = sidebarExpanded ? SCREEN_BREAKPOINT_NAV : SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED
    // Preserve AppNavigator's original boundary behavior: navigation switches
    // at <=, while content width starts accounting for the sidebar at the exact
    // breakpoint.
    const contentWidth = width < navigationBreakpoint ? width : width - SIDEBAR_MENU_WIDTH

    return {
        isMiddleScreen: contentWidth <= SCREEN_BREAKPOINT_MIDDLE - SIDEBAR_MENU_WIDTH,
        isMiddleScreenNoteDV: contentWidth <= SCREEN_BREAKPOINT_MIDDLE && DETAIL_VIEW_ROUTES.has(route),
        smallScreen: contentWidth <= SCREEN_BREAKPOINT,
        smallScreenNavigation: width <= navigationBreakpoint,
        reallySmallScreenNavigation: width <= SCREEN_SMALL_BREAKPOINT_NAV,
        smallScreenNavSidebarCollapsed: width <= SCREEN_BREAKPOINT_NAV,
    }
}
