/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, View } from 'react-native'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import ProjectLine from './ProjectLine'
import ColoredCircleSmall from '../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('../../../utils/HelperFunctions', () => ({
    dismissAllPopups: jest.fn(),
    popoverToSafePosition: jest.fn(),
}))
jest.mock('../../../redux/actions', () => ({
    setSelectedNavItem: jest.fn(),
    setSelectedTypeOfProject: jest.fn(),
    storeCurrentUser: jest.fn(),
    switchProject: jest.fn(),
    storeLoggedUser: jest.fn(),
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectsSettings', () => ({
    PROJECT_TYPE_ACTIVE: 'active',
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    ALL_PROJECTS_INDEX: -1,
    default: {},
}))
jest.mock('../../UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch', () => ({
    __esModule: true,
    ALL_PROJECTS_OPTION: 'all-projects',
    default: 'SelectProjectModalInSearch',
}))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../AllSections/allSectionHelper', () => ({ allGoals: {} }))
jest.mock('../../UIComponents/HOC/withSafePopover', () => Component => props => (
    <Component openPopover={jest.fn()} closePopover={jest.fn()} isOpen={false} {...props} />
))
jest.mock('../../UIComponents/ModalShell/AppPopover', () => 'AppPopover')
jest.mock('../../../utils/useWindowSize', () => () => [1200, 800])

describe('ProjectLine project marker', () => {
    it('keeps the configured project color when a header text color is applied', () => {
        const project = {
            id: 'project-1',
            index: 0,
            name: 'Alldone Product',
            color: '#E969A8',
        }
        useSelector.mockImplementation(selector =>
            selector({
                selectedProjectIndex: 0,
                loggedUserProjects: [project],
                loggedUser: {},
                selectedSidebarTab: '',
                smallScreenNavigation: false,
            })
        )

        const tree = renderer.create(<ProjectLine projectIndex={0} user={{}} textColor="#0B1930" />)
        const marker = tree.root.findByType(ColoredCircleSmall)
        const renderedMarker = marker.findByType(View)

        expect(marker.props.color).toBe(project.color)
        expect(marker.props.containerStyle).toEqual({ marginHorizontal: 4 })
        expect(StyleSheet.flatten(renderedMarker.props.style)).toMatchObject({
            backgroundColor: project.color,
            width: 16,
            height: 16,
        })
    })
})
