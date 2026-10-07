const { getWorkspaceChangeTarget, recordAnnaWorkspaceChange } = require('./annaWorkspaceChanges')
const { isAnnaWorkspacePath } = require('./annaWorkspaceContract')
const runtime = {
    annaConversation: true,
    requestUserId: 'u1',
    projectId: 'p1',
    objectType: 'topics',
    objectId: 'AnnaChat20261007u1',
    messageId: 'request1',
}
const chatPath = 'chatObjects/p1/chats/AnnaChat20261007u1'
const result = { success: true, taskId: 't1', projectId: 'p2' }
function database(overrides = {}) {
    const data = new Map(
        Object.entries({
            [chatPath]: { annaOwnerId: 'u1', creatorId: 'u1', type: 'topics' },
            'projects/p1': { userIds: ['u1'] },
            'projects/p2': { userIds: ['u1'] },
            'items/p2/tasks/t1': { name: 'Saved launch task', isPublicFor: [0] },
            ...overrides,
        })
    )
    const snapshot = path => ({ exists: data.has(path), data: () => data.get(path) })
    const update = jest.fn((ref, patch) => data.set(ref.path, { ...data.get(ref.path), ...patch }))
    const db = {
        doc: path => ({ path, get: async () => snapshot(path) }),
        runTransaction: async fn => fn({ get: async ref => snapshot(ref.path), update }),
    }
    return { db, data, update }
}
it.each([
    ['create_task', result, 'task', 't1', 'p2', 'created'],
    ['update_task', { ...result, updatedTask: { projectId: 'old' }, changes: ['name'] }, 'task', 't1', 'p2', 'updated'],
    ['create_note', { success: true, noteId: 'n1', note: { projectId: 'p2' } }, 'note', 'n1', 'p2', 'created'],
    [
        'update_note',
        { success: true, noteId: 'n1', project: { id: 'p2' }, changes: ['move'] },
        'note',
        'n1',
        'p2',
        'updated',
    ],
    [
        'update_contact',
        { success: true, contact: { contactId: 'c1' }, project: { id: 'p2' }, changes: ['displayName'] },
        'contact',
        'c1',
        'p2',
        'updated',
    ],
])('identifies the final saved object from %s', (tool, saved, type, objectId, projectId, change) => {
    expect(getWorkspaceChangeTarget(tool, saved)).toEqual({ type, objectId, projectId, change })
})
it.each([
    ['create_task', { ...result, success: false }],
    ['create_task', { ...result, existing: true }],
    ['create_task', { ...result, skippedDuplicate: true }],
    ['update_task', { ...result, changes: [] }],
    ['create_task', { ...result, taskId: '../private' }],
    ['get_tasks', result],
])('does not highlight failures, duplicates, invalid targets or reads (%s)', (tool, saved) => {
    expect(getWorkspaceChangeTarget(tool, saved)).toBeNull()
})
it('records the actual cross-project task only after checking the saved object and private conversation owner', async () => {
    const { db, data } = database()
    await recordAnnaWorkspaceChange({ db, runtime, toolName: 'create_task', result, now: 1000 })
    expect(data.get(chatPath).annaWorkspaceChanges).toEqual([
        expect.objectContaining({
            type: 'task',
            projectId: 'p2',
            objectId: 't1',
            change: 'created',
            path: '/projects/p2/tasks/t1/properties',
            createdAt: 1000,
            expiresAt: 121000,
            triggerMessageId: 'request1',
        }),
    ])
})
it('reveals the destination after moving a task, even when persistence still reports its source project', async () => {
    const { db, data } = database()
    await recordAnnaWorkspaceChange({
        db,
        runtime,
        toolName: 'update_task',
        result: {
            success: true,
            taskId: 't1',
            projectId: 'p1',
            project: { id: 'p2' },
            changes: ['moved'],
        },
    })
    expect(data.get(chatPath).annaWorkspaceChanges[0]).toMatchObject({
        projectId: 'p2',
        objectId: 't1',
        path: '/projects/p2/tasks/t1/properties',
        change: 'updated',
    })
})
it.each([
    { 'projects/p2': { userIds: ['someone-else'] } },
    { 'items/p2/tasks/t1': undefined },
    { 'items/p2/tasks/t1': { isPublicFor: ['someone-else'] } },
    { [chatPath]: { annaOwnerId: 'someone-else', creatorId: 'u1' } },
])('never publishes inaccessible objects or somebody else’s conversation', async overrides => {
    const { db, data, update } = database(overrides)
    for (const [key, value] of data) if (value === undefined) data.delete(key)
    await recordAnnaWorkspaceChange({ db, runtime, toolName: 'create_task', result })
    expect(update).not.toHaveBeenCalled()
})
it('ignores ordinary task and WhatsApp conversations', async () => {
    const { db, update } = database()
    await recordAnnaWorkspaceChange({
        db,
        runtime: { ...runtime, annaConversation: false },
        toolName: 'create_task',
        result,
    })
    await recordAnnaWorkspaceChange({
        db,
        runtime: { ...runtime, objectId: 'BotChat20261007u1' },
        toolName: 'create_task',
        result,
    })
    expect(update).not.toHaveBeenCalled()
})
it('queues only successful, accessible, changed objects from a bulk task update', async () => {
    const { db, data } = database({
        'items/p2/tasks/t2': { name: 'Second task', isPublicFor: [0] },
        'items/p2/tasks/failed': { name: 'Failed task', isPublicFor: [0] },
    })
    await recordAnnaWorkspaceChange({
        db,
        runtime,
        toolName: 'update_task',
        result: {
            success: true,
            updated: [
                { id: 't1', projectId: 'p2', changes: ['name'] },
                { id: 't2', projectId: 'p2', changes: ['dueDate'] },
                { id: 't1', projectId: 'p2', changes: ['name'] },
                { id: 'unchanged', projectId: 'p2', changes: [] },
                { id: 'inaccessible', projectId: 'elsewhere', changes: ['name'] },
            ],
            failed: [{ id: 'failed', projectId: 'p2', error: 'Unavailable' }],
        },
    })
    expect(data.get(chatPath).annaWorkspaceChanges.map(cue => cue.objectId)).toEqual(['t1', 't2'])
})
it.each(['note', 'contact'])('uses a supported canonical detail route for a saved %s', async type => {
    const id = `${type}-1`
    const collection = type === 'note' ? 'noteItems' : 'projectsContacts'
    const { db, data } = database({ [`${collection}/p2/${type}s/${id}`]: { isPublicFor: [0] } })
    await recordAnnaWorkspaceChange({
        db,
        runtime,
        toolName: `update_${type}`,
        result: { success: true, [`${type}Id`]: id, projectId: 'p2', changes: ['name'] },
    })
    const [cue] = data.get(chatPath).annaWorkspaceChanges
    expect(cue.path).toBe(`/projects/p2/${type}s/${id}/${type === 'note' ? 'editor' : 'properties'}`)
    expect(isAnnaWorkspacePath(cue.path)).toBe(true)
})
it('keeps a bounded queue, expires old work and retains acknowledgements for surviving cues', async () => {
    const { db, data } = database()
    data.get(chatPath).annaWorkspaceChanges = [
        { id: 'expired', expiresAt: 1 },
        { id: 'shown', expiresAt: 200000 },
    ]
    data.get(chatPath).annaWorkspaceChangeStatus = { expired: { status: 'shown' }, shown: { status: 'shown' } }
    await recordAnnaWorkspaceChange({ db, runtime, toolName: 'create_task', result, now: 1000 })
    expect(data.get(chatPath).annaWorkspaceChanges).toHaveLength(2)
    expect(data.get(chatPath).annaWorkspaceChangeStatus).toEqual({ shown: { status: 'shown' } })
    for (let i = 0; i < 15; i++)
        await recordAnnaWorkspaceChange({ db, runtime, toolName: 'create_task', result, now: 1001 + i })
    expect(data.get(chatPath).annaWorkspaceChanges).toHaveLength(12)
    expect(new Set(data.get(chatPath).annaWorkspaceChanges.map(cue => cue.id)).size).toBe(12)
    expect(data.get(chatPath).annaWorkspaceChangeStatus).toEqual({})
})
