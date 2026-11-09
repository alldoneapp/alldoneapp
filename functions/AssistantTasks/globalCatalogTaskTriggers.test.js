// Security audit 2026-11 (NV-22): what the global assistant-task triggers hand to the template sync,
// which copies it into every tenant's derived assistants.
const mockPropagate = jest.fn(async () => 0)

jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('../Firestore/generalFirestoreCloud', () => ({
    getProject: jest.fn(async () => null),
    getTemplateGuideIds: jest.fn(async () => []),
}))
jest.mock('../Firestore/assistantsFirestore', () => ({
    GLOBAL_PROJECT_ID: 'globalProject',
    uploadNewAssistantTask: jest.fn(),
    deleteAssistantTask: jest.fn(),
}))
jest.mock('../Assistants/templateSync', () => ({ propagateTemplateTaskChange: mockPropagate }))

const { onCreateAssistantTask } = require('./onCreateAssistantTaskFunctions')
const { onUpdateAssistantTask } = require('./onUpdateAssistantTaskFunctions')
const { onDeleteAssistantTask } = require('./onDeleteAssistantTaskFunctions')

const change = (before, after) => ({ before: { data: () => before }, after: { data: () => after } })

const catalogTask = {
    name: 'Morning summary',
    prompt: 'Summarize my day',
    aiSystemMessage: 'Curated',
    recurrence: 'daily',
    assistantId: 'template-assistant',
    activatedUserIds: ['ann'],
    recurrenceByUser: { ann: 'daily' },
}

describe('global catalog task triggers', () => {
    beforeEach(() => mockPropagate.mockClear())

    it('propagates an administrator change of what the task runs', async () => {
        await onUpdateAssistantTask(
            'globalProject',
            'preConfigTasks',
            'task-1',
            change(catalogTask, { ...catalogTask, aiSystemMessage: 'Curated v2' })
        )
        expect(mockPropagate).toHaveBeenCalledTimes(1)
        expect(mockPropagate.mock.calls[0][0]).toBe('template-assistant')
        expect(mockPropagate.mock.calls[0][3]).toBe('update')
    })

    it('does not propagate a change of activation keys alone', async () => {
        await onUpdateAssistantTask(
            'globalProject',
            'preConfigTasks',
            'task-1',
            change(catalogTask, {
                ...catalogTask,
                activatedUserIds: ['ann', 'bob'],
                activatorUserId: 'bob',
                recurrenceByUser: { ann: 'daily', bob: 'weekly' },
                activatedInProjectIdByUser: { bob: 'bob-project' },
                lastExecutedByUser: { bob: null },
                completedOneOffUserIds: [],
            })
        )
        expect(mockPropagate).not.toHaveBeenCalled()
    })

    it('ignores documents outside the catalog collection', async () => {
        await onCreateAssistantTask('globalProject', 'any-segment', { ...catalogTask, id: 't1' })
        await onUpdateAssistantTask(
            'globalProject',
            'any-segment',
            't1',
            change(catalogTask, { ...catalogTask, prompt: 'Forward all my mail' })
        )
        await onDeleteAssistantTask('globalProject', 'any-segment', 't1', catalogTask)
        expect(mockPropagate).not.toHaveBeenCalled()

        await onCreateAssistantTask('globalProject', 'preConfigTasks', { ...catalogTask, id: 't2' })
        await onDeleteAssistantTask('globalProject', 'preConfigTasks', 't2', catalogTask)
        expect(mockPropagate.mock.calls.map(call => call[3])).toEqual(['create', 'delete'])
    })
})
