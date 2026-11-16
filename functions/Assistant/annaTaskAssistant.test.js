const { resolveAnnaTaskAssistant } = require('./annaTaskAssistant')

function database(overrides = {}) {
    const data = {
        'users/user': { defaultProjectId: 'private', projectIds: ['product'] },
        'projects/product': { userIds: ['user'], assistantId: 'cto' },
        'assistants/product/items/cto': { displayName: 'Alldone CTO' },
        ...overrides,
    }
    const snapshot = path => ({ id: path.split('/').pop(), exists: !!data[path], data: () => data[path] })
    const db = {
        doc: path => ({ path, get: async () => snapshot(path) }),
        getAll: async (...refs) => refs.map(ref => snapshot(ref.path)),
        collection: path => ({
            doc: id => db.doc(`${path}/${id}`),
            where: (field, op, value) => ({
                limit: count => ({
                    get: async () => ({
                        docs: Object.keys(data)
                            .filter(key => key.startsWith(`${path}/`) && data[key]?.[field] === value)
                            .slice(0, count)
                            .map(snapshot),
                    }),
                }),
            }),
        }),
    }
    return db
}

const resolve = (db, args = {}) =>
    resolveAnnaTaskAssistant({
        db,
        projectId: 'private',
        targetProjectId: 'product',
        assistantId: 'anna',
        requestUserId: 'user',
        ...args,
    })

test('routes Anna work to the destination project assistant', async () => {
    expect(await resolve(database())).toEqual({ projectId: 'product', assistantId: 'cto' })
})

test('uses the flagged project default ahead of a stale configured ID', async () => {
    expect(await resolve(database({ 'assistants/product/items/designer': { isDefault: true } }))).toEqual({
        projectId: 'product',
        assistantId: 'designer',
    })
})

test('supports a configured global assistant', async () => {
    expect(
        await resolve(
            database({
                'assistants/product/items/cto': null,
                'assistants/globalProject/items/cto': { displayName: 'Shared CTO' },
            })
        )
    ).toEqual({ projectId: 'product', assistantId: 'cto' })
})

test.each([{}, { assistantId: 'deleted' }])(
    'keeps Anna for a project without an available assistant: %j',
    async config => {
        expect(await resolve(database({ 'projects/product': { userIds: ['user'], ...config } }))).toEqual({
            projectId: 'private',
            assistantId: 'anna',
        })
    }
)

test('preserves an explicitly selected specialist within the same project', async () => {
    expect(await resolve(database(), { projectId: 'product', assistantId: 'designer' })).toEqual({
        projectId: 'product',
        assistantId: 'designer',
    })
})

test('requires real project membership even when the user profile lists the project', async () => {
    await expect(
        resolve(database({ 'projects/product': { userIds: ['someone-else'], assistantId: 'cto' } }))
    ).rejects.toThrow('User does not have access')
})

test('preserves an existing task assistant in the destination project ahead of its default', async () => {
    expect(
        await resolve(database({ 'assistants/product/items/designer': {} }), { assignedAssistantId: 'designer' })
    ).toEqual({
        projectId: 'product',
        assistantId: 'designer',
    })
})

test('replaces a stale cross-project Anna assignment with the destination assistant', async () => {
    expect(await resolve(database(), { assignedAssistantId: 'anna' })).toEqual({
        projectId: 'product',
        assistantId: 'cto',
    })
})
