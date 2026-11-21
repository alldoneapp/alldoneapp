import {
    DV_TAB_ROOT_ARTIFACTS,
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_WIKI,
} from '../../../utils/TabNavigationConstants'
import { allGoals } from '../../AllSections/allSectionHelper'

/**
 * AT-3121, the "Anna on top" sidebar (`SIDEBAR_NAVIGATION_SECTIONS_TOP`): picking a project or All
 * projects keeps the section on screen (Notes from one project to the next) instead of jumping back to
 * Tasks.
 *
 * Kept free of heavy imports: the project rows and All projects use it, and they are imported far
 * and wide (AnnaShell.test.js mocks react-redux and imports ProjectItem).
 */
const KEPT_SECTIONS = [
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_ARTIFACTS,
    DV_TAB_ROOT_WIKI,
]

// The section a project switch lands on: the one on screen, or Tasks from anywhere else (Updates).
export const getSectionAfterProjectSwitch = selectedSidebarTab =>
    KEPT_SECTIONS.includes(selectedSidebarTab) ? selectedSidebarTab : DV_TAB_ROOT_TASKS

// Goals show every member's goals (`allGoals`), except in a guide, like the advanced sidebar's Goals.
export const getSectionCurrentUser = (tab, loggedUser, isGuide = false) =>
    tab === DV_TAB_ROOT_GOALS && !isGuide ? allGoals : loggedUser
