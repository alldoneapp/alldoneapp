import { getCommentData } from './helper'
import { getAssistant, getAssistantInProject } from '../../../AdminPanel/Assistants/assistantsHelper'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'

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
