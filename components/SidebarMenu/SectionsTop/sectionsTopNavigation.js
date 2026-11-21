import {
    hideFloatPopup,
    hideWebSideBar,
    setGoalsActiveTab,
    setSelectedSidebarTab,
    storeCurrentUser,
} from '../../../redux/actions'
import {
    DV_TAB_ROOT_ARTIFACTS,
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_WIKI,
    ROOT_ROUTES,
} from '../../../utils/TabNavigationConstants'
import { getSidebarChatsActions } from '../openSidebarChats'
import { allGoals } from '../../AllSections/allSectionHelper'
import { GOALS_OPEN_TAB_INDEX } from '../../GoalsView/GoalsHelper'

/**
 * AT-3121, the "Sections on top" sidebar (`SIDEBAR_NAVIGATION_SECTIONS_TOP`): the sections are a fixed
 * list at the top of the sidebar and the projects below it filter them. Picking a project or All
 * projects keeps the section on screen instead of jumping back to Tasks.
 */
export const SECTIONS_TOP_ITEMS = [
    { tab: DV_TAB_ROOT_TASKS, icon: 'check-square', text: 'Tasks' },
    { tab: DV_TAB_ROOT_GOALS, icon: 'target', text: 'Goals' },
    { tab: DV_TAB_ROOT_NOTES, icon: 'file-text', text: 'Notes' },
    { tab: DV_TAB_ROOT_CONTACTS, icon: 'users', text: 'Contacts' },
    { tab: DV_TAB_ROOT_CHATS, icon: 'comments-thread', text: 'Chats' },
    { tab: DV_TAB_ROOT_ARTIFACTS, icon: 'package', text: 'Artifacts' },
    { tab: DV_TAB_ROOT_WIKI, icon: 'book-open', text: 'Wiki' },
]

const SECTIONS_TOP_TABS = SECTIONS_TOP_ITEMS.map(item => item.tab)

// A detail view belongs to the section its object comes from.
const DETAIL_ROUTE_SECTIONS = {
    TaskDetailedView: DV_TAB_ROOT_TASKS,
    GoalDetailedView: DV_TAB_ROOT_GOALS,
    NotesDetailedView: DV_TAB_ROOT_NOTES,
    ContactDetailedView: DV_TAB_ROOT_CONTACTS,
    UserDetailedView: DV_TAB_ROOT_CONTACTS,
    ChatDetailedView: DV_TAB_ROOT_CHATS,
}

// The one section the list marks: the detail view's section, the root view's tab, or none on any
// other screen (settings, project properties, Updates).
export const getSelectedSection = (selectedSidebarTab, route) => {
    if (DETAIL_ROUTE_SECTIONS[route]) return DETAIL_ROUTE_SECTIONS[route]
    if (!ROOT_ROUTES.includes(route)) return null
    return SECTIONS_TOP_TABS.includes(selectedSidebarTab) ? selectedSidebarTab : null
}

// The section a project switch lands on: the one on screen, or Tasks from anywhere else (Updates).
export const getSectionAfterProjectSwitch = selectedSidebarTab =>
    SECTIONS_TOP_TABS.includes(selectedSidebarTab) ? selectedSidebarTab : DV_TAB_ROOT_TASKS

// Goals show every member's goals (`allGoals`), except in a guide, like the advanced sidebar's Goals.
export const getSectionCurrentUser = (tab, loggedUser, isGuide = false) =>
    tab === DV_TAB_ROOT_GOALS && !isGuide ? allGoals : loggedUser

/**
 * What a press on a section at the top dispatches. Chats opens the same list as the other sidebar
 * Chats entries (`openSidebarChats.js`); the rest select the tab like a press in the old tab row
 * (`MainSectionTabsHeader`), with Goals also reset to its Open tab like the advanced sidebar's Goals.
 */
export function getSectionsTopActions(state, tab, { projectId = null, inAllProjects = false, isGuide = false } = {}) {
    const currentUserAction = storeCurrentUser(getSectionCurrentUser(tab, state.loggedUser, isGuide))
    if (tab === DV_TAB_ROOT_CHATS) {
        return [...getSidebarChatsActions(state, projectId, inAllProjects), currentUserAction]
    }

    const actions = [setSelectedSidebarTab(tab), hideFloatPopup(), currentUserAction]
    if (tab === DV_TAB_ROOT_GOALS) actions.push(setGoalsActiveTab(GOALS_OPEN_TAB_INDEX))
    if (state.smallScreenNavigation) actions.push(hideWebSideBar())
    return actions
}
