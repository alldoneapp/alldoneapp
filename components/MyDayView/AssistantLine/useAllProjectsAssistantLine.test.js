import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { useAllProjectsAssistantLine, useProjectScopeAssistantSwitch } from './useAllProjectsAssistantLine'

const mockDispatch = jest.fn()
const mockUpdateShowAllProjectsByTime = jest.fn()
const mockUseProjectsData = jest.fn()
const mockUseDeferredStartupWork = jest.fn(() => true)
const mockNavigateToHome = jest.fn()
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
jest.mock('../../../hooks/useDeferredStartupWork', () => ({
    __esModule: true,
    default: () => mockUseDeferredStartupWork(),
}))
jest.mock('../../../utils/backends/Users/usersFirestore', () => ({
    updateShowAllProjectsByTime: (...args) => mockUpdateShowAllProjectsByTime(...args),
}))
jest.mock('../../../utils/navigateToHome', () => ({
    __esModule: true,
    default: (...args) => mockNavigateToHome(...args),
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
    mockUseDeferredStartupWork.mockClear()
    mockNavigateToHome.mockClear()
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

        expect(mockUseProjectsData).toHaveBeenCalledWith([DEFAULT_PROJECT_ID, 'p-alldone', 'p-jtl'], 'assistants', {
            enabled: true,
        })
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
        expect(mockNavigateToHome).not.toHaveBeenCalled()
    })

    it('does nothing for a project that is not in the store', () => {
        const { result } = renderHook(useAllProjectsAssistantLine)

        act(() => result.current.onSelect({ projectId: 'gone', assistantId: 'x' }))

        expect(mockDispatch).not.toHaveBeenCalled()
    })
})

