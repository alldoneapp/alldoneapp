import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import NotesView, { INITIAL_PROJECTS_TO_RENDER, PROJECT_RENDER_BATCH_SIZE } from './NotesView'
import useProgressiveReveal from '../../hooks/useProgressiveReveal'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('./NotesHeader', () => 'NotesHeader')
jest.mock('./NotesByProject', () => 'NotesByProject')
jest.mock('./EmptyNotesAllProjects', () => 'EmptyNotesAllProjects')
jest.mock('../HashtagFilters/HashtagFiltersView', () => 'HashtagFiltersView')
jest.mock('../TaskListView/Header/AllProjectsLine/AllProjectsLine', () => 'AllProjectsLine')
jest.mock('../../hooks/useProgressiveReveal', () => jest.fn())
jest.mock('../../redux/store', () => ({
    getState: () => ({ loggedUser: { uid: 'user-1' } }),
}))
jest.mock('../../redux/actions', () => ({
    resetLoadingData: jest.fn(() => ({ type: 'Reset loading data' })),
    setNavigationRoute: jest.fn(() => ({ type: 'Set navigation route' })),
    resetNotesAmounts: jest.fn(() => ({ type: 'Reset notes amounts' })),
}))
jest.mock('../../URLSystem/Notes/URLsNotes', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_ALL_PROJECTS_NOTES_ALL: 'all-notes',
    URL_ALL_PROJECTS_NOTES_FOLLOWED: 'followed-notes',
    URL_PROJECT_USER_NOTES_ALL: 'project-notes',
    URL_PROJECT_USER_NOTES_FOLLOWED: 'project-followed-notes',
}))
jest.mock('./NotesHelper', () => ({ calcNotesAmount: jest.fn(() => 1) }))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        getActiveProjects2: projects => projects,
        getGuideProjects: () => [],
        sortProjects: projects => projects,
    },
    checkIfSelectedAllProjects: index => index === -1,
    checkIfSelectedProject: index => index >= 0,
}))

const projects = [
    { id: 'project-1', name: 'One' },
    { id: 'project-2', name: 'Two' },
    { id: 'project-3', name: 'Three' },
]

const state = {
    notesActiveTab: 'all',
    loggedUserProjects: projects,
    loggedUser: {
        archivedProjectIds: [],
        templateProjectIds: [],
    },
    smallScreenNavigation: false,
    isMiddleScreen: false,
    notesAmounts: [],
    selectedProjectIndex: -1,
    selectedSidebarTab: 'notes',
    currentUser: { uid: 'user-1' },
    noteOwnerFilters: [],
}

const renderView = () => {
    let tree
    act(() => {
        tree = renderer.create(<NotesView />)
    })
    return tree
}

describe('NotesView progressive project mounting', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(jest.fn())
        useSelector.mockImplementation(selector => selector(state))
    })

    it('keeps the first all-projects render to one NotesByProject block', () => {
        useProgressiveReveal.mockReturnValue({ visibleAmount: 1, complete: false })

        const tree = renderView()
        const projectBlocks = tree.root.findAllByType('NotesByProject')

        expect(projectBlocks).toHaveLength(1)
        expect(projectBlocks[0].props.project.id).toBe('project-1')
        expect(projectBlocks[0].props.firstProject).toBe(true)
        expect(useProgressiveReveal).toHaveBeenLastCalledWith(3, {
            initialAmount: INITIAL_PROJECTS_TO_RENDER,
            batchSize: PROJECT_RENDER_BATCH_SIZE,
            resetKey: expect.stringContaining('project-1'),
        })
    })

    it('renders only the number of project blocks the hook has revealed', () => {
        useProgressiveReveal.mockReturnValue({ visibleAmount: 2, complete: false })

        const tree = renderView()

        expect(tree.root.findAllByType('NotesByProject').map(node => node.props.project.id)).toEqual([
            'project-1',
            'project-2',
        ])
    })

    it('does not schedule background project reveals in a selected-project view', () => {
        const selectedProjectState = { ...state, selectedProjectIndex: 0 }
        useSelector.mockImplementation(selector => selector(selectedProjectState))
        useProgressiveReveal.mockReturnValue({ visibleAmount: 0, complete: true })

        const tree = renderView()

        expect(useProgressiveReveal).toHaveBeenLastCalledWith(0, expect.any(Object))
        expect(tree.root.findAllByType('NotesByProject')).toHaveLength(1)
        expect(tree.root.findByType('NotesByProject').props.project.id).toBe('project-1')
    })
})
