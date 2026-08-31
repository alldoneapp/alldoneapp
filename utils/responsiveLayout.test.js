import { SCREEN_BREAKPOINT_NAV, SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED } from '../components/styles/global'
import { getResponsiveLayoutState } from './responsiveLayout'

describe('getResponsiveLayoutState', () => {
    it('resolves the Pixel viewport as mobile before the first layout callback', () => {
        expect(
            getResponsiveLayoutState({
                width: 411,
                sidebarExpanded: false,
                route: 'ROOT_TASKS',
            })
        ).toEqual({
            isMiddleScreen: true,
            isMiddleScreenNoteDV: false,
            smallScreen: true,
            smallScreenNavigation: true,
            reallySmallScreenNavigation: true,
            smallScreenNavSidebarCollapsed: true,
        })
    })

    it('uses the same sidebar-dependent navigation breakpoint as AppNavigator', () => {
        const widthBetweenBreakpoints = Math.round(
            (SCREEN_BREAKPOINT_NAV + SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED) / 2
        )

        expect(
            getResponsiveLayoutState({ width: widthBetweenBreakpoints, sidebarExpanded: true }).smallScreenNavigation
        ).toBe(true)
        expect(
            getResponsiveLayoutState({ width: widthBetweenBreakpoints, sidebarExpanded: false }).smallScreenNavigation
        ).toBe(false)
    })

    it('keeps the original content-width behavior at the expanded-sidebar boundary', () => {
        const state = getResponsiveLayoutState({
            width: SCREEN_BREAKPOINT_NAV,
            sidebarExpanded: true,
        })

        expect(state.smallScreenNavigation).toBe(true)
        expect(state.isMiddleScreen).toBe(true)
    })

    it('only enables the detail-view middle-screen flag on detail routes', () => {
        expect(getResponsiveLayoutState({ width: 900, route: 'TaskDetailedView' }).isMiddleScreenNoteDV).toBe(true)
        expect(getResponsiveLayoutState({ width: 900, route: 'ROOT_TASKS' }).isMiddleScreenNoteDV).toBe(false)
    })
})
