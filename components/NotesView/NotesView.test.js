import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import NotesView from './NotesView'
import useRateLimitedProjectReveal from '../../hooks/useRateLimitedProjectReveal'
import useNearViewportMount from '../../hooks/useNearViewportMount'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('./NotesHeader', () => 'NotesHeader')
jest.mock('./NotesByProject', () => 'NotesByProject')
jest.mock('./NotesListSkeleton', () => 'NotesListSkeleton')
jest.mock('./EmptyNotesAllProjects', () => 'EmptyNotesAllProjects')
jest.mock('../HashtagFilters/HashtagFiltersView', () => 'HashtagFiltersView')
jest.mock('../TaskListView/Header/AllProjectsLine/AllProjectsLine', () => 'AllProjectsLine')
jest.mock('../../hooks/useRateLimitedProjectReveal', () => jest.fn())
jest.mock('../../hooks/useNearViewportMount', () => jest.fn())
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
    const markProjectNearViewport = jest.fn()

    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(jest.fn())
        useSelector.mockImplementation(selector => selector(state))
        useRateLimitedProjectReveal.mockReturnValue({
            revealedProjectIds: ['project-1'],
            primaryProjectId: 'project-1',
            complete: false,
            nextProjectId: 'project-2',
            markProjectNearViewport,
        })
        useNearViewportMount.mockReturnValue({ placeholderRef: { current: null }, isNearViewport: false })
    })

    it('keeps the first all-projects render to one NotesByProject block', () => {
        const tree = renderView()
        const projectBlocks = tree.root.findAllByType('NotesByProject')

        expect(projectBlocks).toHaveLength(1)
        expect(projectBlocks[0].props.project.id).toBe('project-1')
        expect(projectBlocks[0].props.firstProject).toBe(true)
        expect(projectBlocks[0].props.showInitialSkeleton).toBe(true)
        expect(projectBlocks[0].props.trackInitialLoad).toBe(true)
        expect(tree.root.findByType('NotesListSkeleton').props).toEqual(
            expect.objectContaining({ rowCount: 3, showProjectHeader: true })
        )
        expect(useRateLimitedProjectReveal).toHaveBeenLastCalledWith({
            projectIds: ['project-1', 'project-2', 'project-3'],
            readyProjectIds: [],
            resetKey: expect.stringContaining('project-1'),
            requireNearViewport: true,
        })
    })

    it('renders only the number of project blocks the hook has revealed', () => {
        useRateLimitedProjectReveal.mockReturnValue({
            revealedProjectIds: ['project-1', 'project-2'],
            primaryProjectId: 'project-1',
            complete: false,
            nextProjectId: 'project-3',
            markProjectNearViewport,
        })

        const tree = renderView()

        expect(tree.root.findAllByType('NotesByProject').map(node => node.props.project.id)).toEqual([
            'project-1',
            'project-2',
        ])
        expect(tree.root.findAllByType('NotesByProject').map(node => node.props.trackInitialLoad)).toEqual([
            true,
            false,
        ])
        const projectBlocks = tree.root.findAllByType('NotesByProject')
        expect(projectBlocks[0].props.setLastEditNoteDate).toBe(projectBlocks[1].props.setLastEditNoteDate)
    })

    it('admits the next project only when its placeholder is near the viewport', () => {
        useNearViewportMount.mockReturnValue({ placeholderRef: { current: null }, isNearViewport: true })

        renderView()

        expect(markProjectNearViewport).toHaveBeenCalledWith('project-2')
    })

    it('does not schedule background project reveals in a selected-project view', () => {
        const selectedProjectState = { ...state, selectedProjectIndex: 0 }
        useSelector.mockImplementation(selector => selector(selectedProjectState))
        useRateLimitedProjectReveal.mockReturnValue({
            revealedProjectIds: [],
            primaryProjectId: null,
            complete: true,
            nextProjectId: null,
            markProjectNearViewport,
        })

        const tree = renderView()

        expect(useRateLimitedProjectReveal).toHaveBeenLastCalledWith(expect.objectContaining({ projectIds: [] }))
        expect(tree.root.findAllByType('NotesByProject')).toHaveLength(1)
        expect(tree.root.findByType('NotesByProject').props.project.id).toBe('project-1')
        expect(tree.root.findByType('NotesByProject').props.trackInitialLoad).toBe(true)
    })
})
