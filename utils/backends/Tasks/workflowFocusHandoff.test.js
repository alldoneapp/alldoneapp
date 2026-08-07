import { shouldReleaseFocusOnWorkflowMove } from './workflowFocusHandoff'

const TASK_ID = 'task-1'
const LOGGED_USER = 'logged-user-uid'
const OTHER_USER = 'other-user-uid'

describe('shouldReleaseFocusOnWorkflowMove', () => {
    it('releases focus when the logged user was focusing the task that moved on', () => {
        expect(
            shouldReleaseFocusOnWorkflowMove({
                taskId: TASK_ID,
                focusUserId: LOGGED_USER,
                observedFocusTaskIds: [TASK_ID],
                incomingReviewerId: OTHER_USER,
            })
        ).toBe(true)
    })

    // The task just landed on their plate, which is the opposite of it leaving. This is also what
    // keeps a backward move to Open from un-focusing the owner it was handed back to.
    it('keeps focus for the user the task is moving to', () => {
        expect(
            shouldReleaseFocusOnWorkflowMove({
                taskId: TASK_ID,
                focusUserId: LOGGED_USER,
                observedFocusTaskIds: [TASK_ID],
                incomingReviewerId: LOGGED_USER,
            })
        ).toBe(false)
    })

    // The guarantee that unrelated activity never disturbs the focus task.
    it('does not release focus when a different task moved', () => {
        expect(
            shouldReleaseFocusOnWorkflowMove({
                taskId: 'some-other-task',
                focusUserId: LOGGED_USER,
                observedFocusTaskIds: [TASK_ID],
                incomingReviewerId: OTHER_USER,
            })
        ).toBe(false)
    })

    it('does not release focus when the user has no focus task', () => {
        expect(
            shouldReleaseFocusOnWorkflowMove({
                taskId: TASK_ID,
                focusUserId: LOGGED_USER,
                observedFocusTaskIds: ['', null, undefined],
                incomingReviewerId: OTHER_USER,
            })
        ).toBe(false)
    })

    // The logged user's focus is mirrored in the loggedUser slice and in the project member list;
    // either one reporting the task is enough, because they can lag behind each other.
    it('releases focus when only one of the mirrored sources reports the task', () => {
        expect(
            shouldReleaseFocusOnWorkflowMove({
                taskId: TASK_ID,
                focusUserId: LOGGED_USER,
                observedFocusTaskIds: [null, TASK_ID],
                incomingReviewerId: OTHER_USER,
            })
        ).toBe(true)
    })

    it('handles a signed-out or unknown user without throwing', () => {
        expect(
            shouldReleaseFocusOnWorkflowMove({
                taskId: TASK_ID,
                focusUserId: null,
                observedFocusTaskIds: [TASK_ID],
            })
        ).toBe(false)
    })

    it('handles a task with no id', () => {
        expect(
            shouldReleaseFocusOnWorkflowMove({
                taskId: undefined,
                focusUserId: LOGGED_USER,
                observedFocusTaskIds: [undefined],
            })
        ).toBe(false)
    })

    it('defaults its arguments so a bare call is safe', () => {
        expect(shouldReleaseFocusOnWorkflowMove()).toBe(false)
    })
})
