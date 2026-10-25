import { taskUsesWorkflowOutsideSteps } from './commentPopupWorkflowState'

// The rule mirrors `CheckBoxWrapper.toggleCheckAction`: it may only answer true for a task whose
// checkbox would hand it to the first reviewer rather than send it straight to Done.
const openTask = {
    id: 'task-1',
    userId: 'owner',
    userIds: ['owner'],
    stepHistory: [-1],
    done: false,
    // Every task built by `mapTaskData` carries these keys explicitly.
    gmailData: null,
    calendarData: null,
    genericData: null,
    isPrivate: false,
    isSubtask: false,
    parentId: null,
}

describe('taskUsesWorkflowOutsideSteps (AT-2501)', () => {
    it('accepts an ordinary task', () => {
        expect(taskUsesWorkflowOutsideSteps(openTask)).toBe(true)
        expect(taskUsesWorkflowOutsideSteps({ ...openTask, executionMode: 'workflow' })).toBe(true)
    })

    it('accepts a task object that was not built by mapTaskData', () => {
        // `isInboxSummaryGmailTask` reads a task with no `gmailData` KEY as a gmail payload and
        // answers true, which would have refused every hand-built task.
        expect(taskUsesWorkflowOutsideSteps({ id: 'task-1', userIds: ['owner'], stepHistory: [-1] })).toBe(true)
    })

    it('refuses a subtask, because nothing about a subtask travels through the workflow', () => {
        // Its stepHistory is copied from the parent, so it is indistinguishable from a task on a
        // step — and `moveTasksFromDone` would promote it out of its parent.
        expect(taskUsesWorkflowOutsideSteps({ ...openTask, isSubtask: true })).toBe(false)
        expect(taskUsesWorkflowOutsideSteps({ ...openTask, parentId: 'parent-1' })).toBe(false)
    })

    it('refuses a private task, whose first forward move would share it with the reviewer', () => {
        expect(taskUsesWorkflowOutsideSteps({ ...openTask, isPrivate: true })).toBe(false)
    })

    it('refuses the tasks whose checkbox goes straight to Done', () => {
        expect(taskUsesWorkflowOutsideSteps({ ...openTask, executionMode: 'direct' })).toBe(false)
        expect(taskUsesWorkflowOutsideSteps({ ...openTask, genericData: { type: 'dayRateTimeLog' } })).toBe(false)
        expect(taskUsesWorkflowOutsideSteps({ ...openTask, calendarData: { start: 1 } })).toBe(false)
        expect(taskUsesWorkflowOutsideSteps({ ...openTask, gmailData: { messageId: 'gmail-1' } })).toBe(false)
    })

    it('keeps a gmail follow-up task, which is an ordinary task carrying a gmail link', () => {
        expect(
            taskUsesWorkflowOutsideSteps({
                ...openTask,
                gmailData: { messageId: 'gmail-1', origin: 'gmail_label_follow_up' },
            })
        ).toBe(true)
    })

    it('refuses a missing task instead of throwing', () => {
        expect(taskUsesWorkflowOutsideSteps(null)).toBe(false)
        expect(taskUsesWorkflowOutsideSteps(undefined)).toBe(false)
    })
})
