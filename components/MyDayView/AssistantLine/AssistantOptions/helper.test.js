import { getCollapsedQuickActionCount, getCommentData, getOptionsPresentationData } from './helper'
import { getAssistant, getAssistantInProject } from '../../../AdminPanel/Assistants/assistantsHelper'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'

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

    it('excludes scheduled tasks from both collapsed and expanded quick actions', () => {
        const tasksWithSchedules = [
            tasks[0],
            { id: 'scheduled-task', name: 'Daily task', type: 'prompt', recurrence: 'daily' },
            {
                id: 'scheduled-for-member',
                name: 'Member task',
                type: 'prompt',
                recurrence: 'never',
                recurrenceByUser: { 'user-1': 'never', 'user-2': 'weekly' },
            },
            tasks[1],
        ]

        const collapsed = getOptionsPresentationData({ id: 'project-1' }, 'assistant-1', tasksWithSchedules, 1)
        expect(collapsed.optionsLikeButtons.map(option => option.id)).toEqual(['task-1'])
        expect(collapsed.optionsInModal.map(option => option.id)).toEqual(['task-2'])
        expect(collapsed.hasAdditionalOptions).toBe(true)

        const expanded = getOptionsPresentationData({ id: 'project-1' }, 'assistant-1', tasksWithSchedules, 1, true)
        expect(expanded.optionsLikeButtons.map(option => option.id)).toEqual(['task-1', 'task-2'])
        expect(expanded.optionsInModal).toEqual([])
    })
})

describe('getCollapsedQuickActionCount', () => {
    it('shows every task when they fit without a More button', () => {
        expect(
            getCollapsedQuickActionCount({
                containerWidth: 400,
                searchWidth: 80,
                moreWidth: 70,
                optionWidths: [100, 110, 90],
            })
        ).toBe(3)
    })

    it('reserves space for More whenever some tasks are hidden', () => {
        expect(
            getCollapsedQuickActionCount({
                containerWidth: 350,
                searchWidth: 80,
                moreWidth: 70,
                optionWidths: [100, 110, 90],
            })
        ).toBe(1)
    })

    it('keeps tasks hidden until every width needed for an exact fit is measured', () => {
        expect(
            getCollapsedQuickActionCount({
                containerWidth: 350,
                searchWidth: 80,
                moreWidth: 70,
                optionWidths: [100, 0],
            })
        ).toBe(0)
        expect(
            getCollapsedQuickActionCount({
                containerWidth: 350,
                searchWidth: 80,
                moreWidth: 0,
                optionWidths: [200, 200],
            })
        ).toBe(0)
    })
})

describe('getCommentData', () => {
    const displayed = { id: 'displayed-project', assistantId: 'displayed-assistant' }
    const threadProject = { id: 'thread-project', assistantId: 'thread-assistant' }
    const pointer = {
        projectId: 'thread-project',
        objectType: 'tasks',
        objectId: 'task-1',
        creatorType: 'user',
        creatorId: 'me',
    }

    beforeEach(() => {
        ProjectHelper.getProjectById.mockReset()
        getAssistant.mockReset()
        getAssistantInProject.mockReset()
        TasksHelper.getUserInProject = jest.fn(() => null)
    })

    it('never renders a pointer under the displayed project while the thread project’s people are still loading', () => {
        // The preview subscribes to chatComments/<commentProject>/…; under the displayed project the
        // thread does not exist, the rules deny it, and removing that denied listener killed the
        // whole Firestore Listen stream on every boot.
        ProjectHelper.getProjectById.mockImplementation(id => (id === 'thread-project' ? threadProject : null))
        getAssistant.mockImplementation(id => (id === 'default-assistant' ? { uid: 'default-assistant' } : null))

        const data = getCommentData(displayed, null, pointer, 'default-assistant', 'displayed-project')

        expect(data.commentProject).toBe(threadProject)
        expect(data.commentCreator).toEqual({ uid: 'default-assistant' })
    })

    it('waits with a skeleton rather than borrowing another project when nothing can be resolved yet', () => {
        ProjectHelper.getProjectById.mockImplementation(id => (id === 'thread-project' ? threadProject : null))
        expect(getCommentData(displayed, null, pointer, 'default-assistant', 'displayed-project')).toMatchObject({
            commentProject: null,
            commentCreator: null,
        })

        ProjectHelper.getProjectById.mockReturnValue(null)
        expect(getCommentData(displayed, null, pointer, 'default-assistant', 'displayed-project')).toMatchObject({
            commentProject: null,
            commentCreator: null,
        })
    })

    it('keeps using the displayed project for per-project pointers, which carry no projectId', () => {
        const { projectId, ...perProjectPointer } = pointer
        getAssistantInProject.mockImplementation((projectIdArg, assistantId) =>
            projectIdArg === 'displayed-project' && assistantId === 'displayed-assistant' ? { uid: assistantId } : null
        )

        const data = getCommentData(displayed, null, perProjectPointer, 'default-assistant', 'displayed-project')

        expect(data.commentProject).toBe(displayed)
        expect(data.commentCreator).toEqual({ uid: 'displayed-assistant' })
    })
})
