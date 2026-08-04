import { getTaskTypeIndex, MAIN_TASK_INDEX, taskBelongsInOpenBoard, WORKFLOW_TASK_INDEX } from './openTasks'

describe('assistant profile open task selection', () => {
    it('includes active workflow tasks in the unified assistant profile timeline', () => {
        const workflowTask = { workflowTask: true }

        expect(taskBelongsInOpenBoard(workflowTask, true)).toBe(false)
        expect(taskBelongsInOpenBoard(workflowTask, true, false, true)).toBe(true)
        expect(taskBelongsInOpenBoard(workflowTask, true, true)).toBe(true)
    })

    it('flattens an active workflow task into the normal assistant timeline', () => {
        const workflowTaskWithHistory = {
            workflowTask: true,
            userIds: ['assistant-1', 'reviewer-2', 'assistant-1'],
        }

        expect(getTaskTypeIndex(workflowTaskWithHistory, false, false)).toBe(WORKFLOW_TASK_INDEX)
        expect(getTaskTypeIndex(workflowTaskWithHistory, false, false, true)).toBe(MAIN_TASK_INDEX)
    })
})
