import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider, useSelector } from 'react-redux'
import { TouchableOpacity } from 'react-native'
import { createStore } from 'redux'
import { reduxBatch } from '@manaflair/redux-batch'

import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'

const mockNavigate = jest.fn()
const mockSetUserLastVisitedBoardDate = jest.fn()
let mockStore

jest.mock('../../redux/store', () => ({ getState: () => mockStore.getState() }))
jest.mock('../Icon', () => 'Icon')
jest.mock('../TopBar/GoldArea', () => 'GoldArea')
jest.mock('../TopBar/HomeButton', () => 'HomeButton')
jest.mock('../../Themes/Themes', () => ({ getTheme: () => ({ menuIcon: 'black' }) }))
jest.mock('../TopBar/Themes', () => ({ Themes: {} }))
jest.mock('../GoalsView/GoalsHelper', () => ({ GOALS_OPEN_TAB_INDEX: 0 }))
jest.mock('../ModalsManager/modalsManager', () => ({ exitsOpenModals: () => false }))
jest.mock('../ContactsView/Utils/ContactsHelper', () => ({
    setUserLastVisitedBoardDate: (...args) => mockSetUserLastVisitedBoardDate(...args),
}))
jest.mock('../../utils/NavigationService', () => ({
    navigate: (...args) => mockNavigate(...args),
}))
jest.mock('./Themes', () => ({
    getUserItemTheme: () => ({
        container: () => ({}),
        containerActive: () => ({}),
    }),
}))
jest.mock('../../hooks/UseOnHover', () => () => ({
    hover: false,
    onHover: jest.fn(),
    offHover: jest.fn(),
}))
jest.mock('./Items/Common/UserData', () => 'UserData')
jest.mock('./Items/Common/Indicator', () => 'Indicator')
jest.mock('./Items/Common/Amount', () => 'Amount')

const TopBarMobileStatisticArea = require('../TopBar/TopBarMobile/TopBarMobileStatisticArea').default
const UserItem = require('./Items/UserItem').default

describe('mobile sidebar user flow', () => {
    const user = { uid: 'user-1', displayName: 'Current user' }

    const reducer = (state, action) => {
        if (action.type === 'Set show web side bar') {
            return { ...state, showWebSideBar: { ...state.showWebSideBar, visible: true } }
        }
        if (action.type === 'Hide web side bar') {
            return { ...state, showWebSideBar: { ...state.showWebSideBar, visible: false } }
        }
        if (action.type === 'Store current user') return { ...state, currentUser: action.currentUser }
        if (action.type === 'Set selected sidebar tab') return { ...state, selectedSidebarTab: action.tab }
        return state
    }

    function Harness() {
        const sidebarVisible = useSelector(state => state.showWebSideBar.visible)

        return (
            <>
                <TopBarMobileStatisticArea />
                {sidebarVisible && (
                    <UserItem
                        user={user}
                        projectType={'active'}
                        projectId={'project-1'}
                        projectColor={'blue'}
                        projectIndex={0}
                        isShared={false}
                        navItem={DV_TAB_ROOT_TASKS}
                    />
                )}
            </>
        )
    }

    beforeEach(() => {
        mockNavigate.mockClear()
        mockSetUserLastVisitedBoardDate.mockClear()
        mockStore = createStore(
            reducer,
            {
                loggedUser: {
                    uid: user.uid,
                    themeName: 'default',
                    isAnonymous: false,
                    sidebarExpanded: true,
                    archivedProjectIds: [],
                    templateProjectIds: [],
                },
                currentUser: user,
                route: DV_TAB_ROOT_TASKS,
                selectedNavItem: DV_TAB_ROOT_TASKS,
                selectedSidebarTab: DV_TAB_ROOT_TASKS,
                smallScreenNavigation: true,
                showWebSideBar: { visible: false },
                expandedNavPicker: false,
                showShortcuts: false,
                shownFloatPopup: false,
                shortcutCurrentUserUid: null,
                sidebarHovered: false,
                addProjectIsOpen: false,
                addContactIsOpen: false,
            },
            reduxBatch
        )
    })

    it('opens, closes on repeated user selection, and can be opened again', () => {
        let component
        act(() => {
            component = renderer.create(
                <Provider store={mockStore}>
                    <Harness />
                </Provider>
            )
        })

        const pressMenuButton = () => {
            act(() =>
                component.root.findByType(TouchableOpacity).props.onPress({
                    preventDefault: jest.fn(),
                })
            )
        }

        pressMenuButton()

        expect(mockStore.getState().showWebSideBar.visible).toBe(true)
        expect(component.root.findAllByType(UserItem)).toHaveLength(1)

        act(() =>
            component.root.findByType(UserItem).findByType(TouchableOpacity).props.onPress({
                preventDefault: jest.fn(),
            })
        )

        expect(mockStore.getState().showWebSideBar.visible).toBe(false)
        expect(component.root.findAllByType(UserItem)).toHaveLength(0)
        expect(mockNavigate).not.toHaveBeenCalled()
        expect(mockSetUserLastVisitedBoardDate).toHaveBeenCalledWith('project-1', user, 'lastVisitBoard')

        pressMenuButton()

        expect(mockStore.getState().showWebSideBar.visible).toBe(true)
        expect(component.root.findAllByType(UserItem)).toHaveLength(1)
    })
})
