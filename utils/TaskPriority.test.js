import {
    TASK_PRIORITY_NONE,
    compareTasksByPriorityThenCompleted,
    normalizeTaskPriority,
    sortTasksByPriority,
} from './TaskPriority'

describe('TaskPriority', () => {
    test('normalizes missing and invalid legacy values to none', () => {
        expect(normalizeTaskPriority()).toBe(TASK_PRIORITY_NONE)
        expect(normalizeTaskPriority('urgent')).toBe(TASK_PRIORITY_NONE)
        expect(normalizeTaskPriority('must_do')).toBe('must_do')
        expect(normalizeTaskPriority('do_later')).toBe('do_later')
    })

    test('sorts by priority while preserving order inside each tier', () => {
        const tasks = [
            { id: 'none-1' },
            { id: 'should-1', priority: 'should_do' },
            { id: 'must-1', priority: 'must_do' },
            { id: 'could-1', priority: 'could_do' },
            { id: 'later-1', priority: 'do_later' },
            { id: 'must-2', priority: 'must_do' },
            { id: 'none-2', priority: 'none' },
        ]

        // do_later ranks below could_do but above none.
        expect(sortTasksByPriority(tasks).map(task => task.id)).toEqual([
            'must-1',
            'must-2',
            'should-1',
            'could-1',
            'later-1',
            'none-1',
            'none-2',
        ])
        expect(tasks[0].id).toBe('none-1')
    })

    test('keeps the focus task first regardless of its priority', () => {
        const tasks = [
            { id: 'must', priority: 'must_do' },
            { id: 'focus', priority: 'could_do' },
            { id: 'should', priority: 'should_do' },
        ]

        expect(sortTasksByPriority(tasks, 'focus').map(task => task.id)).toEqual(['focus', 'must', 'should'])
    })

    test('compares workflow tasks by priority before completed date', () => {
        const tasks = [
            { id: 'recent-should', priority: 'should_do', completed: 400 },
            { id: 'old-must', priority: 'must_do', completed: 100 },
            { id: 'recent-could', priority: 'could_do', completed: 500 },
            { id: 'new-must', priority: 'must_do', completed: 300 },
            { id: 'old-should', priority: 'should_do', completed: 200 },
        ]

        expect([...tasks].sort(compareTasksByPriorityThenCompleted).map(task => task.id)).toEqual([
            'new-must',
            'old-must',
            'recent-should',
            'old-should',
            'recent-could',
        ])
    })
})