// AT-3093: the name in a project's assistant line opens the same popup as on All Projects.
describe('useProjectScopeAssistantSwitch', () => {
    const jtlAssistant = { uid: 'jtl-assistant', displayName: 'JTL Assistant' }
    const option = (projectId, assistantId, extra = {}) => ({
        key: `${projectId}:${assistantId}`,
        projectId,
        assistantId,
        ...extra,
    })
    const buildProjectSwitch = (overrides = {}) => ({
        scope: 'project',
        // What useProjectAssistantLine offers inside JTL: its own assistant and the default one.
        groups: [
            {
                projectId: 'p-jtl',
                projectName: 'JTL',
                isDefaultProject: false,
                options: [
                    option('p-jtl', 'jtl-assistant'),
                    option('p-jtl', 'anna', { isDefaultProjectAssistant: true }),
                ],
            },
        ],
        grouped: false,
        activeProjectId: 'p-jtl',
        activeAssistantId: 'jtl-assistant',
        onSelect: jest.fn(),
        ...overrides,
    })

    beforeEach(() => {
        mockState = buildState({
            projectAssistants: {
                [DEFAULT_PROJECT_ID]: [anna],
                'p-alldone': [marty, derek],
                'p-jtl': [jtlAssistant],
            },
        })
    })

    it('lists every project, the current one first with its in-place options', () => {
        const projectSwitch = buildProjectSwitch()
        const { result } = renderHook(useProjectScopeAssistantSwitch, projectSwitch)

        expect(result.current.grouped).toBe(true)
        expect(result.current.groups.map(group => group.projectId)).toEqual(['p-jtl', DEFAULT_PROJECT_ID, 'p-alldone'])
        expect(result.current.groups[0]).toBe(projectSwitch.groups[0])
        // Which row is live is unchanged: this project's assistant, in this project.
        expect(result.current.activeProjectId).toBe('p-jtl')
        expect(result.current.activeAssistantId).toBe('jtl-assistant')
    })

    it('asks for the assistants of every active project', () => {
        renderHook(useProjectScopeAssistantSwitch, buildProjectSwitch())

        expect(mockUseProjectsData).toHaveBeenCalledWith([DEFAULT_PROJECT_ID, 'p-alldone', 'p-jtl'], 'assistants', {
            enabled: true,
        })
    })

    it('switches in place for a choice in the current project, without touching the project settings', () => {
        const projectSwitch = buildProjectSwitch()
        const { result } = renderHook(useProjectScopeAssistantSwitch, projectSwitch)
        const defaultEntry = result.current.groups[0].options[1]

        act(() => result.current.onSelect(defaultEntry))

        expect(projectSwitch.onSelect).toHaveBeenCalledWith(defaultEntry)
        // No navigation, no user write: only the session-only line selection the project hook makes.
        expect(mockDispatch).not.toHaveBeenCalled()
        expect(mockUpdateShowAllProjectsByTime).not.toHaveBeenCalled()
    })

    it('moves to the other project with the assistant active, as on All Projects', () => {
        const projectSwitch = buildProjectSwitch()
        const { result } = renderHook(useProjectScopeAssistantSwitch, projectSwitch)
        const target = result.current.groups
            .find(group => group.projectId === 'p-alldone')
            .options.find(item => item.assistantId === 'derek')

        act(() => result.current.onSelect(target))

        expect(projectSwitch.onSelect).not.toHaveBeenCalled()
        const dispatched = mockDispatch.mock.calls.flatMap(call => (Array.isArray(call[0]) ? call[0] : [call[0]]))
        expect(dispatched).toContainEqual({
            type: 'Set assistant line assistant',
            projectId: 'p-alldone',
            assistantId: 'derek',
        })
        expect(dispatched).toContainEqual({ type: 'Switch project', index: 1 })
        // The JTL line's own choice is left alone.
        expect(dispatched).not.toContainEqual(expect.objectContaining({ projectId: 'p-jtl' }))
    })

    // AT-3093 follow-up: the default project's default assistant is the All Projects line's own
    // assistant, so choosing it goes back to All Projects instead of opening the default project.
    const annaInDefaultGroup = result =>
        result.current.groups
            .find(group => group.projectId === DEFAULT_PROJECT_ID)
            .options.find(item => item.assistantId === 'anna')

    it('returns to All Projects for the default project’s default assistant, not to the default project', () => {
        const projectSwitch = buildProjectSwitch()
        const { result } = renderHook(useProjectScopeAssistantSwitch, projectSwitch)

        act(() => result.current.onSelect(annaInDefaultGroup(result)))

        expect(mockNavigateToHome).toHaveBeenCalledTimes(1)
        expect(mockNavigateToHome).toHaveBeenCalledWith(mockDispatch)
        expect(projectSwitch.onSelect).not.toHaveBeenCalled()
        // Nothing of the switch-to-project path runs: no project switch, no line selection,
        // no write to the user document.
        const dispatched = mockDispatch.mock.calls.flatMap(call => (Array.isArray(call[0]) ? call[0] : [call[0]]))
        expect(dispatched).not.toContainEqual(expect.objectContaining({ type: 'Switch project' }))
        expect(dispatched).not.toContainEqual(expect.objectContaining({ type: 'Set assistant line assistant' }))
        expect(mockUpdateShowAllProjectsByTime).not.toHaveBeenCalled()
    })

    it('hides the sidebar on small screens when returning to All Projects, as the project switch does', () => {
        mockState.smallScreenNavigation = true
        const { result } = renderHook(useProjectScopeAssistantSwitch, buildProjectSwitch())

        act(() => result.current.onSelect(annaInDefaultGroup(result)))

        expect(mockNavigateToHome).toHaveBeenCalledTimes(1)
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'Hide web sidebar' })
    })

    it('keeps the in-place “From your default project” entry in place', () => {
        const projectSwitch = buildProjectSwitch()
        const { result } = renderHook(useProjectScopeAssistantSwitch, projectSwitch)
        const inPlaceEntry = result.current.groups[0].options.find(item => item.isDefaultProjectAssistant)

        act(() => result.current.onSelect(inPlaceEntry))

        expect(projectSwitch.onSelect).toHaveBeenCalledWith(inPlaceEntry)
        expect(mockNavigateToHome).not.toHaveBeenCalled()
    })

    it('does not send an ordinary cross-project choice to All Projects', () => {
        const { result } = renderHook(useProjectScopeAssistantSwitch, buildProjectSwitch())
        const derekOption = result.current.groups
            .find(group => group.projectId === 'p-alldone')
            .options.find(item => item.assistantId === 'derek')

        act(() => result.current.onSelect(derekOption))

        expect(mockNavigateToHome).not.toHaveBeenCalled()
    })

    describe('inside the default project', () => {
        const judy = { uid: 'judy', displayName: 'Judy Job' }
        const buildDefaultProjectSwitch = () =>
            buildProjectSwitch({
                groups: [
                    {
                        projectId: DEFAULT_PROJECT_ID,
                        projectName: 'Personal',
                        isDefaultProject: true,
                        options: [option(DEFAULT_PROJECT_ID, 'anna'), option(DEFAULT_PROJECT_ID, 'judy')],
                    },
                ],
                activeProjectId: DEFAULT_PROJECT_ID,
                activeAssistantId: 'judy',
            })

        beforeEach(() => {
            mockState.projectAssistants[DEFAULT_PROJECT_ID] = [anna, judy]
        })

        it('returns to All Projects for the default assistant', () => {
            const projectSwitch = buildDefaultProjectSwitch()
            const { result } = renderHook(useProjectScopeAssistantSwitch, projectSwitch)

            act(() => result.current.onSelect(result.current.groups[0].options[0]))

            expect(mockNavigateToHome).toHaveBeenCalledTimes(1)
            expect(projectSwitch.onSelect).not.toHaveBeenCalled()
        })

        it('switches its other assistants in place', () => {
            const projectSwitch = buildDefaultProjectSwitch()
            const { result } = renderHook(useProjectScopeAssistantSwitch, projectSwitch)
            const judyOption = result.current.groups[0].options[1]

            act(() => result.current.onSelect(judyOption))

            expect(projectSwitch.onSelect).toHaveBeenCalledWith(judyOption)
            expect(mockNavigateToHome).not.toHaveBeenCalled()
        })
    })

    it('reads the default assistant from the store rather than assuming one', () => {
        // The default project's resolved default assistant is Judy here, so Anna (also in that
        // project) is an ordinary choice that opens the default project.
        const judy = { uid: 'judy', displayName: 'Judy Job' }
        mockState.defaultAssistant = judy
        mockState.projectAssistants[DEFAULT_PROJECT_ID] = [anna, judy]
        const { result } = renderHook(useProjectScopeAssistantSwitch, buildProjectSwitch())
        const defaultGroup = result.current.groups.find(group => group.projectId === DEFAULT_PROJECT_ID)

        act(() => result.current.onSelect(defaultGroup.options.find(item => item.assistantId === 'anna')))
        expect(mockNavigateToHome).not.toHaveBeenCalled()
        const dispatched = mockDispatch.mock.calls.flatMap(call => (Array.isArray(call[0]) ? call[0] : [call[0]]))
        expect(dispatched).toContainEqual({ type: 'Switch project', index: 0 })

        act(() => result.current.onSelect(defaultGroup.options.find(item => item.assistantId === 'judy')))
        expect(mockNavigateToHome).toHaveBeenCalledTimes(1)
    })

    it('leaves the home line’s switch, or no switch, untouched and loads nothing for it', () => {
        const homeSwitch = { groups: [], grouped: true, activeProjectId: DEFAULT_PROJECT_ID, onSelect: jest.fn() }

        expect(renderHook(useProjectScopeAssistantSwitch, homeSwitch).result.current).toBe(homeSwitch)
        expect(renderHook(useProjectScopeAssistantSwitch, null).result.current).toBeNull()
        expect(mockUseProjectsData).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), { enabled: true })
    })
})
