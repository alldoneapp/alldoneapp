import { getOptionsPresentationData } from './helper'

jest.mock('../../../../functions/Utils/parseTextUtils', () => ({
    shrinkTagText: text => text,
}))

jest.mock('../../../../utils/assistantHelper', () => ({
    generateTaskFromPreConfig: jest.fn(),
}))

jest.mock('../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal', () => ({
    TASK_TYPE_PROMPT: 'prompt',
    TASK_TYPE_IFRAME: 'iframe',
}))

jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistant: jest.fn(),
    getAssistantInProject: jest.fn(),
    getAssistantProjectId: jest.fn(),
}))

jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: jest.fn(),
}))

jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: {},
    RECURRENCE_NEVER: 'never',
}))

jest.mock('../../../../redux/store', () => ({
    dispatch: jest.fn(),
}))

jest.mock('../../../../redux/actions', () => ({
    setPreConfigTaskExecuting: jest.fn(),
}))

const tasks = [
    { id: 'task-1', name: 'First task', type: 'prompt', variables: [], recurrence: 'never' },
    { id: 'task-2', name: 'Second task', type: 'prompt', variables: [], recurrence: 'never' },
]

describe('getOptionsPresentationData', () => {
    it('keeps overflow detectable while all options are expanded inline', () => {
        const collapsed = getOptionsPresentationData({ id: 'project-1' }, 'assistant-1', tasks, 1)
        expect(collapsed.optionsLikeButtons.map(option => option.id)).toEqual(['task-1'])
        expect(collapsed.hasAdditionalOptions).toBe(true)

        const expanded = getOptionsPresentationData({ id: 'project-1' }, 'assistant-1', tasks, 1, true)
        expect(expanded.optionsLikeButtons.map(option => option.id)).toEqual(['task-1', 'task-2'])
        expect(expanded.hasAdditionalOptions).toBe(true)
        expect(expanded.showSubmenu).toBe(false)
    })

    it('does not offer expansion when every option fits', () => {
        const presentation = getOptionsPresentationData({ id: 'project-1' }, 'assistant-1', tasks, 2)
        expect(presentation.hasAdditionalOptions).toBe(false)
    })
})
