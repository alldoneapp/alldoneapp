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
            sidebarCompact: false,
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

    it('keeps all navigation controls available in a narrow split workspace', () => {
        expect(
            getResponsiveLayoutState({ width: 680, sidebarExpanded: false, preferCompactNavigation: true })
                .smallScreenNavigation
        ).toBe(true)
        expect(
            getResponsiveLayoutState({ width: 1000, sidebarExpanded: false, preferCompactNavigation: true })
                .smallScreenNavigation
        ).toBe(false)
    })

    // AnnaShell's desktop strip replaces Alldone's top bar, so nothing could open a mobile sidebar:
    // Alldone keeps the desktop one, collapsed where the expanded one does not fit.
    it('keeps the desktop sidebar below the assistant strip, collapsed where the expanded one does not fit', () => {
        const narrow = getResponsiveLayoutState({
            width: 640,
            sidebarExpanded: true,
            preferCompactNavigation: true,
            underStrip: true,
        })
        expect(narrow.smallScreenNavigation).toBe(false)
        expect(narrow.sidebarCompact).toBe(true)
        expect(narrow.isMiddleScreen).toBe(true)

        const atBreakpoint = getResponsiveLayoutState({ width: SCREEN_BREAKPOINT_NAV, underStrip: true })
        expect(atBreakpoint.sidebarCompact).toBe(true)
        const wide = getResponsiveLayoutState({
            width: SCREEN_BREAKPOINT_NAV + 1,
            sidebarExpanded: true,
            underStrip: true,
        })
        expect(wide.sidebarCompact).toBe(false)
        expect(wide.smallScreenNavigation).toBe(false)
    })

    it('never compacts the sidebar outside the strip', () => {
        expect(getResponsiveLayoutState({ width: 700, sidebarExpanded: true }).sidebarCompact).toBe(false)
        expect(getResponsiveLayoutState({ width: 700, sidebarExpanded: false }).sidebarCompact).toBe(false)
    })

    it('only enables the detail-view middle-screen flag on detail routes', () => {
        expect(getResponsiveLayoutState({ width: 900, route: 'TaskDetailedView' }).isMiddleScreenNoteDV).toBe(true)
        expect(getResponsiveLayoutState({ width: 900, route: 'ROOT_TASKS' }).isMiddleScreenNoteDV).toBe(false)
    })
})
