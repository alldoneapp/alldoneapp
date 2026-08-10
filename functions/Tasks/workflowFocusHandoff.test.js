jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({ doc: jest.fn() })),
}))

const {
    resolveWorkflowStepId,
    hasWorkflowStepChanged,
    getWorkflowFocusHandoffCandidates,
    releaseFocusTaskOnWorkflowStepChange,
} = require('./workflowFocusHandoff')

const OPEN_STEP = -1
const DONE_STEP = -2

const OWNER = 'owner-uid'
const REVIEWER_A = 'reviewer-a-uid'
const REVIEWER_B = 'reviewer-b-uid'
const TASK_ID = 'task-1'
const PROJECT_ID = 'project-1'

const openTask = (overrides = {}) => ({
    userId: OWNER,
    userIds: [OWNER],
    stepHistory: [OPEN_STEP],
    currentReviewerId: OWNER,
    done: false,
    ...overrides,
})

const onFirstStepTask = (overrides = {}) => ({
    userId: OWNER,
    userIds: [OWNER, REVIEWER_A],
    stepHistory: [OPEN_STEP, 'step-1'],
    currentReviewerId: REVIEWER_A,
    done: false,
    ...overrides,
})

describe('resolveWorkflowStepId', () => {
    it('reads the last entry of stepHistory', () => {
        expect(resolveWorkflowStepId(onFirstStepTask())).toBe('step-1')
    })

    it('falls back to Open when stepHistory is missing', () => {
        expect(resolveWorkflowStepId({ userId: OWNER })).toBe(OPEN_STEP)
    })

    // Completing a task sets `done` without pushing onto stepHistory, so stepHistory alone would
    // read a completion as "no step change".
    it('reports Done for a completed task even though stepHistory did not grow', () => {
        expect(resolveWorkflowStepId(openTask({ done: true }))).toBe(DONE_STEP)
    })

    it('returns null for a missing task', () => {
        expect(resolveWorkflowStepId(null)).toBeNull()
    })
})

describe('hasWorkflowStepChanged', () => {
    it('detects a forward move', () => {
        expect(hasWorkflowStepChanged(openTask(), onFirstStepTask())).toBe(true)
    })

    it('detects a completion', () => {
        expect(hasWorkflowStepChanged(openTask(), openTask({ done: true }))).toBe(true)
    })

    it('ignores an edit that leaves the step alone', () => {
        expect(hasWorkflowStepChanged(openTask(), openTask({ name: 'renamed' }))).toBe(false)
    })
})

