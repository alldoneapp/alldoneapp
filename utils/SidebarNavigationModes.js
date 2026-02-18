export const SIDEBAR_NAVIGATION_SIMPLE = 'simple'
export const SIDEBAR_NAVIGATION_ADVANCED = 'advanced'

export const isSimpleSidebarNavigation = sidebarNavigationMode => {
    return sidebarNavigationMode !== SIDEBAR_NAVIGATION_ADVANCED
}

export const sidebarNavigationModeOptions = [
    { value: SIDEBAR_NAVIGATION_SIMPLE, label: 'Simple navigation' },
    { value: SIDEBAR_NAVIGATION_ADVANCED, label: 'Advanced navigation' },
]
