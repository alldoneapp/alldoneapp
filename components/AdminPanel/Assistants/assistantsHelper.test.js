import { resolveAssistantForProjectObject, resolveDefaultAssistantForProject } from './assistantsHelper'
import store from '../../../redux/store'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

jest.mock('../../../redux/store', () => ({ getState: jest.fn(), dispatch: jest.fn() }))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({ getProjectById: jest.fn() }))
jest.mock('../../../redux/actions', () => ({ setSelectedNavItem: jest.fn() }))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../AssistantDetailedView/Customizations/ToolsAccess/toolOptions', () => ({ DEFAULT_ALLOWED_TOOLS: [] }))

const setup = ({ projectAssistants = {}, globalAssistants = [], defaultAssistant = {}, project = null }) => {
    store.getState.mockReturnValue({ projectAssistants, globalAssistants, defaultAssistant })
    ProjectHelper.getProjectById.mockReturnValue(project)
}

describe('resolveDefaultAssistantForProject', () => {
    test('prefers a project assistant flagged as default', () => {
        setup({
            projectAssistants: { p1: [{ uid: 'flagged', isDefault: true }, { uid: 'other' }] },
            defaultAssistant: { uid: 'global' },
            project: { id: 'p1', assistantId: 'other', globalAssistantIds: [] },
        })

        expect(resolveDefaultAssistantForProject('p1')).toEqual({ uid: 'flagged', isDefault: true })
    })

    test('falls back to the project configured assistantId', () => {
        setup({
            projectAssistants: { p1: [{ uid: 'configured' }] },
            defaultAssistant: { uid: 'global' },
            project: { id: 'p1', assistantId: 'configured', globalAssistantIds: [] },
        })

        expect(resolveDefaultAssistantForProject('p1')).toEqual({ uid: 'configured' })
    })

    test('falls back to the global default when the project has no assistant', () => {
        setup({
            projectAssistants: { p1: [] },
            defaultAssistant: { uid: 'global' },
            project: { id: 'p1', assistantId: null, globalAssistantIds: [] },
        })

        expect(resolveDefaultAssistantForProject('p1')).toEqual({ uid: 'global' })
    })

    test('returns null when nothing can be resolved', () => {
        setup({
            projectAssistants: {},
            defaultAssistant: {},
            project: { id: 'p1', assistantId: null, globalAssistantIds: [] },
        })

        expect(resolveDefaultAssistantForProject('p1')).toBeNull()
    })
})

describe('resolveAssistantForProjectObject', () => {
    test('keeps a valid assistant explicitly assigned to the task', () => {
        setup({
            projectAssistants: {
                p1: [
                    { uid: 'assigned', displayName: 'Assigned Anna' },
                    { uid: 'project-default', displayName: 'Project Anna', isDefault: true },
                ],
            },
            defaultAssistant: { uid: 'account-default' },
            project: { id: 'p1', assistantId: 'project-default', globalAssistantIds: [] },
        })

        expect(resolveAssistantForProjectObject('p1', 'assigned')).toEqual({
            uid: 'assigned',
            displayName: 'Assigned Anna',
        })
    })

    test('falls back to the project assistant when the assigned assistant was deleted', () => {
        setup({
            projectAssistants: { p1: [{ uid: 'project-default', displayName: 'Project Anna', isDefault: true }] },
            defaultAssistant: { uid: 'account-default' },
            project: { id: 'p1', assistantId: 'project-default', globalAssistantIds: [] },
        })

        expect(resolveAssistantForProjectObject('p1', 'deleted-assistant')).toEqual({
            uid: 'project-default',
            displayName: 'Project Anna',
            isDefault: true,
        })
    })

    test('falls back to the account default when neither assignment nor project assistant exists', () => {
        setup({
            projectAssistants: { p1: [] },
            defaultAssistant: { uid: 'account-default', displayName: 'Account Anna' },
            project: { id: 'p1', assistantId: 'deleted-project-assistant', globalAssistantIds: [] },
        })

        expect(resolveAssistantForProjectObject('p1', 'deleted-assistant')).toEqual({
            uid: 'account-default',
            displayName: 'Account Anna',
        })
    })
})
