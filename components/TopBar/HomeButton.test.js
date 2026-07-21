import React from 'react'
import renderer from 'react-test-renderer'
import { StyleSheet } from 'react-native'

import { colors } from '../styles/global'

const mockDispatch = jest.fn()
let mockState

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../Icon', () => 'Icon')
jest.mock('../Feeds/FollowSwitchableTag/AmountTag', () => 'AmountTag')
jest.mock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../redux/store', () => ({ getState: () => ({ expandedNavPicker: false }) }))
jest.mock('../../utils/TabNavigationConstants', () => ({ DV_TAB_ROOT_TASKS: 'tasks' }))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({ ALL_PROJECTS_INDEX: -1 }))
jest.mock('../../redux/actions', () => ({
    navigateToAllProjectsTasks: options => ({ type: 'all project tasks', options }),
    setSelectedSidebarTab: tab => ({ type: 'sidebar tab', tab }),
    switchProject: projectIndex => ({ type: 'switch project', projectIndex }),
}))

const HomeButton = require('./HomeButton').default

describe('HomeButton open tasks badge', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        mockState = {
            loggedUser: {
                uid: 'user-1',
                archivedProjectIds: ['archived'],
                templateProjectIds: ['template'],
            },
            sidebarNumbers: {
                active: { 'user-1': 43 },
                archived: { 'user-1': 5 },
                template: { 'user-1': 8 },
            },
        }
    })

    it('shows the open task amount from active projects', () => {
        const component = renderer.create(<HomeButton color="black" />)
        const badge = component.root.findByProps({ testID: 'home-open-tasks-badge' })

        expect(badge.findByType('AmountTag').props).toEqual(
            expect.objectContaining({ feedAmount: 43, isFollowedButton: false, showFullAmount: true })
        )
        expect(StyleSheet.flatten(badge.findByType('AmountTag').props.style).backgroundColor).toBe(colors.Primary100)
    })

    it('does not show a badge while the count is zero or loading', () => {
        mockState.sidebarNumbers = { loading: true, active: {} }
        const component = renderer.create(<HomeButton color="black" />)

        expect(component.root.findAllByProps({ testID: 'home-open-tasks-badge' })).toHaveLength(0)
    })

    it('configures the badge to show the full amount for large counts', () => {
        mockState.sidebarNumbers.active['user-1'] = 123
        const component = renderer.create(<HomeButton color="black" />)
        const amountTag = component.root.findByType('AmountTag')

        expect(amountTag.props.feedAmount).toBe(123)
        expect(amountTag.props.showFullAmount).toBe(true)
    })
})
