/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockState
jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../redux/store', () => ({ getState: () => mockState }))
jest.mock('../../../utils/HelperFunctions', () => ({
    __esModule: true,
    default: { getFirstName: name => name.split(' ')[0] },
    dismissAllPopups: jest.fn(),
    popoverToSafePosition: jest.fn(),
}))
jest.mock('../../../redux/actions', () => ({}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectsSettings', () => ({ PROJECT_TYPE_ACTIVE: 'active' }))
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
jest.mock('../../UIComponents/FloatModals/AssigneePickerModal/AssigneePickerModal', () => 'AssigneePickerModal')
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../AllSections/allSectionHelper', () => ({ allGoals: {}, ALL_GOALS_ID: 'ALL_GOALS' }))
jest.mock('../../Workstreams/WorkstreamHelper', () => ({ isWorkstream: () => false, WORKSTREAM_ID_PREFIX: 'ws' }))
jest.mock('../../UIComponents/HOC/withSafePopover', () => Component => props => (
    <Component openPopover={jest.fn()} closePopover={jest.fn()} isOpen={false} {...props} />
))
jest.mock('../../UIComponents/ModalShell/AppPopover', () => ({ __esModule: true, default: ({ children }) => children }))
jest.mock('../../../utils/useWindowSize', () => () => [1200, 800])

import HeaderPickerArrow from './HeaderPickerArrow'
import ProjectLine from './ProjectLine'
import UserLine from './UserLine'
import AllProjectsButton from './AllProjectsLine/AllProjectsButton'

const projects = [
    { id: 'p0', index: 0, name: 'Private life', color: '#5AA0FF' },
    { id: 'p1', index: 1, name: 'Alldone Product', color: '#E969A8' },
]
const person = { uid: 'u1', displayName: 'Dark Side', photoURL: 'https://example.test/u1.png' }

const setState = ({ mode = 'sectionsTop', selectedProjectIndex = 0, tab = 'ROOT_TASKS', isAnonymous = false } = {}) => {
    mockState = {
        selectedProjectIndex,
        loggedUserProjects: projects,
        loggedUser: { sidebarNavigationMode: mode, isAnonymous, realTemplateProjectIds: [] },
        currentUser: { uid: 'u1' },
        selectedSidebarTab: tab,
        smallScreenNavigation: false,
    }
}

const arrows = element => {
    let tree
    act(() => {
        tree = renderer.create(element)
    })
    return tree.root.findAllByType(HeaderPickerArrow).filter(arrow => arrow.children.length > 0).length
}

/**
 * AT-3121: in the "Anna on top" sidebar the project, the person and All projects in the line above
 * a list carry a small arrow wherever a press opens their picker.
 */
describe('HeaderPickerArrow', () => {
    it('follows the name of the open project, which opens the project picker', () => {
        setState()
        expect(arrows(<ProjectLine projectIndex={0} user={person} />)).toBe(1)
    })

    it('stays off a project line that switches to its project (All projects)', () => {
        setState({ selectedProjectIndex: -1 })
        expect(arrows(<ProjectLine projectIndex={0} user={person} />)).toBe(0)
    })

    it('stays off for an anonymous visitor, whose press opens the project screen', () => {
        setState({ isAnonymous: true })
        expect(arrows(<ProjectLine projectIndex={0} user={person} />)).toBe(0)
    })

    it('follows the person wherever the person picker opens', () => {
        setState()
        expect(arrows(<UserLine projectIndex={0} projectId="p0" user={person} />)).toBe(1)
    })

    it.each(['ROOT_NOTES', 'ROOT_CONTACTS', 'ROOT_CHATS'])('stays off the person in %s, which has no picker', tab => {
        setState({ tab })
        expect(arrows(<UserLine projectIndex={0} projectId="p0" user={person} />)).toBe(0)
    })

    it('follows All projects', () => {
        setState({ selectedProjectIndex: -1 })
        expect(arrows(<AllProjectsButton onPress={jest.fn()} />)).toBe(1)
    })

    it.each(['simple', 'advanced'])('is not drawn in the %s sidebar', mode => {
        setState({ mode })
        expect(arrows(<ProjectLine projectIndex={0} user={person} />)).toBe(0)
        expect(arrows(<UserLine projectIndex={0} projectId="p0" user={person} />)).toBe(0)
        expect(arrows(<AllProjectsButton onPress={jest.fn()} />)).toBe(0)
    })
})