describe('getWorkflowFocusHandoffCandidates', () => {
    it('hands off the owner when the task moves forward to a reviewer', () => {
        const candidates = getWorkflowFocusHandoffCandidates(openTask(), onFirstStepTask())
        expect(candidates).toEqual([OWNER])
    })

    it('hands off the outgoing reviewer, not the incoming one', () => {
        const oldTask = onFirstStepTask()
        const newTask = {
            userId: OWNER,
            userIds: [OWNER, REVIEWER_A, REVIEWER_B],
            stepHistory: [OPEN_STEP, 'step-1', 'step-2'],
            currentReviewerId: REVIEWER_B,
            done: false,
        }

        const candidates = getWorkflowFocusHandoffCandidates(oldTask, newTask)

        expect(candidates).toContain(REVIEWER_A)
        expect(candidates).toContain(OWNER)
        expect(candidates).not.toContain(REVIEWER_B)
    })

    it('hands off on a backward move, keeping whoever now holds the task', () => {
        const newTask = openTask()
        const candidates = getWorkflowFocusHandoffCandidates(onFirstStepTask(), newTask)

        // The owner is the incoming reviewer of the Open step, so the task it was just handed back
        // to stays their focus; only the reviewer it left loses it.
        expect(candidates).toEqual([REVIEWER_A])
    })

    it('hands off when the task is completed', () => {
        const candidates = getWorkflowFocusHandoffCandidates(
            onFirstStepTask(),
            onFirstStepTask({ done: true, currentReviewerId: DONE_STEP })
        )
        expect(candidates).toEqual([OWNER, REVIEWER_A])
    })

    // The behaviour the ticket depends on: nothing else about a task write may drop the focus task.
    it.each([
        ['a rename', { name: 'a new title' }],
        ['a description edit', { description: 'more detail' }],
        ['an estimation change', { estimations: { [OPEN_STEP]: 30 } }],
        ['a due date change', { dueDate: 1786051512864 }],
        ['a priority change', { priority: 'must_do' }],
        ['an assistant comment stamp', { lastEditionDate: 1786051512864 }],
    ])('does not hand off focus for %s', (_label, changes) => {
        const oldTask = onFirstStepTask()
        expect(getWorkflowFocusHandoffCandidates(oldTask, { ...oldTask, ...changes })).toEqual([])
    })

    // AT-2188: a VM agent asking the user a question parks currentReviewerId WITHOUT moving the
    // step. Reading currentReviewerId as the step would drop the focus task on every question.
    it('does not hand off focus for a VM interaction reviewer hold', () => {
        const oldTask = onFirstStepTask()
        const held = {
            ...oldTask,
            currentReviewerId: OWNER,
            vmInteractionWorkflowStep: { reviewerId: OWNER, previousReviewerId: REVIEWER_A },
        }
        expect(getWorkflowFocusHandoffCandidates(oldTask, held)).toEqual([])
    })

    it('ignores subtasks, which only mirror their parent step', () => {
        const oldTask = openTask({ parentId: 'parent-1' })
        const newTask = onFirstStepTask({ parentId: 'parent-1' })
        expect(getWorkflowFocusHandoffCandidates(oldTask, newTask)).toEqual([])
    })

    it('filters out workstream ids and step sentinels', () => {
        const oldTask = {
            userId: 'ws@stream-1',
            userIds: ['ws@stream-1', OPEN_STEP, DONE_STEP, 'Done', null, undefined],
            stepHistory: [OPEN_STEP],
            currentReviewerId: OPEN_STEP,
            done: false,
        }
        const newTask = { ...oldTask, stepHistory: [OPEN_STEP, 'step-1'], currentReviewerId: REVIEWER_A }

        expect(getWorkflowFocusHandoffCandidates(oldTask, newTask)).toEqual([])
    })

    it('does not repeat a user that appears as both owner and reviewer', () => {
        const oldTask = onFirstStepTask({ userIds: [OWNER, OWNER], currentReviewerId: OWNER })
        const newTask = {
            ...oldTask,
            stepHistory: [OPEN_STEP, 'step-1', 'step-2'],
            currentReviewerId: REVIEWER_B,
        }
        expect(getWorkflowFocusHandoffCandidates(oldTask, newTask)).toEqual([OWNER])
    })
})

describe('releaseFocusTaskOnWorkflowStepChange', () => {
    const buildDeps = (usersById, { replacement = null } = {}) => {
        const focusTaskService = {
            findAndSetNewFocusTask: jest.fn().mockResolvedValue(replacement),
            clearFocusTask: jest.fn().mockResolvedValue({ cleared: true }),
        }
        const database = {
            doc: jest.fn(path => ({
                get: jest.fn().mockResolvedValue({
                    exists: !!usersById[path],
                    data: () => usersById[path],
                }),
            })),
        }
        return { focusTaskService, database }
    }

    it('picks the next focus task for a user who was focusing the moved task', async () => {
        const deps = buildDeps(
            { [`users/${OWNER}`]: { inFocusTaskId: TASK_ID, timezoneOffset: 120 } },
            { replacement: { id: 'next-task' } }
        )

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            openTask(),
            onFirstStepTask({ parentGoalId: 'goal-1' }),
            deps
        )

        expect(released).toEqual([OWNER])
        expect(deps.focusTaskService.findAndSetNewFocusTask).toHaveBeenCalledWith(
            OWNER,
            PROJECT_ID,
            'goal-1',
            TASK_ID,
            expect.anything()
        )
        // A replacement was found, so nothing needs clearing.
        expect(deps.focusTaskService.clearFocusTask).not.toHaveBeenCalled()
    })

    it('clears the focus task when no replacement exists', async () => {
        const deps = buildDeps({ [`users/${OWNER}`]: { inFocusTaskId: TASK_ID } }, { replacement: null })

        await releaseFocusTaskOnWorkflowStepChange(PROJECT_ID, TASK_ID, openTask(), onFirstStepTask(), deps)

        expect(deps.focusTaskService.clearFocusTask).toHaveBeenCalledWith(OWNER, TASK_ID)
    })

    it('leaves alone a user whose focus is a different task', async () => {
        const deps = buildDeps({ [`users/${OWNER}`]: { inFocusTaskId: 'some-other-task' } })

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            openTask(),
            onFirstStepTask(),
            deps
        )

        expect(released).toEqual([])
        expect(deps.focusTaskService.findAndSetNewFocusTask).not.toHaveBeenCalled()
        expect(deps.focusTaskService.clearFocusTask).not.toHaveBeenCalled()
    })

    it('does no work at all when the step did not change', async () => {
        const deps = buildDeps({ [`users/${OWNER}`]: { inFocusTaskId: TASK_ID } })
        const oldTask = onFirstStepTask()

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            oldTask,
            { ...oldTask, name: 'renamed' },
            deps
        )

        expect(released).toEqual([])
        expect(deps.database.doc).not.toHaveBeenCalled()
    })

    it('releases the remaining holders when one of them fails', async () => {
        const deps = buildDeps({
            [`users/${OWNER}`]: { inFocusTaskId: TASK_ID },
            [`users/${REVIEWER_A}`]: { inFocusTaskId: TASK_ID },
        })
        deps.focusTaskService.findAndSetNewFocusTask.mockRejectedValueOnce(new Error('firestore unavailable'))
        jest.spyOn(console, 'error').mockImplementation(() => {})

        const oldTask = onFirstStepTask()
        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            oldTask,
            { ...oldTask, stepHistory: [OPEN_STEP, 'step-1', 'step-2'], currentReviewerId: REVIEWER_B },
            deps
        )

        // The owner blew up; the reviewer still got their handoff.
        expect(released).toEqual([REVIEWER_A])
        console.error.mockRestore()
    })

    it('skips a user document that does not exist', async () => {
        const deps = buildDeps({})

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            openTask(),
            onFirstStepTask(),
            deps
        )

        expect(released).toEqual([])
    })
})

