import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { useAllProjectsAssistantLine } from './useAllProjectsAssistantLine'

const mockDispatch = jest.fn()
const mockUpdateShowAllProjectsByTime = jest.fn()
const mockUseProjectsData = jest.fn()
let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => mockDispatch,
    shallowEqual: () => false,
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../hooks/useProjectData', () => ({
    __esModule: true,
    default: () => {},
    useProjectsData: (...args) => mockUseProjectsData(...args),
}))
jest.mock('../../../utils/backends/Users/usersFirestore', () => ({
    updateShowAllProjectsByTime: (...args) => mockUpdateShowAllProjectsByTime(...args),
}))
jest.mock('../../Feeds/Utils/FeedsConstants', () => ({ FOLLOWED_TAB: 'FOLLOWED_TAB' }))
jest.mock('../../../utils/TabNavigationConstants', () => ({ DV_TAB_ROOT_TASKS: 'DV_TAB_ROOT_TASKS' }))
jest.mock('../../../utils/InitialLoad/projectDataLoader', () => ({ PROJECT_DATA_ASSISTANTS: 'assistants' }))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        // The real implementations, minus the firestore import chain this file would otherwise pull in.
        getActiveProjects2: (projects, user) =>
            projects.filter(
                project =>
                    user.projectIds.includes(project.id) &&
                    !user.archivedProjectIds.includes(project.id) &&
                    !user.templateProjectIds.includes(project.id) &&
                    !user.guideProjectIds.includes(project.id)
            ),
        sortProjects: projects => projects,
        getTypeOfProject: () => 'PROJECT_TYPE_ACTIVE',
    },
}))
jest.mock('../../../redux/actions', () => ({
    hideWebSideBar: () => ({ type: 'Hide web sidebar' }),
    setAssistantLineAssistant: (projectId, assistantId) => ({
        type: 'Set assistant line assistant',
        projectId,
        assistantId,
    }),
    setSelectedSidebarTab: tab => ({ type: 'Set selected sidebar tab', tab }),
    setSelectedTypeOfProject: type => ({ type: 'Set selected type of project', projectType: type }),
    setTaskViewToggleIndex: index => ({ type: 'Set task view toggle index', index }),
    setTaskViewToggleSection: section => ({ type: 'Set task view toggle section', section }),
    storeCurrentUser: user => ({ type: 'Store current user', user }),
    storeLoggedUser: user => ({ type: 'Store logged user', user }),
    switchProject: index => ({ type: 'Switch project', index }),
    switchShortcutProject: index => ({ type: 'Switch shortcut project', index }),
    updateFeedActiveTab: tab => ({ type: 'Update feed active tab', tab }),
}))

const DEFAULT_PROJECT_ID = 'default-project'
const anna = { uid: 'anna', displayName: 'Anna Alldone' }
const marty = { uid: 'marty', displayName: 'Marty Marketing' }
const derek = { uid: 'derek', displayName: 'Derek Designer' }
const jtlMarty = { uid: 'jtl-marty', displayName: 'Marty Marketing' }

const defaultProject = { id: DEFAULT_PROJECT_ID, name: 'Personal', index: 0, globalAssistantIds: [] }
const alldoneProject = { id: 'p-alldone', name: 'Alldone Product', index: 1, globalAssistantIds: [] }
const jtlProject = { id: 'p-jtl', name: 'JTL', index: 2, globalAssistantIds: [] }

const buildState = (overrides = {}) => ({
    loggedUser: {
        uid: 'user-1',
        defaultProjectId: DEFAULT_PROJECT_ID,
        projectIds: [DEFAULT_PROJECT_ID, 'p-alldone', 'p-jtl'],
        archivedProjectIds: [],
        templateProjectIds: [],
        guideProjectIds: [],
    },
    loggedUserProjectsMap: {
        [DEFAULT_PROJECT_ID]: defaultProject,
        'p-alldone': alldoneProject,
        'p-jtl': jtlProject,
    },
    defaultAssistant: anna,
    globalAssistants: [],
    projectAssistants: {
        [DEFAULT_PROJECT_ID]: [anna],
        'p-alldone': [marty, derek],
        'p-jtl': [jtlMarty],
    },
    assistantLineSelection: {},
    smallScreenNavigation: false,
    ...overrides,
})

