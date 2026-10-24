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

const { createInitialStatusMessage, getParentObjectPath } = require('./assistantStatusHelper')

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

describe('getParentObjectPath', () => {
    test.each([
        ['tasks', 'items/project-1/tasks/object-1'],
        ['notes', 'noteItems/project-1/notes/object-1'],
        ['goals', 'goals/project-1/items/object-1'],
        ['topics', 'chatObjects/project-1/chats/object-1'],
        ['contacts', 'projectsContacts/project-1/contacts/object-1'],
    ])('resolves %s to the document the object actually lives in', (objectType, expectedPath) => {
        expect(getParentObjectPath('project-1', objectType, 'object-1')).toBe(expectedPath)
    })

    test.each(['unknown', 'skills', 'assistants', 'projects', 'users', '', undefined])(
        'returns null for a type without a maintained parent preview (%s)',
        objectType => {
            expect(getParentObjectPath('project-1', objectType, 'object-1')).toBeNull()
        }
    )

    test('returns null when the project or object id is missing', () => {
        expect(getParentObjectPath('', 'tasks', 'object-1')).toBeNull()
        expect(getParentObjectPath('project-1', 'tasks', '')).toBeNull()
    })
})

test.each([
    ['notes', 'noteItems/project-1/notes/object-1', 'notes/project-1/notes/object-1'],
    ['goals', 'goals/project-1/items/object-1', 'goals/project-1/goals/object-1'],
])(
    'updates the last comment preview on the real %s document without touching its comment count',
    async (objectType, realPath, formerWrongPath) => {
        await createInitialStatusMessage(
            'project-1',
            objectType,
            'object-1',
            'assistant-1',
            'Starting the VM',
            [],
            [0],
            ['user-1']
        )

        const parentRef = mockRefs.get(realPath)
        expect(parentRef.update).toHaveBeenCalledWith({
            'commentsData.lastComment': 'Starting the VM',
            'commentsData.lastCommentType': 'STAYWARD_COMMENT',
        })
        expect(mockRefs.has(formerWrongPath)).toBe(false)
    }
)
