import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { DV_TAB_ROOT_GOALS, DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'

const mockDispatch = jest.fn()
const mockGetState = jest.fn()
const mockNavigate = jest.fn()
const mockSetUserLastVisitedBoardDate = jest.fn()
let mockState

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../redux/store', () => ({
    getState: () => mockGetState(),
}))
jest.mock('../../../redux/actions', () => ({
    hideWebSideBar: () => ({ type: 'hide sidebar' }),
    setSelectedSidebarTab: tab => ({ type: 'set sidebar tab', tab }),
    setSelectedTypeOfProject: projectType => ({ type: 'set project type', projectType }),
    setGoalsActiveTab: tab => ({ type: 'set goals tab', tab }),
    setTaskViewToggleIndex: index => ({ type: 'set task view index', index }),
    setTaskViewToggleSection: section => ({ type: 'set task view section', section }),
    storeCurrentShortcutUser: user => ({ type: 'store shortcut user', user }),
    storeCurrentUser: user => ({ type: 'store current user', user }),
}))
jest.mock('../../../utils/NavigationService', () => ({
    navigate: (...args) => mockNavigate(...args),
}))
jest.mock('../../GoalsView/GoalsHelper', () => ({ GOALS_OPEN_TAB_INDEX: 0 }))
jest.mock('../../ModalsManager/modalsManager', () => ({ exitsOpenModals: () => false }))
jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({
    setUserLastVisitedBoardDate: (...args) => mockSetUserLastVisitedBoardDate(...args),
}))
jest.mock('../Themes', () => ({
    getUserItemTheme: () => ({
        container: () => ({}),
        containerActive: () => ({}),
    }),
}))
jest.mock('../Collapsible/UseCollapsibleSidebar', () => () => ({ expanded: true }))
jest.mock('../../../hooks/UseOnHover', () => () => ({
    hover: false,
    onHover: jest.fn(),
    offHover: jest.fn(),
}))
jest.mock('./Common/UserData', () => 'UserData')
jest.mock('./Common/Indicator', () => 'Indicator')
jest.mock('./Common/Amount', () => 'Amount')

const UserItem = require('./UserItem').default

describe('sidebar user item', () => {
    const currentUser = { uid: 'user-1', displayName: 'Current user' }
    const otherUser = { uid: 'user-2', displayName: 'Other user' }

    beforeEach(() => {
        mockDispatch.mockClear()
        mockNavigate.mockClear()
        mockSetUserLastVisitedBoardDate.mockClear()
        mockState = {
            loggedUser: { themeName: 'default' },
            currentUser,
            showShortcuts: false,
            shownFloatPopup: false,
            shortcutCurrentUserUid: null,
        }
        mockGetState.mockReturnValue({
            route: DV_TAB_ROOT_TASKS,
            selectedNavItem: DV_TAB_ROOT_TASKS,
            smallScreenNavigation: false,
        })
    })

    const renderItem = (user, navItem = DV_TAB_ROOT_TASKS) =>
        renderer.create(
            <UserItem
                user={user}
                projectType={'active'}
                projectId={'project-1'}
                projectColor={'blue'}
                projectIndex={0}
                isShared={false}
                navItem={navItem}
            />
        )

    it.each([DV_TAB_ROOT_TASKS, DV_TAB_ROOT_GOALS])(
        'does nothing when the current user is clicked again on the %s board',
        route => {
            mockGetState.mockReturnValue({
                route,
                selectedNavItem: route,
                smallScreenNavigation: false,
            })
            const preventDefault = jest.fn()
            const component = renderItem(currentUser, route)

            act(() =>
                component.root
                    .findByProps({ accessibilityLabel: 'sidebar-user-item' })
                    .props.onPress({ preventDefault })
            )

            expect(preventDefault).toHaveBeenCalled()
            expect(mockNavigate).not.toHaveBeenCalled()
            expect(mockDispatch).not.toHaveBeenCalled()
            expect(mockSetUserLastVisitedBoardDate).not.toHaveBeenCalled()
        }
    )

    it('returns the current user to its root board from a detailed view', () => {
        mockGetState.mockReturnValue({
            route: 'TaskDetailedView',
            selectedNavItem: DV_TAB_ROOT_TASKS,
            smallScreenNavigation: false,
        })
        const component = renderItem(currentUser)

        act(() =>
            component.root.findByProps({ accessibilityLabel: 'sidebar-user-item' }).props.onPress({
                preventDefault: jest.fn(),
            })
        )

        expect(mockNavigate).toHaveBeenCalledWith('Root')
        expect(mockDispatch).toHaveBeenCalledWith(
            expect.arrayContaining([{ type: 'store current user', user: currentUser }])
        )
    })

    it('keeps selecting a different user normally', () => {
        const component = renderItem(otherUser)

        act(() =>
            component.root.findByProps({ accessibilityLabel: 'sidebar-user-item' }).props.onPress({
                preventDefault: jest.fn(),
            })
        )

        expect(mockSetUserLastVisitedBoardDate).toHaveBeenCalledWith('project-1', otherUser, 'lastVisitBoard')
        expect(mockDispatch).toHaveBeenCalledWith(
            expect.arrayContaining([
                { type: 'store current user', user: otherUser },
                { type: 'set project type', projectType: 'active' },
                { type: 'set task view index', index: 0 },
                { type: 'set task view section', section: 'Open' },
            ])
        )
    })
})
