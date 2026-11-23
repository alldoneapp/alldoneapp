export const SIDEBAR_NAVIGATION_SIMPLE = 'simple'
export const SIDEBAR_NAVIGATION_ADVANCED = 'advanced'
// AT-3121, "Anna on top": Anna is a big button at the top of the sidebar, the selected project (or
// All projects) unfolds its sections below it like the advanced sidebar, and the tab row above the
// lists goes away. Stored as 'sectionsTop', the name of its first version (sections fixed on top).
export const SIDEBAR_NAVIGATION_SECTIONS_TOP = 'sectionsTop'

// AT-3122: "Anna on top" is the navigation of every account that never picked one (was simple).
// `users/{uid}.sidebarNavigationMode` is written only when the user picks a mode in Settings, so a
// missing value means "never chose" and follows this default; a stored value is a deliberate choice
// and is kept. Never write the default into the user document: it would turn into a choice that a
// later change of the default could no longer reach. Anonymous viewers of shared links get an
// explicit simple mode from ANONYMOUS_USER_DATA (utils/SharedHelper.js).
export const DEFAULT_SIDEBAR_NAVIGATION_MODE = SIDEBAR_NAVIGATION_SECTIONS_TOP

const SIDEBAR_NAVIGATION_MODES = [
    SIDEBAR_NAVIGATION_SIMPLE,
    SIDEBAR_NAVIGATION_ADVANCED,
    SIDEBAR_NAVIGATION_SECTIONS_TOP,
]

// The mode in effect for a stored value: the stored mode, or the default when none (or an unknown
// one) is stored.
export const getSidebarNavigationMode = sidebarNavigationMode => {
    return SIDEBAR_NAVIGATION_MODES.includes(sidebarNavigationMode)
        ? sidebarNavigationMode
        : DEFAULT_SIDEBAR_NAVIGATION_MODE
}

export const isSimpleSidebarNavigation = sidebarNavigationMode => {
    return getSidebarNavigationMode(sidebarNavigationMode) === SIDEBAR_NAVIGATION_SIMPLE
}

export const isSectionsTopSidebarNavigation = sidebarNavigationMode => {
    return getSidebarNavigationMode(sidebarNavigationMode) === SIDEBAR_NAVIGATION_SECTIONS_TOP
}

export const sidebarNavigationModeOptions = [
    { value: SIDEBAR_NAVIGATION_SIMPLE, label: 'Simple navigation' },
    { value: SIDEBAR_NAVIGATION_ADVANCED, label: 'Advanced navigation' },
    { value: SIDEBAR_NAVIGATION_SECTIONS_TOP, label: 'Anna on top' },
]
