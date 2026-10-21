const mockRefs = new Map()
const mockBatch = { set: jest.fn(), commit: jest.fn(async () => {}) }
const mockDb = {
    doc: jest.fn(path => {
        if (!mockRefs.has(path)) {
            mockRefs.set(path, {
                path,
                get: jest.fn(async () => ({ exists: true, data: () => ({ title: 'Task' }) })),
                set: jest.fn(async () => {}),
                update: jest.fn(async () => {}),
            })
        }
        return mockRefs.get(path)
    }),
    batch: () => mockBatch,
}

jest.mock('firebase-admin', () => ({ firestore: () => mockDb }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY: 'allProjects' }))

const { createInitialStatusMessage } = require('./assistantStatusHelper')

beforeEach(() => {
    jest.clearAllMocks()
    mockRefs.clear()
})

test('selects the new status thread in project, global and assistant previews for human followers', async () => {
    await createInitialStatusMessage(
        'project-1',
        'tasks',
        'task-1',
        'assistant-1',
        'Starting the VM',
        [],
        [0],
        ['user-1', 'user-1', 'assistant-1', 'user-2']
    )

    for (const userId of ['user-1', 'user-2']) {
        const ref = mockRefs.get(`users/${userId}`)
        expect(ref.set).toHaveBeenCalledTimes(1)
        const [data, options] = ref.set.mock.calls[0]
        expect(options).toEqual({ merge: true })
        expect(data.lastAssistantCommentData['project-1']).toEqual({
            objectType: 'tasks',
            objectId: 'task-1',
            creatorId: 'assistant-1',
            creatorType: 'assistant',
            date: expect.any(Number),
        })
        expect(data.lastAssistantCommentData.allProjects).toEqual({
            ...data.lastAssistantCommentData['project-1'],
            projectId: 'project-1',
        })
        expect(data.lastAssistantCommentDataByAssistant['assistant-1']).toEqual(data.lastAssistantCommentData)
    }
    expect(mockRefs.has('users/assistant-1')).toBe(false)
})
