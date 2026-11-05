import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import NotesView from './NotesView'
import useRateLimitedProjectReveal from '../../hooks/useRateLimitedProjectReveal'
import useNearViewportMount from '../../hooks/useNearViewportMount'
import Backend from '../../utils/BackendBridge'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'

jest.mock('../MyDayView/AssistantLine/AllProjectsAssistantLine', () => 'AllProjectsAssistantLine')
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
jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { getLastNoteEditionDateInAllProjects: jest.fn() },
}))
const mockStoreState = { loggedUser: { uid: 'user-1', guideProjectIds: [] } }
jest.mock('../../redux/store', () => ({
    getState: () => mockStoreState,
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

const renderView = async () => {
    let tree
    await act(async () => {
        tree = renderer.create(<NotesView />)
    })
    return tree
}

const renderedProjectIds = tree => tree.root.findAllByType('NotesByProject').map(node => node.props.project.id)
const revealedProjectIdsArgument = () => useRateLimitedProjectReveal.mock.calls.at(-1)[0].projectIds

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
            loadingProjectId: null,
            markProjectNearViewport,
        })
        useNearViewportMount.mockReturnValue({ placeholderRef: { current: null }, isNearViewport: false })
        Backend.getLastNoteEditionDateInAllProjects.mockResolvedValue(0)
    })

    it('places one global assistant line above headers and filters', async () => {
        const tree = await renderView()
        const nodes = tree.root.findAll(node => typeof node.type === 'string').map(node => node.type)
        expect(tree.root.findAllByType('AllProjectsAssistantLine')).toHaveLength(1)
        expect(nodes.indexOf('AllProjectsAssistantLine')).toBeLessThan(nodes.indexOf('NotesHeader'))
        expect(nodes.indexOf('AllProjectsAssistantLine')).toBeLessThan(nodes.indexOf('HashtagFiltersView'))
    })

    it('keeps the first all-projects render to one NotesByProject block', async () => {
        const tree = await renderView()
        const projectBlocks = tree.root.findAllByType('NotesByProject')

        expect(projectBlocks).toHaveLength(1)
        expect(projectBlocks[0].props.project.id).toBe('project-1')
        expect(projectBlocks[0].props.firstProject).toBe(true)
        expect(projectBlocks[0].props.showInitialSkeleton).toBe(true)
        expect(projectBlocks[0].props.trackInitialLoad).toBe(true)
        expect(tree.root.findByType('NotesListSkeleton').props).toEqual(
            expect.objectContaining({ rowCount: 3, showProjectHeader: true })
        )
        expect(useNearViewportMount).toHaveBeenNthCalledWith(1, {
            eager: true,
            enabled: false,
            rootMargin: '0px',
            trackVisibility: true,
        })
        expect(useNearViewportMount).toHaveBeenNthCalledWith(2, {
            eager: false,
            enabled: true,
            rootMargin: '0px',
            trackVisibility: true,
        })
        expect(useRateLimitedProjectReveal).toHaveBeenLastCalledWith({
            projectIds: ['project-1', 'project-2', 'project-3'],
            readyProjectIds: [],
            resetKey: expect.stringContaining('project-1'),
            requireNearViewport: true,
            minIntervalMs: 200,
        })
    })

    it('renders only the number of project blocks the hook has revealed', async () => {
        useRateLimitedProjectReveal.mockReturnValue({
            revealedProjectIds: ['project-1', 'project-2'],
            primaryProjectId: 'project-1',
            complete: false,
            nextProjectId: 'project-3',
            loadingProjectId: null,
            markProjectNearViewport,
        })

        const tree = await renderView()

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

    it('mounts the upcoming notes project behind its viewport ghost while it loads', async () => {
        useRateLimitedProjectReveal.mockReturnValue({
            revealedProjectIds: ['project-1'],
            primaryProjectId: 'project-1',
            complete: false,
            nextProjectId: 'project-2',
            loadingProjectId: 'project-2',
            markProjectNearViewport,
        })

        const tree = await renderView()

        expect(tree.root.findAllByType('NotesByProject').map(node => node.props.project.id)).toEqual([
            'project-1',
            'project-2',
        ])
        expect(tree.root.findAllByType('NotesListSkeleton')).toHaveLength(1)
        expect(tree.root.findAllByType('NotesByProject')[1].props.trackInitialLoad).toBe(false)
    })

    it('admits the next project only when its placeholder is near the viewport', async () => {
        useNearViewportMount.mockReturnValue({ placeholderRef: { current: null }, isNearViewport: true })

        await renderView()

        expect(markProjectNearViewport).toHaveBeenCalledWith('project-2', true)
    })

    it('does not schedule background project reveals in a selected-project view', async () => {
        const selectedProjectState = { ...state, selectedProjectIndex: 0 }
        useSelector.mockImplementation(selector => selector(selectedProjectState))
        useRateLimitedProjectReveal.mockReturnValue({
            revealedProjectIds: [],
            primaryProjectId: null,
            complete: true,
            nextProjectId: null,
            loadingProjectId: null,
            markProjectNearViewport,
        })

        const tree = await renderView()

        expect(useRateLimitedProjectReveal).toHaveBeenLastCalledWith(
            expect.objectContaining({ projectIds: [], minIntervalMs: undefined })
        )
        expect(tree.root.findAllByType('NotesByProject')).toHaveLength(1)
        expect(tree.root.findByType('NotesByProject').props.project.id).toBe('project-1')
        expect(tree.root.findByType('NotesByProject').props.trackInitialLoad).toBe(true)
    })
})