/**
 * AT-2193 (follow-up) — the "incoming reviewer keeps the task" behaviour used to be a hand-reasoned
 * exception. It is now derived from the SAME predicate the focus pickers use
 * (shared/focusTaskEligibility.js), so the release side and the selection side cannot disagree:
 * whoever keeps the task here is exactly whoever the picker would be allowed to hand it to.
 */
describe('getWorkflowFocusHandoffCandidates is governed by focus eligibility', () => {
    const { isTaskOnUserPlate } = require('../shared/focusTaskEligibility')

    it('releases exactly the users the task is no longer actionable for', () => {
        const oldTask = onFirstStepTask()
        const newTask = {
            userId: OWNER,
            userIds: [OWNER, REVIEWER_A, REVIEWER_B],
            stepHistory: [OPEN_STEP, 'step-1', 'step-2'],
            currentReviewerId: REVIEWER_B,
            done: false,
        }

        const candidates = getWorkflowFocusHandoffCandidates(oldTask, newTask)

        // Nobody who is still the current holder may be released...
        candidates.forEach(userId => expect(isTaskOnUserPlate(newTask, userId)).toBe(false))
        // ...and the one person who is still the holder is not in the list.
        expect(isTaskOnUserPlate(newTask, REVIEWER_B)).toBe(true)
        expect(candidates).not.toContain(REVIEWER_B)
    })

    // Previously the candidate list was built only from the OLD task, so a user who had focused the
    // task while being nothing but a later step's reviewer was never even considered.
    it('also considers users that only appear on the destination task', () => {
        const oldTask = openTask()
        const newTask = {
            userId: OWNER,
            userIds: [OWNER, REVIEWER_A, REVIEWER_B],
            stepHistory: [OPEN_STEP, 'step-1'],
            currentReviewerId: REVIEWER_A,
            done: false,
        }

        const candidates = getWorkflowFocusHandoffCandidates(oldTask, newTask)

        expect(candidates).toContain(REVIEWER_B)
        expect(candidates).toContain(OWNER)
        expect(candidates).not.toContain(REVIEWER_A)
    })

    // A completion has no holder at all, so it must release everybody.
    it('releases every participant when the task is completed', () => {
        const oldTask = onFirstStepTask()
        const newTask = onFirstStepTask({ done: true, currentReviewerId: DONE_STEP })

        const candidates = getWorkflowFocusHandoffCandidates(oldTask, newTask)

        expect(candidates).toEqual(expect.arrayContaining([OWNER, REVIEWER_A]))
        expect(candidates).not.toContain(DONE_STEP)
    })
})
