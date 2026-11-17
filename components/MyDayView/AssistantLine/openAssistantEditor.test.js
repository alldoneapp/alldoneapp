import openAssistantEditor, { getAssistantEditorProjectId } from './openAssistantEditor'
import NavigationService from '../../../utils/NavigationService'

let mockState
const mockDispatch = jest.fn()
const mockProjects = {}

jest.mock('../../../redux/store', () => ({
    getState: () => mockState,
    dispatch: action => mockDispatch(action),
}))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../redux/actions', () => ({
    setSelectedNavItem: navItem => ({ type: 'setSelectedNavItem', navItem }),
}))
jest.mock('../../../utils/TabNavigationConstants', () => ({
    DV_TAB_ASSISTANT_CUSTOMIZATIONS: 'customizations',
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: projectId => mockProjects[projectId] || null,
}))
jest.mock('../../AdminPanel/Assistants/assistantsHelper', () => ({
    GLOBAL_PROJECT_ID: 'globalProject',
    isGlobalAssistant: assistantId => mockState.globalAssistants.some(item => item.uid === assistantId),
}))

const setProjects = projects => {
    Object.keys(mockProjects).forEach(key => delete mockProjects[key])
    projects.forEach(project => {
        mockProjects[project.id] = project
    })
    mockState.loggedUserProjects = projects
}

// AT-3069: the assistant line's edit pencil opens the line's assistant's settings.
describe('openAssistantEditor', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = {
            loggedUser: { uid: 'user-1', defaultProjectId: 'default', isAnonymous: false },
            administratorUser: { uid: 'admin' },
            globalAssistants: [{ uid: 'anna' }],
            showFloatPopup: 0,
        }
        setProjects([
            { id: 'default', globalAssistantIds: ['anna'] },
            { id: 'line', globalAssistantIds: [] },
            { id: 'other', globalAssistantIds: ['anna'] },
        ])
    })

    it('opens a project assistant in its own project, on the Customizations tab', () => {
        openAssistantEditor('ricky', 'line')

        expect(NavigationService.navigate).toHaveBeenCalledWith('AssistantDetailedView', {
            assistantId: 'ricky',
            projectId: 'line',
        })
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'setSelectedNavItem', navItem: 'customizations' })
    })

    it('opens a global assistant in the global project only for the administrator', () => {
        mockState.loggedUser.uid = 'admin'
        expect(getAssistantEditorProjectId('anna', 'line')).toBe('globalProject')
    })

    it('opens a global assistant read-only in a project that carries it for everybody else', () => {
        // The line's project first, …
        mockProjects.line.globalAssistantIds = ['anna']
        expect(getAssistantEditorProjectId('anna', 'line')).toBe('line')
        // … then the default project, …
        mockProjects.line.globalAssistantIds = []
        expect(getAssistantEditorProjectId('anna', 'line')).toBe('default')
        // … then any other project.
        mockProjects.default.globalAssistantIds = []
        expect(getAssistantEditorProjectId('anna', 'line')).toBe('other')
        // Nowhere: the line's project, never the global one.
        mockProjects.other.globalAssistantIds = []
        expect(getAssistantEditorProjectId('anna', 'line')).toBe('line')
    })

    it('does nothing while a float popup is open', () => {
        mockState.showFloatPopup = 1
        openAssistantEditor('ricky', 'line')

        expect(NavigationService.navigate).not.toHaveBeenCalled()
        expect(mockDispatch).not.toHaveBeenCalled()
    })
})
