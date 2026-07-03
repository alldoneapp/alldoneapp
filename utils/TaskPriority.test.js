import { TASK_PRIORITY_NONE, normalizeTaskPriority, sortTasksByPriority } from './TaskPriority'

describe('TaskPriority', () => {
    test('normalizes missing and invalid legacy values to none', () => {
        expect(normalizeTaskPriority()).toBe(TASK_PRIORITY_NONE)
        expect(normalizeTaskPriority('urgent')).toBe(TASK_PRIORITY_NONE)
        expect(normalizeTaskPriority('must_do')).toBe('must_do')
    })

    test('sorts by priority while preserving order inside each tier', () => {
        const tasks = [
            { id: 'none-1' },
            { id: 'should-1', priority: 'should_do' },
            { id: 'must-1', priority: 'must_do' },
            { id: 'could-1', priority: 'could_do' },
            { id: 'must-2', priority: 'must_do' },
            { id: 'none-2', priority: 'none' },
        ]

        expect(sortTasksByPriority(tasks).map(task => task.id)).toEqual([
            'must-1',
            'must-2',
            'should-1',
            'could-1',
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
})
