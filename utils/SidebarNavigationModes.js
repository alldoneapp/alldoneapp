export const SIDEBAR_NAVIGATION_SIMPLE = 'simple'
export const SIDEBAR_NAVIGATION_ADVANCED = 'advanced'
// AT-3121, "Anna on top": Anna is a big button at the top of the sidebar, the selected project (or
// All projects) unfolds its sections below it like the advanced sidebar, and the tab row above the
// lists goes away. Stored as 'sectionsTop', the name of its first version (sections fixed on top).
export const SIDEBAR_NAVIGATION_SECTIONS_TOP = 'sectionsTop'

export const isSimpleSidebarNavigation = sidebarNavigationMode => {
    return (
        sidebarNavigationMode !== SIDEBAR_NAVIGATION_ADVANCED &&
        sidebarNavigationMode !== SIDEBAR_NAVIGATION_SECTIONS_TOP
    )
}

export const isSectionsTopSidebarNavigation = sidebarNavigationMode => {
    return sidebarNavigationMode === SIDEBAR_NAVIGATION_SECTIONS_TOP
}

export const sidebarNavigationModeOptions = [
    { value: SIDEBAR_NAVIGATION_SIMPLE, label: 'Simple navigation' },
    { value: SIDEBAR_NAVIGATION_ADVANCED, label: 'Advanced navigation' },
    { value: SIDEBAR_NAVIGATION_SECTIONS_TOP, label: 'Anna on top' },
]
