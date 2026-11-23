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
jest.mock('./SectionDivider', () => () => '---')
jest.mock('./SectionItems/TasksBoards', () => () => 'people under tasks')
jest.mock('./SectionItems/GoalsBoards', () => () => 'people under goals')
jest.mock('../../MediaBar/MediaBar', () => () => 'chat media')

import ProjectSectionList from './ProjectSectionList'

const project = { id: 'p1', index: 0, color: '#39CCCC', globalAssistantIds: [] }
const rowsWithMarks = (route, mode, tab = route, { allProjects = false, navItem = null, shared = false } = {}) => {
    mockState = {
        selectedNavItem: navItem,
        selectedSidebarTab: tab,
        route,
        selectedProjectIndex: allProjects ? -1 : 0,
        loggedUser: { sidebarNavigationMode: mode },
    }
    let tree
    act(() => {
        tree = renderer.create(
            allProjects ? (
                <ProjectSectionList projectType="active" inAllProjects />
            ) : (
                <ProjectSectionList projectData={project} projectType="active" isShared={shared} />
            )
        )
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
                '---',
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

    // AT-3121: All projects has the same rows as a project, with the general settings last (the
    // sidebar's Settings item, which the "Anna on top" sidebar leaves out further down).
    it('gives All projects the same rows as a project in the "Anna on top" sidebar, the settings last', () => {
        const allProjects = (route, tab, navItem) =>
            rowsWithMarks(route, 'sectionsTop', tab, { allProjects: true, navItem })
        expect(allProjects('ROOT_WIKI', 'ROOT_WIKI').map(row => row.replace(/ \*$/, ''))).toEqual([
            'section:Tasks',
            'section:Goals',
            'section:Notes',
            'section:Contacts',
            'section:Chats',
            '---',
            'section:Artifacts',
            'section:Wiki',
            'section:Settings',
        ])
        expect(allProjects('ROOT_WIKI', 'ROOT_WIKI').filter(row => row.endsWith('*'))).toEqual(['section:Wiki *'])
        // Marked on every settings screen, which All projects stays selected for.
        for (const navItem of ['SETTINGS_CUSTOMIZATIONS', 'SETTINGS_PROFILE']) {
            expect(allProjects('SettingsView', 'ROOT_TASKS', navItem).filter(row => row.endsWith('*'))).toEqual([
                'section:Settings *',
            ])
        }
        // The advanced sidebar keeps its All projects rows as they were.
        expect(rowsWithMarks('ROOT_TASKS', 'advanced', 'ROOT_TASKS', { allProjects: true })).not.toContain(
            'section:Wiki'
        )
    })

    // AT-3139: a quiet line under Chats sets the main sections apart from Artifacts, Wiki and the
    // settings, in a project and in All projects; where nothing follows Chats there is no line.
    it('draws the divider right below Chats only where further rows follow', () => {
        const below = list => list[list.indexOf('section:Chats') + 1]
        expect(below(rows('ROOT_TASKS', 'advanced'))).toBe('---')
        expect(below(rows('ROOT_TASKS', 'sectionsTop'))).toBe('---')
        expect(below(rowsWithMarks('ROOT_TASKS', 'sectionsTop', 'ROOT_TASKS', { allProjects: true }))).toBe('---')
        expect(rowsWithMarks('ROOT_TASKS', 'advanced', 'ROOT_TASKS', { allProjects: true })).not.toContain('---')
        expect(rowsWithMarks('ROOT_TASKS', 'sectionsTop', 'ROOT_TASKS', { shared: true })).not.toContain('---')
    })

    it('unfolds nothing while Anna is alone on screen', () => {
        mockAnnaAlone = true
        expect(rows('ROOT_TASKS', 'sectionsTop')).toEqual([])
    })
})
