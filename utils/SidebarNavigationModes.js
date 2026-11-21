export const SIDEBAR_NAVIGATION_SIMPLE = 'simple'
export const SIDEBAR_NAVIGATION_ADVANCED = 'advanced'
// AT-3121: the sections (Tasks, Goals, Notes, ...) sit fixed at the top of the sidebar, the projects
// below them, and the tab row above the lists goes away. Under a project it keeps the simple
// sidebar's people list, so `isSimpleSidebarNavigation` stays true for it.
export const SIDEBAR_NAVIGATION_SECTIONS_TOP = 'sectionsTop'

export const isSimpleSidebarNavigation = sidebarNavigationMode => {
    return sidebarNavigationMode !== SIDEBAR_NAVIGATION_ADVANCED
}

export const isSectionsTopSidebarNavigation = sidebarNavigationMode => {
    return sidebarNavigationMode === SIDEBAR_NAVIGATION_SECTIONS_TOP
}

export const sidebarNavigationModeOptions = [
    { value: SIDEBAR_NAVIGATION_SIMPLE, label: 'Simple navigation' },
    { value: SIDEBAR_NAVIGATION_ADVANCED, label: 'Advanced navigation' },
    { value: SIDEBAR_NAVIGATION_SECTIONS_TOP, label: 'Sections on top' },
]
