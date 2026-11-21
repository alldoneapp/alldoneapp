import {
    SECTIONS_TOP_ITEMS,
    getSectionAfterProjectSwitch,
    getSectionCurrentUser,
    getSectionsTopActions,
    getSelectedSection,
} from './sectionsTopNavigation'
import {
    SIDEBAR_NAVIGATION_ADVANCED,
    SIDEBAR_NAVIGATION_SECTIONS_TOP,
    SIDEBAR_NAVIGATION_SIMPLE,
    isSectionsTopSidebarNavigation,
    isSimpleSidebarNavigation,
    sidebarNavigationModeOptions,
} from '../../../utils/SidebarNavigationModes'
import {
    DV_TAB_ROOT_ARTIFACTS,
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_UPDATES,
    DV_TAB_ROOT_WIKI,
} from '../../../utils/TabNavigationConstants'

jest.mock('../../../redux/actions', () => ({
    hideFloatPopup: () => ({ type: 'hide popup' }),
    hideWebSideBar: () => ({ type: 'hide sidebar' }),
    setGoalsActiveTab: index => ({ type: 'set goals tab', index }),
    setSelectedSidebarTab: tab => ({ type: 'set sidebar tab', tab }),
    storeCurrentUser: user => ({ type: 'store current user', user }),
}))
jest.mock('../openSidebarChats', () => ({
    getSidebarChatsActions: (state, projectId, inAllProjects) => [{ type: 'open chats', projectId, inAllProjects }],
}))
jest.mock('../../AllSections/allSectionHelper', () => ({ allGoals: { uid: 'allGoals' } }))
jest.mock('../../GoalsView/GoalsHelper', () => ({ GOALS_OPEN_TAB_INDEX: 0 }))

const loggedUser = { uid: 'me' }
const state = (overrides = {}) => ({ loggedUser, smallScreenNavigation: false, ...overrides })

describe('sidebar navigation modes (AT-3121)', () => {
    it('offers "Sections on top" as a third setting', () => {
        expect(sidebarNavigationModeOptions.map(option => option.value)).toEqual([
            SIDEBAR_NAVIGATION_SIMPLE,
            SIDEBAR_NAVIGATION_ADVANCED,
            SIDEBAR_NAVIGATION_SECTIONS_TOP,
        ])
    })

    it('treats only the new mode as sections on top, and keeps the simple people list under a project', () => {
        expect(isSectionsTopSidebarNavigation(SIDEBAR_NAVIGATION_SECTIONS_TOP)).toBe(true)
        expect(isSectionsTopSidebarNavigation(SIDEBAR_NAVIGATION_SIMPLE)).toBe(false)
        expect(isSectionsTopSidebarNavigation(undefined)).toBe(false)
        expect(isSimpleSidebarNavigation(SIDEBAR_NAVIGATION_SECTIONS_TOP)).toBe(true)
    })
})

describe('sections on top of the sidebar (AT-3121)', () => {
    it('lists the sections with Tasks first', () => {
        expect(SECTIONS_TOP_ITEMS.map(item => item.tab)).toEqual([
            DV_TAB_ROOT_TASKS,
            DV_TAB_ROOT_GOALS,
            DV_TAB_ROOT_NOTES,
            DV_TAB_ROOT_CONTACTS,
            DV_TAB_ROOT_CHATS,
            DV_TAB_ROOT_ARTIFACTS,
            DV_TAB_ROOT_WIKI,
        ])
    })

    it.each([
        [DV_TAB_ROOT_NOTES, DV_TAB_ROOT_NOTES],
        [DV_TAB_ROOT_GOALS, DV_TAB_ROOT_GOALS],
        [DV_TAB_ROOT_WIKI, DV_TAB_ROOT_WIKI],
        [DV_TAB_ROOT_UPDATES, DV_TAB_ROOT_TASKS],
        [undefined, DV_TAB_ROOT_TASKS],
    ])('a project switch from %s lands on %s', (from, to) => {
        expect(getSectionAfterProjectSwitch(from)).toBe(to)
    })

    it.each([
        [DV_TAB_ROOT_NOTES, DV_TAB_ROOT_NOTES, DV_TAB_ROOT_NOTES],
        [DV_TAB_ROOT_NOTES, 'TaskDetailedView', DV_TAB_ROOT_TASKS],
        [DV_TAB_ROOT_TASKS, 'ContactDetailedView', DV_TAB_ROOT_CONTACTS],
        [DV_TAB_ROOT_TASKS, 'ProjectDetailedView', null],
        [DV_TAB_ROOT_UPDATES, DV_TAB_ROOT_UPDATES, null],
    ])('with tab %s on route %s marks %s', (tab, route, selected) => {
        expect(getSelectedSection(tab, route)).toBe(selected)
    })

    it("shows every member's goals except in a guide, and the user's own view everywhere else", () => {
        expect(getSectionCurrentUser(DV_TAB_ROOT_GOALS, loggedUser)).toEqual({ uid: 'allGoals' })
        expect(getSectionCurrentUser(DV_TAB_ROOT_GOALS, loggedUser, true)).toBe(loggedUser)
        expect(getSectionCurrentUser(DV_TAB_ROOT_NOTES, loggedUser)).toBe(loggedUser)
    })

    it('selects a section like the old tab row did', () => {
        expect(getSectionsTopActions(state(), DV_TAB_ROOT_NOTES)).toEqual([
            { type: 'set sidebar tab', tab: DV_TAB_ROOT_NOTES },
            { type: 'hide popup' },
            { type: 'store current user', user: loggedUser },
        ])
    })

    it("opens Goals on their Open tab with every member's goals", () => {
        expect(getSectionsTopActions(state(), DV_TAB_ROOT_GOALS)).toEqual([
            { type: 'set sidebar tab', tab: DV_TAB_ROOT_GOALS },
            { type: 'hide popup' },
            { type: 'store current user', user: { uid: 'allGoals' } },
            { type: 'set goals tab', index: 0 },
        ])
    })

    it('opens Chats through the shared sidebar Chats helper', () => {
        expect(getSectionsTopActions(state(), DV_TAB_ROOT_CHATS, { projectId: 'p1' })).toEqual([
            { type: 'open chats', projectId: 'p1', inAllProjects: false },
            { type: 'store current user', user: loggedUser },
        ])
    })

    it('closes the phone menu after a section is picked', () => {
        expect(getSectionsTopActions(state({ smallScreenNavigation: true }), DV_TAB_ROOT_CONTACTS)).toContainEqual({
            type: 'hide sidebar',
        })
    })
})