const renderHook = (hook, ...args) => {
    const result = {}
    const Probe = () => {
        result.current = hook(...args)
        return null
    }
    let tree
    act(() => {
        tree = renderer.create(<Probe />)
    })
    return {
        result,
        rerender: () =>
            act(() => {
                tree.update(<Probe key={Math.random()} />)
            }),
    }
}

beforeEach(() => {
    mockState = buildState()
    mockDispatch.mockClear()
    mockUpdateShowAllProjectsByTime.mockClear()
    mockUseProjectsData.mockClear()
})

describe('useAllProjectsAssistantLine', () => {
    it('groups every active project’s assistants, default project first', () => {
        const { result } = renderHook(useAllProjectsAssistantLine)

        expect(result.current.grouped).toBe(true)
        expect(result.current.groups.map(group => group.projectId)).toEqual([DEFAULT_PROJECT_ID, 'p-alldone', 'p-jtl'])
        expect(result.current.activeAssistantId).toBe('anna')
    })

    it('asks for the assistants of every active project, since the option count decides the control', () => {
        renderHook(useAllProjectsAssistantLine)

        expect(mockUseProjectsData).toHaveBeenCalledWith([DEFAULT_PROJECT_ID, 'p-alldone', 'p-jtl'], 'assistants')
    })

    it('leaves archived, template and guide projects out', () => {
        mockState = buildState()
        mockState.loggedUser.guideProjectIds = ['p-jtl']

        const { result } = renderHook(useAllProjectsAssistantLine)

        expect(result.current.groups.map(group => group.projectId)).toEqual([DEFAULT_PROJECT_ID, 'p-alldone'])
    })

    it('switches to the assistant’s project with it active', () => {
        const { result } = renderHook(useAllProjectsAssistantLine)
        const target = result.current.groups
            .find(group => group.projectId === 'p-jtl')
            .options.find(option => option.assistantId === 'jtl-marty')

        act(() => result.current.onSelect(target))

        const dispatched = mockDispatch.mock.calls.flatMap(call => (Array.isArray(call[0]) ? call[0] : [call[0]]))
        expect(dispatched).toContainEqual({
            type: 'Set assistant line assistant',
            projectId: 'p-jtl',
            assistantId: 'jtl-marty',
        })
        expect(dispatched).toContainEqual({ type: 'Switch project', index: 2 })
        // Leaving MyDay is part of arriving in a project — otherwise the user switches project
        // and is still looking at the all-projects board.
        expect(dispatched).toContainEqual(
            expect.objectContaining({
                type: 'Store logged user',
                user: expect.objectContaining({ showAllProjectsByTime: false }),
            })
        )
        expect(mockUpdateShowAllProjectsByTime).toHaveBeenCalledWith('user-1', false)
    })

    it('stays on the home page when the assistant already answering is selected', () => {
        const { result } = renderHook(useAllProjectsAssistantLine)
        const annaOption = result.current.groups
            .find(group => group.projectId === DEFAULT_PROJECT_ID)
            .options.find(option => option.assistantId === 'anna')

        act(() => result.current.onSelect(annaOption))

        expect(mockDispatch).not.toHaveBeenCalled()
        expect(mockUpdateShowAllProjectsByTime).not.toHaveBeenCalled()
    })

    it('does nothing for a project that is not in the store', () => {
        const { result } = renderHook(useAllProjectsAssistantLine)

        act(() => result.current.onSelect({ projectId: 'gone', assistantId: 'x' }))

        expect(mockDispatch).not.toHaveBeenCalled()
    })
})
