import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockState
jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => jest.fn(),
}))
jest.mock('../../../redux/store', () => ({ getState: () => mockState }))
jest.mock('../../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../../../redux/actions', () => ({}))
jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: { navigate: jest.fn() } }))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfProjectIsGuide: () => false },
    checkIfSelectedAllProjects: index => index === -1,
    checkIfSelectedProject: index => index >= 0,
}))
jest.mock('../../TaskListView/Utils/TasksHelper', () => ({ setURLOnChangeToggleOption: jest.fn() }))
jest.mock('../../GoalsView/GoalsHelper', () => ({ GOALS_OPEN_TAB_INDEX: 0 }))
jest.mock('../openSidebarChats', () => ({ getSidebarChatsActions: () => [] }))
let mockAnnaAlone = false
jest.mock('../SectionsTop/useAnnaAloneSidebar', () => () => ({ annaAlone: mockAnnaAlone, leaveChat: jest.fn() }))
jest.mock(
    './SectionItemLayoutHeader',
    () =>
        ({ text, selected }) =>
            `section:${text}${selected ? ' *' : ''}`
)
jest.mock('./SectionItems/TasksBoards', () => () => 'people under tasks')
jest.mock('./SectionItems/GoalsBoards', () => () => 'people under goals')
jest.mock('../../MediaBar/MediaBar', () => () => 'chat media')

import ProjectSectionList from './ProjectSectionList'

const project = { id: 'p1', index: 0, color: '#39CCCC', globalAssistantIds: [] }
const rowsWithMarks = (route, mode, tab = route) => {
    mockState = {
        selectedNavItem: null,
        selectedSidebarTab: tab,
        route,
        selectedProjectIndex: 0,
        loggedUser: { sidebarNavigationMode: mode },
    }
    let tree
    act(() => {
        tree = renderer.create(<ProjectSectionList projectData={project} projectType="active" isShared={false} />)
    })
    const flatten = node => (typeof node === 'string' ? [node] : (node?.children || []).flatMap(flatten))
    return flatten(tree.toJSON())
}
const rows = (tab, mode) => rowsWithMarks(tab, mode).map(row => row.replace(/ \*$/, ''))

beforeEach(() => {
    mockAnnaAlone = false
})

describe('ProjectSectionList', () => {
    it.each([
        ['ROOT_TASKS', 'people under tasks'],
        ['ROOT_GOALS', 'people under goals'],
        ['ROOT_CHATS', 'chat media'],
    ])('in the advanced sidebar unfolds what belongs to %s below its row', (tab, below) => {
        expect(rows(tab, 'advanced')).toContain(below)
    })

    // AT-3121: "Anna on top" stops at the sections; people are picked in the project line on the right.
    it.each(['ROOT_TASKS', 'ROOT_GOALS', 'ROOT_CHATS'])(
        'in the "Anna on top" sidebar stops at the sections (%s)',
        tab => {
            expect(rows(tab, 'sectionsTop')).toEqual([
                'section:Tasks',
                'section:Goals',
                'section:Notes',
                'section:Contacts',
                'section:Chats',
                'section:Artifacts',
                'section:Wiki',
                'section:Project Settings',
            ])
        }
    )

    it('ends with the project settings, marked alone on their screen, in the "Anna on top" sidebar only', () => {
        const marked = rowsWithMarks('ProjectDetailedView', 'sectionsTop', 'ROOT_TASKS')
        expect(marked[marked.length - 1]).toBe('section:Project Settings *')
        expect(marked.filter(row => row.endsWith('*'))).toHaveLength(1)
        expect(rows('ROOT_TASKS', 'advanced')).not.toContain('section:Project Settings')
    })

    it('unfolds nothing while Anna is alone on screen', () => {
        mockAnnaAlone = true
        expect(rows('ROOT_TASKS', 'sectionsTop')).toEqual([])
    })
})