describe('NotesView orders All Projects by the last note edit (AT-2964)', () => {
    const markProjectNearViewport = jest.fn()
    let viewState

    const probeDates = dates => projectId => Promise.resolve(dates[projectId])

    beforeEach(() => {
        jest.clearAllMocks()
        viewState = state
        mockStoreState.loggedUser = { uid: 'user-1', guideProjectIds: [] }
        useDispatch.mockReturnValue(jest.fn())
        useSelector.mockImplementation(selector => selector(viewState))
        useRateLimitedProjectReveal.mockImplementation(({ projectIds }) => ({
            revealedProjectIds: projectIds,
            primaryProjectId: projectIds[0] || null,
            complete: true,
            nextProjectId: null,
            loadingProjectId: null,
            markProjectNearViewport,
        }))
        useNearViewportMount.mockReturnValue({ placeholderRef: { current: null }, isNearViewport: false })
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('puts the project with the most recently edited note first, before any block has loaded', async () => {
        Backend.getLastNoteEditionDateInAllProjects.mockImplementation(
            probeDates({ 'project-1': 100, 'project-2': 0, 'project-3': 300 })
        )

        const tree = await renderView()

        expect(revealedProjectIdsArgument()).toEqual(['project-3', 'project-1', 'project-2'])
        expect(renderedProjectIds(tree)).toEqual(['project-3', 'project-1', 'project-2'])
        expect(tree.root.findAllByType('NotesByProject')[0].props.firstProject).toBe(true)
    })

    it('keeps the default project order among projects without a readable note', async () => {
        Backend.getLastNoteEditionDateInAllProjects.mockImplementation(
            probeDates({ 'project-1': 0, 'project-2': 0, 'project-3': 50 })
        )

        const tree = await renderView()

        expect(renderedProjectIds(tree)).toEqual(['project-3', 'project-1', 'project-2'])
    })

    it('holds the board behind a skeleton and reveals nothing until the order is known', async () => {
        const pending = {}
        Backend.getLastNoteEditionDateInAllProjects.mockImplementation(
            projectId => new Promise(resolve => (pending[projectId] = resolve))
        )

        const tree = await renderView()

        expect(tree.root.findAllByType('NotesByProject')).toHaveLength(0)
        expect(tree.root.findAllByType('NotesListSkeleton')).toHaveLength(1)
        expect(revealedProjectIdsArgument()).toEqual([])

        await act(async () => {
            pending['project-1'](10)
            pending['project-2'](20)
            pending['project-3'](5)
        })

        expect(renderedProjectIds(tree)).toEqual(['project-2', 'project-1', 'project-3'])
    })

    it('probes followed notes on the Followed tab and readable notes on the All tab', async () => {
        Backend.getLastNoteEditionDateInAllProjects.mockResolvedValue(0)
        viewState = { ...state, notesActiveTab: ALL_TAB }
        await renderView()
        expect(Backend.getLastNoteEditionDateInAllProjects).toHaveBeenCalledTimes(3)
        expect(Backend.getLastNoteEditionDateInAllProjects).toHaveBeenCalledWith('project-1', false)

        jest.clearAllMocks()
        Backend.getLastNoteEditionDateInAllProjects.mockResolvedValue(0)
        viewState = { ...state, notesActiveTab: FOLLOWED_TAB }
        await renderView()
        expect(Backend.getLastNoteEditionDateInAllProjects).toHaveBeenCalledWith('project-1', true)
    })

    it('does not list guides', async () => {
        mockStoreState.loggedUser = { uid: 'user-1', guideProjectIds: ['project-2'] }
        viewState = {
            ...state,
            loggedUserProjects: [...projects, { id: 'project-4', name: 'Guide copy', parentTemplateId: 'template-1' }],
        }
        Backend.getLastNoteEditionDateInAllProjects.mockImplementation(
            probeDates({ 'project-1': 1, 'project-2': 999, 'project-3': 2, 'project-4': 999 })
        )

        const tree = await renderView()

        expect(renderedProjectIds(tree)).toEqual(['project-3', 'project-1'])
        expect(Backend.getLastNoteEditionDateInAllProjects).not.toHaveBeenCalledWith('project-2', false)
        expect(Backend.getLastNoteEditionDateInAllProjects).not.toHaveBeenCalledWith('project-4', false)
    })

    it('shows the board in the known order when a probe fails or never answers', async () => {
        jest.useFakeTimers()
        Backend.getLastNoteEditionDateInAllProjects.mockImplementation(projectId => {
            if (projectId === 'project-1') return Promise.resolve(null)
            if (projectId === 'project-2') return new Promise(() => {})
            return Promise.resolve(40)
        })

        const tree = await renderView()
        expect(tree.root.findAllByType('NotesByProject')).toHaveLength(0)

        await act(async () => {
            jest.advanceTimersByTime(2000)
        })

        expect(renderedProjectIds(tree)).toEqual(['project-3', 'project-1', 'project-2'])
    })

    it('re-sorts when a loaded block reports a newer edit, and treats the 1970 sentinel as no note', async () => {
        Backend.getLastNoteEditionDateInAllProjects.mockImplementation(
            probeDates({ 'project-1': 100, 'project-2': 200, 'project-3': 0 })
        )
        const tree = await renderView()
        const { setLastEditNoteDate } = tree.root.findAllByType('NotesByProject')[0].props

        await act(async () => {
            setLastEditNoteDate(projects[2], 500)
        })
        expect(renderedProjectIds(tree)).toEqual(['project-3', 'project-2', 'project-1'])

        await act(async () => {
            setLastEditNoteDate(projects[2], -3600000)
        })
        expect(renderedProjectIds(tree)).toEqual(['project-2', 'project-1', 'project-3'])
    })
})
