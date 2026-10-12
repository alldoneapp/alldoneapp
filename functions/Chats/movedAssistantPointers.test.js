const { movedAssistantPointerUpdates } = require('./movedAssistantPointers')
const pointer = { objectId: 'task', objectType: 'tasks', date: 10 }
const global = { ...pointer, projectId: 'source' }
const run = user => movedAssistantPointerUpdates(user, 'source', 'target', 'task', 'DELETE')

test('moves both legacy and assistant-specific global/project pointers', () => {
    const pointers = { source: pointer, allProjects: global }
    const result = run({ lastAssistantCommentData: pointers, lastAssistantCommentDataByAssistant: { anna: pointers } })
    for (const prefix of ['lastAssistantCommentData', 'lastAssistantCommentDataByAssistant.anna']) {
        expect(result[`${prefix}.allProjects`]).toEqual({ ...global, projectId: 'target' })
        expect(result[`${prefix}.target`]).toEqual({ ...pointer, projectId: 'target' })
        expect(result[`${prefix}.source`]).toBe('DELETE')
    }
})

test('preserves newer destination conversations and unrelated global pointers', () => {
    const result = run({
        lastAssistantCommentDataByAssistant: {
            anna: {
                source: pointer,
                target: { objectId: 'new', date: 20 },
                allProjects: { objectId: 'new', projectId: 'elsewhere' },
            },
            other: { allProjects: { objectId: 'other', projectId: 'source' } },
        },
    })
    expect(result).toEqual({ 'lastAssistantCommentDataByAssistant.anna.source': 'DELETE' })
})

test('handles accounts without any assistant history', () => expect(run({})).toEqual({}))
