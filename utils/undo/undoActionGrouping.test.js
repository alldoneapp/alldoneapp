import {
    buildUndoActionGroup,
    buildUndoGroupingKey,
    reverseUndoActionGroup,
    UNDO_BURST_MAX_GAP_MS,
    UNDO_BURST_MAX_SPAN_MS,
    UNDO_BURST_SETTLE_MS,
} from './undoActionGrouping'

const buildAction = (id, createdAt, overrides = {}) => ({
    actionId: id,
    actorId: 'user-1',
    source: 'ui',
    status: 'applied',
    createdAt,
    lastChangedAt: createdAt,
    expiresAt: createdAt + 100000,
    operations: [
        {
            objectType: 'task',
            projectId: 'project-1',
            objectId: `task-${id}`,
            kind: 'update',
            before: { done: false },
            after: { done: true },
        },
    ],
    ...overrides,
})

describe('undo action burst grouping', () => {
    it('settles after the maximum grouping gap so a rendered banner cannot grow later', () => {
        expect(UNDO_BURST_SETTLE_MS).toBeGreaterThan(UNDO_BURST_MAX_GAP_MS)
    })

    it('groups a compatible rapid burst and keeps every atomic action intact', () => {
        const compound = buildAction('compound', 1000, {
            operations: [
                {
                    objectType: 'task',
                    projectId: 'project-1',
                    objectId: 'task-1',
                    kind: 'update',
                    before: { dueDate: 1 },
                    after: { dueDate: 2 },
                },
                {
                    objectType: 'task',
                    projectId: 'project-1',
                    objectId: 'task-2',
                    kind: 'update',
                    before: { dueDate: 1 },
                    after: { dueDate: 2 },
                },
            ],
        })
        const second = buildAction('second', 1400, {
            operations: [
                {
                    objectType: 'task',
                    projectId: 'project-1',
                    objectId: 'task-3',
                    kind: 'update',
                    before: { dueDate: 1 },
                    after: { dueDate: 2 },
                },
            ],
        })

        const group = buildUndoActionGroup([compound, second], 1500)

        expect(group.actions.map(action => action.actionId)).toEqual(['second', 'compound'])
        expect(group.actions[1].operations).toHaveLength(2)
    })

    it('does not flatten a goal postponement and its linked tasks into separate actions', () => {
        const goalPostponement = buildAction('postpone-goal', 1000, {
            operations: [
                {
                    objectType: 'goal',
                    projectId: 'project-1',
                    objectId: 'goal-1',
                    kind: 'update',
                    before: { dueDate: 1 },
                    after: { dueDate: 2 },
                },
                ...['task-1', 'task-2'].map(objectId => ({
                    objectType: 'task',
                    projectId: 'project-1',
                    objectId,
                    kind: 'update',
                    before: { dueDate: 1 },
                    after: { dueDate: 2 },
                })),
            ],
        })

        const group = buildUndoActionGroup([goalPostponement], 1100)

        expect(group.actions).toHaveLength(1)
        expect(group.actions[0].operations.map(operation => operation.objectType)).toEqual(['goal', 'task', 'task'])
    })

    it.each([
        ['time gap', buildAction('older', 2000 - UNDO_BURST_MAX_GAP_MS - 1)],
        ['actor', buildAction('older', 1800, { actorId: 'assistant-1' })],
        ['source', buildAction('older', 1800, { source: 'automation' })],
        [
            'project',
            buildAction('older', 1800, {
                operations: [
                    {
                        objectType: 'task',
                        projectId: 'project-2',
                        objectId: 'task-older',
                        kind: 'update',
                        before: { done: false },
                        after: { done: true },
                    },
                ],
            }),
        ],
        [
            'changed fields',
            buildAction('older', 1800, {
                operations: [
                    {
                        objectType: 'task',
                        projectId: 'project-1',
                        objectId: 'task-older',
                        kind: 'update',
                        before: { priority: 'none' },
                        after: { priority: 'high' },
                    },
                ],
            }),
        ],
    ])('starts a new group at a %s boundary', (_boundary, older) => {
        const newest = buildAction('newest', 2000)
        expect(buildUndoActionGroup([older, newest], 2100).actions.map(action => action.actionId)).toEqual(['newest'])
    })

    it('caps a continuous stream to a genuinely short burst', () => {
        const actions = [0, 400, 800, 1200, 1600, UNDO_BURST_MAX_SPAN_MS, UNDO_BURST_MAX_SPAN_MS + 400].map(offset =>
            buildAction(`at-${offset}`, 4000 - offset)
        )

        expect(buildUndoActionGroup(actions, 4100).actions.map(action => action.actionId)).toEqual([
            'at-0',
            'at-400',
            'at-800',
            'at-1200',
            'at-1600',
            `at-${UNDO_BURST_MAX_SPAN_MS}`,
        ])
    })

    it('excludes expired actions before calculating the burst', () => {
        const expired = buildAction('expired', 1900, { expiresAt: 1999 })
        const current = buildAction('current', 1800, { expiresAt: 3000 })

        expect(buildUndoActionGroup([expired, current], 2000).actions.map(action => action.actionId)).toEqual([
            'current',
        ])
    })

    it('persists a deterministic key that ignores object ids and operation count', () => {
        const one = buildAction('one', 1000)
        const two = buildAction('two', 1100)
        two.operations.push({ ...two.operations[0], objectId: 'another-task' })

        expect(buildUndoGroupingKey(one)).toBe(buildUndoGroupingKey(two))
    })
})

describe('group reversal', () => {
    const actions = [buildAction('oldest', 1000), buildAction('middle', 1100), buildAction('newest', 1200)]

    it('undoes newest to oldest and redoes oldest to newest', async () => {
        const reverse = jest.fn(() => Promise.resolve())

        await reverseUndoActionGroup(actions, 'undo', reverse)
        expect(reverse.mock.calls).toEqual([
            ['newest', 'undo'],
            ['middle', 'undo'],
            ['oldest', 'undo'],
        ])

        reverse.mockClear()
        await reverseUndoActionGroup(actions, 'redo', reverse)
        expect(reverse.mock.calls).toEqual([
            ['oldest', 'redo'],
            ['middle', 'redo'],
            ['newest', 'redo'],
        ])
    })

    it('compensates completed members in reverse order when a later member fails', async () => {
        const failure = new Error('conflict')
        const reverse = jest.fn((id, direction) => {
            if (id === 'oldest' && direction === 'undo') return Promise.reject(failure)
            return Promise.resolve()
        })

        await expect(reverseUndoActionGroup(actions, 'undo', reverse)).rejects.toBe(failure)
        expect(reverse.mock.calls).toEqual([
            ['newest', 'undo'],
            ['middle', 'undo'],
            ['oldest', 'undo'],
            ['middle', 'redo'],
            ['newest', 'redo'],
        ])
        expect(failure.compensationFailed).toBe(false)
    })

    it('reports when compensation itself cannot restore the original state', async () => {
        const failure = new Error('conflict')
        const reverse = jest.fn((id, direction) => {
            if (id === 'middle' && direction === 'undo') return Promise.reject(failure)
            if (id === 'newest' && direction === 'redo') return Promise.reject(new Error('rollback conflict'))
            return Promise.resolve()
        })

        await expect(reverseUndoActionGroup(actions, 'undo', reverse)).rejects.toMatchObject({
            compensationFailed: true,
            completedActionIds: ['newest'],
        })
    })
})
