'use strict'

const mockEnqueue = jest.fn()
const mockTaskQueue = jest.fn(() => ({ enqueue: mockEnqueue }))
const mockMoveTask = jest.fn()
const mockAssertObjectAccess = jest.fn()
const mockAssertProjectAccess = jest.fn()

jest.mock('firebase-admin', () => ({
    app: jest.fn(() => ({ options: { projectId: 'test-project' } })),
    firestore: jest.fn(),
}))
jest.mock('firebase-admin/functions', () => ({
    getFunctions: jest.fn(() => ({ taskQueue: mockTaskQueue })),
}))
jest.mock('../shared/privacyAccess', () => ({
    assertObjectAccess: (...args) => mockAssertObjectAccess(...args),
    assertProjectAccess: (...args) => mockAssertProjectAccess(...args),
}))
jest.mock('../shared/moveTaskToDifferentProject', () => ({
    moveTaskToDifferentProject: (...args) => mockMoveTask(...args),
}))

const admin = require('firebase-admin')
const {
    enqueueManualTaskProjectMove,
    getManualTaskMoveQueueResource,
    runManualTaskProjectMove,
} = require('./manualTaskProjectMove')

const snapshot = data => ({ exists: data !== undefined, data: () => data })

beforeEach(() => {
    jest.clearAllMocks()
    mockEnqueue.mockResolvedValue(undefined)
    mockAssertObjectAccess.mockResolvedValue(true)
    mockAssertProjectAccess.mockResolvedValue(true)
    mockMoveTask.mockResolvedValue({ moved: true })
})

it('enqueues a short, durable background job', async () => {
    const result = await enqueueManualTaskProjectMove({
        sourceProjectId: 'project-a',
        targetProjectId: 'project-b',
        taskId: 'task-1',
        actorId: 'user-1',
    })

    expect(result).toMatchObject({ queued: true, sourceProjectId: 'project-a', targetProjectId: 'project-b' })
    expect(mockTaskQueue).toHaveBeenCalledWith('locations/europe-west1/functions/runManualTaskProjectMove')
    expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
            requestId: result.requestId,
            sourceProjectId: 'project-a',
            targetProjectId: 'project-b',
            taskId: 'task-1',
            actorId: 'user-1',
        }),
        expect.objectContaining({ id: `manual-task-move-${result.requestId}`, dispatchDeadlineSeconds: 300 })
    )
})

it('revalidates access in the worker and invokes the manual move mode', async () => {
    const docs = {
        'projects/project-a': snapshot({ name: 'Inbox', color: '#aaa', userIds: ['user-1'] }),
        'projects/project-b': snapshot({ name: 'Product', color: '#bbb', userIds: ['user-1'] }),
        'users/user-1': snapshot({ displayName: 'Karsten' }),
    }
    const database = { doc: jest.fn(path => ({ get: jest.fn(async () => docs[path] || snapshot(undefined)) })) }
    admin.firestore.mockReturnValue(database)

    await runManualTaskProjectMove({
        requestId: 'request-1',
        sourceProjectId: 'project-a',
        targetProjectId: 'project-b',
        taskId: 'task-1',
        actorId: 'user-1',
    })

    expect(mockAssertProjectAccess).toHaveBeenCalledWith(database, 'user-1', 'project-b')
    expect(mockAssertObjectAccess).toHaveBeenCalledWith(database, 'user-1', 'project-a', 'tasks', 'task-1')
    expect(mockMoveTask).toHaveBeenCalledWith(
        expect.objectContaining({
            database,
            requestId: 'request-1',
            sourceProjectId: 'project-a',
            targetProjectId: 'project-b',
            taskId: 'task-1',
            editorId: 'user-1',
            editorName: 'Karsten',
            manual: true,
            sourceProject: expect.objectContaining({ id: 'project-a', name: 'Inbox' }),
            targetProject: expect.objectContaining({ id: 'project-b', name: 'Product' }),
        })
    )
})

it('rejects invalid worker payloads before any database access', async () => {
    await expect(runManualTaskProjectMove({ taskId: 'task-1' })).rejects.toThrow('Invalid manual task move payload')
    expect(admin.firestore).not.toHaveBeenCalled()
})

it('uses the local worker name when the deployment project cannot be resolved', () => {
    admin.app.mockImplementationOnce(() => {
        throw new Error('not initialized')
    })
    const oldProject = process.env.GCLOUD_PROJECT
    const oldGcpProject = process.env.GCP_PROJECT
    delete process.env.GCLOUD_PROJECT
    delete process.env.GCP_PROJECT
    try {
        expect(getManualTaskMoveQueueResource()).toBe('runManualTaskProjectMove')
    } finally {
        if (oldProject === undefined) delete process.env.GCLOUD_PROJECT
        else process.env.GCLOUD_PROJECT = oldProject
        if (oldGcpProject === undefined) delete process.env.GCP_PROJECT
        else process.env.GCP_PROJECT = oldGcpProject
    }
})
