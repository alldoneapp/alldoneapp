import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { useProjectAssistantLine } from './useAssistantLineSwitch'

const mockDispatch = jest.fn()
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
}))
jest.mock('../../../utils/InitialLoad/projectDataLoader', () => ({ PROJECT_DATA_ASSISTANTS: 'assistants' }))
jest.mock('../../../redux/actions', () => ({
    setAssistantLineAssistant: (projectId, assistantId) => ({
        type: 'Set assistant line assistant',
        projectId,
        assistantId,
    }),
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
})

describe('useProjectAssistantLine — no user choice yet', () => {
    it('uses the project’s own assistant and scopes the last comment to the project', () => {
        mockState = buildState({
            loggedUserProjectsMap: {
                ...buildState().loggedUserProjectsMap,
                'p-alldone': { ...alldoneProject, assistantId: 'marty' },
            },
        })
        const project = mockState.loggedUserProjectsMap['p-alldone']

        const { result } = renderHook(useProjectAssistantLine, project)

        expect(result.current.hasAssistantLine).toBe(true)
        expect(result.current.assistantLineProps.assistantIdOverride).toBe('marty')
        expect(result.current.assistantLineProps.projectOverride).toBe(project)
        expect(result.current.assistantLineProps.useAssistantProjectContext).toBe(false)
        expect(result.current.assistantLineProps.useGlobalLatestComment).toBe(false)
        // Nothing was chosen, so `project.assistantId` must keep winning inside
        // getAssistantLineData exactly as it did before AT-2430.
        expect(result.current.assistantLineProps.preferAssistantIdOverride).toBe(false)
    })

    it('inherits the default project’s assistant, and its global conversation, when the project has none', () => {
        const { result } = renderHook(useProjectAssistantLine, alldoneProject)

        expect(result.current.assistantLineProps.assistantIdOverride).toBe('anna')
        expect(result.current.assistantLineProps.useAssistantProjectContext).toBe(true)
        expect(result.current.assistantLineProps.useGlobalLatestComment).toBe(true)
        expect(result.current.assistantLineProps.preferAssistantIdOverride).toBe(false)
    })

    it('offers the project’s assistants plus the default-project entry', () => {
        const { result } = renderHook(useProjectAssistantLine, alldoneProject)
        const { groups, grouped } = result.current.assistantLineProps.assistantSwitch

        expect(grouped).toBe(false)
        expect(groups[0].options.map(option => option.assistantId)).toEqual(['marty', 'derek', 'anna'])
        expect(groups[0].options[2].isDefaultProjectAssistant).toBe(true)
    })

    it('gives the default project a switch over its own assistants, which it never had before', () => {
        const { result } = renderHook(useProjectAssistantLine, defaultProject)
        const { groups } = result.current.assistantLineProps.assistantSwitch

        expect(groups[0].options.map(option => option.assistantId)).toEqual(['anna'])
    })

    it('reports no line for a project that is not loaded', () => {
        expect(renderHook(useProjectAssistantLine, undefined).result.current.hasAssistantLine).toBe(false)
    })
})

describe('useProjectAssistantLine — after choosing an assistant', () => {
    it('records the choice against the project', () => {
        const { result } = renderHook(useProjectAssistantLine, alldoneProject)
        const target = result.current.assistantLineProps.assistantSwitch.groups[0].options[1]

        act(() => result.current.assistantLineProps.assistantSwitch.onSelect(target))

        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'Set assistant line assistant',
            projectId: 'p-alldone',
            assistantId: 'derek',
        })
    })

    it('makes the chosen assistant outrank the project’s configured one', () => {
        mockState = buildState({
            loggedUserProjectsMap: {
                ...buildState().loggedUserProjectsMap,
                'p-alldone': { ...alldoneProject, assistantId: 'marty' },
            },
            assistantLineSelection: { 'p-alldone': 'derek' },
        })

        const { result } = renderHook(useProjectAssistantLine, mockState.loggedUserProjectsMap['p-alldone'])

        expect(result.current.assistantLineProps.assistantIdOverride).toBe('derek')
        // Without this, getAssistantLineData silently falls back to project.assistantId and the
        // choice would look like it had been ignored.
        expect(result.current.assistantLineProps.preferAssistantIdOverride).toBe(true)
        expect(result.current.assistantLineProps.assistantSwitch.activeAssistantId).toBe('derek')
    })

    it('keeps the global conversation when the choice is the default-project entry', () => {
        mockState = buildState({ assistantLineSelection: { 'p-alldone': 'anna' } })

        const { result } = renderHook(useProjectAssistantLine, alldoneProject)

        expect(result.current.assistantLineProps.assistantIdOverride).toBe('anna')
        expect(result.current.assistantLineProps.useAssistantProjectContext).toBe(true)
        expect(result.current.assistantLineProps.useGlobalLatestComment).toBe(true)
    })

    it('ignores a choice that no longer resolves to a real option', () => {
        mockState = buildState({ assistantLineSelection: { 'p-alldone': 'deleted-assistant' } })

        const { result } = renderHook(useProjectAssistantLine, alldoneProject)

        // Falls back rather than blanking the line.
        expect(result.current.assistantLineProps.assistantIdOverride).toBe('anna')
        expect(result.current.assistantLineProps.preferAssistantIdOverride).toBe(false)
    })

    it('ignores another project’s choice', () => {
        mockState = buildState({ assistantLineSelection: { 'p-jtl': 'jtl-marty' } })

        const { result } = renderHook(useProjectAssistantLine, alldoneProject)

        expect(result.current.assistantLineProps.assistantIdOverride).toBe('anna')
    })
})
