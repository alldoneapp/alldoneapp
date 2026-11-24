import {
    DV_TAB_ROOT_ARTIFACTS,
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_WIKI,
} from './TabNavigationConstants'

/**
 * AT-3155: one icon per root section, the same glyph everywhere a section is named: the sidebar's
 * section items (`SidebarMenu/ProjectFolding/SectionItems/*`), the section picker
 * (`ChangeObjectListModal`) and the section name in the "Anna on top" card (`MainSectionTabsHeader`).
 */
export const SECTION_ICONS = {
    [DV_TAB_ROOT_TASKS]: 'check-square',
    [DV_TAB_ROOT_GOALS]: 'target',
    [DV_TAB_ROOT_NOTES]: 'file-text',
    [DV_TAB_ROOT_CONTACTS]: 'users',
    [DV_TAB_ROOT_CHATS]: 'comments-thread',
    [DV_TAB_ROOT_ARTIFACTS]: 'package',
    [DV_TAB_ROOT_WIKI]: 'book-open',
}

// A section without an icon of its own falls back to the Tasks icon, like its title falls back to "Tasks".
export const getSectionIcon = section => SECTION_ICONS[section] || SECTION_ICONS[DV_TAB_ROOT_TASKS]
