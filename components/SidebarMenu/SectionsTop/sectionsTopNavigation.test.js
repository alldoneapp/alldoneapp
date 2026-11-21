import { getSectionAfterProjectSwitch, getSectionCurrentUser } from './sectionsTopNavigation'
import {
    SIDEBAR_NAVIGATION_ADVANCED,
    SIDEBAR_NAVIGATION_SECTIONS_TOP,
    SIDEBAR_NAVIGATION_SIMPLE,
    isSectionsTopSidebarNavigation,
    isSimpleSidebarNavigation,
    sidebarNavigationModeOptions,
} from '../../../utils/SidebarNavigationModes'
import {
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_UPDATES,
    DV_TAB_ROOT_WIKI,
} from '../../../utils/TabNavigationConstants'

jest.mock('../../AllSections/allSectionHelper', () => ({ allGoals: { uid: 'allGoals' } }))

const loggedUser = { uid: 'me' }

describe('sidebar navigation modes (AT-3121)', () => {
    it('offers "Anna on top" as a third setting', () => {
        expect(sidebarNavigationModeOptions).toEqual([
            { value: SIDEBAR_NAVIGATION_SIMPLE, label: 'Simple navigation' },
            { value: SIDEBAR_NAVIGATION_ADVANCED, label: 'Advanced navigation' },
            { value: SIDEBAR_NAVIGATION_SECTIONS_TOP, label: 'Anna on top' },
        ])
    })

    it('unfolds the sections under the selected project, like the advanced sidebar', () => {
        expect(isSectionsTopSidebarNavigation(SIDEBAR_NAVIGATION_SECTIONS_TOP)).toBe(true)
        expect(isSectionsTopSidebarNavigation(SIDEBAR_NAVIGATION_SIMPLE)).toBe(false)
        expect(isSectionsTopSidebarNavigation(undefined)).toBe(false)
        expect(isSimpleSidebarNavigation(SIDEBAR_NAVIGATION_SECTIONS_TOP)).toBe(false)
        expect(isSimpleSidebarNavigation(undefined)).toBe(true)
    })
})

describe('switching projects in the "Anna on top" sidebar (AT-3121)', () => {
    it.each([
        [DV_TAB_ROOT_NOTES, DV_TAB_ROOT_NOTES],
        [DV_TAB_ROOT_GOALS, DV_TAB_ROOT_GOALS],
        [DV_TAB_ROOT_WIKI, DV_TAB_ROOT_WIKI],
        [DV_TAB_ROOT_UPDATES, DV_TAB_ROOT_TASKS],
        [undefined, DV_TAB_ROOT_TASKS],
    ])('from %s lands on %s', (from, to) => {
        expect(getSectionAfterProjectSwitch(from)).toBe(to)
    })

    it("shows every member's goals except in a guide, and the user's own view everywhere else", () => {
        expect(getSectionCurrentUser(DV_TAB_ROOT_GOALS, loggedUser)).toEqual({ uid: 'allGoals' })
        expect(getSectionCurrentUser(DV_TAB_ROOT_GOALS, loggedUser, true)).toBe(loggedUser)
        expect(getSectionCurrentUser(DV_TAB_ROOT_NOTES, loggedUser)).toBe(loggedUser)
    })
})
