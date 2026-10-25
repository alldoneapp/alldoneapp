const { updateAssistantRunComment, moveAssistantRunComment } = require('./assistantRunLocation')

const location = { projectId: 'source', objectType: 'tasks', objectId: 'task', commentId: 'reply' }
const path = project => `chatComments/${project}/tasks/task/comments/reply`
const move = {
    sourceProjectId: 'source',
    targetProjectId: 'target',
    objectType: 'tasks',
    objectId: 'task',
    commentId: 'reply',
    runId: 'run',
}
function fixture() {
    const state = new Map([
        ['assistantRunLocks/run', { ...location, status: 'running' }],
        [path('source'), { commentText: 'Working', isLoading: true }],
    ])
    const snapshot = ref => ({ exists: state.has(ref.path), data: () => state.get(ref.path) })
    const write = (ref, value, replace = false) => {
        if (!replace && !state.has(ref.path)) throw Error('NOT_FOUND')
        state.set(ref.path, replace ? value : { ...state.get(ref.path), ...value })
    }
    const db = {
        doc: path => ({ path, update: async data => write({ path }, data) }),
        runTransaction: async callback =>
            callback({ get: async ref => snapshot(ref), set: (ref, data) => write(ref, data, true), update: write }),
    }
    return { db, state, lock: db.doc('assistantRunLocks/run') }
}

test('a copied run receives tokens and completion after its source is deleted', async () => {
    const { db, state, lock } = fixture()
    await updateAssistantRunComment(db, lock, location, { commentText: 'Moving' })
    await moveAssistantRunComment(db, move)
    state.delete(path('source'))
    expect(await updateAssistantRunComment(db, lock, location, { commentText: 'Moved', isLoading: false })).toEqual({
        ...location,
        projectId: 'target',
    })
    expect(state.get(path('target'))).toEqual({ commentText: 'Moved', isLoading: false })
    expect(state.has(path('source'))).toBe(false)
    expect(state.get('assistantRunLocks/run').projectId).toBe('target')
})

test('a completion committed before the move is copied in its final state', async () => {
    const { db, state, lock } = fixture()
    await updateAssistantRunComment(db, lock, location, { isLoading: false, commentText: 'Done' })
    await moveAssistantRunComment(db, move)
    expect(state.get(path('target'))).toEqual({ commentText: 'Done', isLoading: false })
})

test.each(['failed', 'cancelled'])('%s cleanup follows a moved run', async status => {
    const { db, state, lock } = fixture()
    await moveAssistantRunComment(db, move)
    state.delete(path('source'))
    await updateAssistantRunComment(db, lock, location, { isLoading: false, assistantRun: { status } })
    expect(state.get(path('target'))).toMatchObject({ isLoading: false, assistantRun: { status } })
})

test('retrying a move preserves newer destination text', async () => {
    const { db, state, lock } = fixture()
    await moveAssistantRunComment(db, move)
    await updateAssistantRunComment(db, lock, location, { commentText: 'Final answer' })
    await moveAssistantRunComment(db, move)
    expect(state.get(path('target')).commentText).toBe('Final answer')
})

test('multiple moves keep routing by the original run ID', async () => {
    const { db, state, lock } = fixture()
    await moveAssistantRunComment(db, move)
    await moveAssistantRunComment(db, { ...move, sourceProjectId: 'target', targetProjectId: 'third' })
    await updateAssistantRunComment(db, lock, location, { commentText: 'Third project' })
    expect(state.get(path('third')).commentText).toBe('Third project')
})

test('unrelated lock coordinates cannot redirect another comment', async () => {
    const { db, state, lock } = fixture()
    state.set(lock.path, { ...location, projectId: 'other', objectId: 'other-task' })
    await updateAssistantRunComment(db, lock, location, { commentText: 'Still here' })
    expect(state.get(path('source')).commentText).toBe('Still here')
})

test('a missing source comment fails the move before deleting any source data', async () => {
    const { db, state } = fixture()
    state.delete(path('source'))
    await expect(moveAssistantRunComment(db, move)).rejects.toThrow('disappeared')
    expect(state.get('assistantRunLocks/run').projectId).toBe('source')
})
