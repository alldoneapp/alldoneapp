const {
    ARTIFACT_BRIDGE_PROTOCOL,
    ARTIFACT_BRIDGE_SCRIPT,
    BRIDGE_LIMITS,
    isBridgeHello,
    isBridgeScriptPath,
    isProjectShared,
    normalizeBridgeQuery,
    toBridgeGoal,
    toBridgeTask,
} = require('./artifactDataBridge')

const query = (name, params, extra = {}) => ({
    protocol: ARTIFACT_BRIDGE_PROTOCOL,
    type: 'query',
    id: 'q1',
    name,
    params,
    ...extra,
})

describe('artifact data bridge', () => {
    it('answers only its own protocol and known queries', () => {
        expect(normalizeBridgeQuery(null)).toBeNull()
        expect(normalizeBridgeQuery({ type: 'query', id: 'q1', name: 'tasks' })).toBeNull()
        expect(normalizeBridgeQuery(query('tasks', {}, { id: '' }))).toBeNull()
        expect(normalizeBridgeQuery(query('users'))).toEqual({ id: 'q1', session: '', error: 'Unknown query "users".' })
        expect(normalizeBridgeQuery(query('project', { anything: 1 }, { session: 's1' }))).toEqual({
            id: 'q1',
            session: 's1',
            name: 'project',
            params: {},
        })
        expect(isBridgeHello({ protocol: ARTIFACT_BRIDGE_PROTOCOL, type: 'hello' })).toBe(true)
        expect(isBridgeHello({ type: 'hello' })).toBe(false)
    })

    it('keeps only the task parameters it supports, within their limits', () => {
        expect(normalizeBridgeQuery(query('tasks', { status: 'nope', limit: 'x', where: 'evil' })).params).toEqual({
            status: 'open',
            limit: BRIDGE_LIMITS.defaultTasks,
        })
        expect(normalizeBridgeQuery(query('tasks', { status: 'done', limit: 99999, sinceDays: 0 })).params).toEqual({
            status: 'done',
            limit: BRIDGE_LIMITS.maxTasks,
            sinceDays: 1,
        })
        expect(normalizeBridgeQuery(query('tasks', { status: 'open', sinceDays: 5 })).params).toEqual({
            status: 'open',
            limit: BRIDGE_LIMITS.defaultTasks,
        })
    })

    it('hands a page only objects the whole project can see, and only their chartable fields', () => {
        expect(isProjectShared({ readerIds: [0, 'u1'] })).toBe(true)
        expect(isProjectShared({ readerIds: ['u1'] })).toBe(false)
        expect(isProjectShared({})).toBe(false)

        const task = toBridgeTask('t1', {
            extendedName: 'Ship it',
            done: true,
            completed: 5,
            estimations: { '-1': 8 },
            userId: 'u1',
            parentGoalId: 'g1',
            readerIds: [0, 'u1'],
            isPublicFor: [0],
            comments: 'secret',
        })
        expect(task).toEqual({
            id: 't1',
            title: 'Ship it',
            done: true,
            created: null,
            completed: 5,
            dueDate: null,
            estimation: 8,
            assigneeId: 'u1',
            goalId: 'g1',
        })
        expect(toBridgeGoal('g1', { name: 'Launch', progress: 40, assigneesIds: ['u1'] })).toMatchObject({
            id: 'g1',
            title: 'Launch',
            progress: 40,
            assigneeIds: ['u1'],
        })
    })

    it('recognises the bridge script at any depth of an artifact', () => {
        expect(isBridgeScriptPath('_alldone/bridge.js')).toBe(true)
        expect(isBridgeScriptPath('reports/_alldone/bridge.js')).toBe(true)
        expect(isBridgeScriptPath('x_alldone/bridge.js')).toBe(false)
        expect(isBridgeScriptPath('index.html')).toBe(false)
    })

    it('ships a script that asks the window around it and nothing else', () => {
        expect(ARTIFACT_BRIDGE_SCRIPT).toContain(`'${ARTIFACT_BRIDGE_PROTOCOL}'`)
        expect(ARTIFACT_BRIDGE_SCRIPT).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon/)
        // It parses as a script.
        expect(() => new Function(ARTIFACT_BRIDGE_SCRIPT)).not.toThrow()
    })
})
