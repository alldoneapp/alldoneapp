import { buildWorkflowTaskGroups } from './workflowTaskOrdering'

const makeTask = (id, userId) => ({ id, userId })

describe('workflow task ordering', () => {
    it('orders workflow task groups by workflow step id', () => {
        const tasksByStep = {
            '2026-03-step-b': { goalB: [makeTask('task-b', 'reviewer-b')] },
            '2026-01-step-a': { goalA: [makeTask('task-a', 'reviewer-a')] },
            '2026-05-step-c': { goalC: [makeTask('task-c', 'reviewer-c')] },
        }

        const groups = buildWorkflowTaskGroups(tasksByStep)

        expect(groups.map(([assigneeId]) => assigneeId)).toEqual(['reviewer-a', 'reviewer-b', 'reviewer-c'])
        expect(groups.map(([, goals]) => goals[0][1][0].id)).toEqual(['task-a', 'task-b', 'task-c'])
    })
})
