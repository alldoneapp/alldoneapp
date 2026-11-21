jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({ doc: jest.fn() })),
}))

const {
    resolveWorkflowStepId,
    hasWorkflowStepChanged,
    hasFocusHolderChanged,
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
    // step. The asked user must keep the task (it is on their plate now). AT-3124: the reviewer it
    // was taken from can no longer see it in their list, so only they are a candidate.
    it('keeps the task with the asked user when a VM interaction hold starts', () => {
        const oldTask = onFirstStepTask()
        const held = {
            ...oldTask,
            currentReviewerId: OWNER,
            vmInteractionWorkflowStep: { reviewerId: OWNER, previousReviewerId: REVIEWER_A },
        }
        expect(getWorkflowFocusHandoffCandidates(oldTask, held)).toEqual([REVIEWER_A])
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
            expect.anything(),
            null,
            { expectedCurrentFocusTaskId: TASK_ID }
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

        // The owner's pick blew up, so their focus was cleared instead (AT-3124: never leave a hidden
        // focus task behind); the reviewer still got their normal handoff.
        expect(deps.focusTaskService.clearFocusTask).toHaveBeenCalledWith(OWNER, TASK_ID)
        expect(released).toEqual([OWNER, REVIEWER_A])
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

/**
 * AT-2251 — completing the focus task is the transition the ticket is about.
 *
 * The client picks the replacement optimistically the moment the checkbox is ticked, and this
 * trigger picks one too. They must agree, and where they cannot, the client's pick — the one the
 * user is already looking at — must win.
 */
describe('completing the focus task hands over deterministically (AT-2251)', () => {
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

    // Completing writes done:true and hands the task to the Done step, which is what makes the
    // handoff fire at all (resolveWorkflowStepId maps done:true to DONE_STEP).
    const completedTask = (overrides = {}) => ({
        userId: OWNER,
        userIds: [OWNER],
        stepHistory: [OPEN_STEP],
        currentReviewerId: 'Done',
        done: true,
        ...overrides,
    })

    it('asks for a replacement without requesting a random one', async () => {
        const deps = buildDeps(
            { [`users/${OWNER}`]: { inFocusTaskId: TASK_ID, timezoneOffset: 120 } },
            { replacement: { id: 'next-task' } }
        )

        await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            openTask(),
            completedTask({ parentGoalId: 'goal-1' }),
            deps
        )

        const options = deps.focusTaskService.findAndSetNewFocusTask.mock.calls[0][6] || {}

        // The completed task is excluded from the candidates, and that exclusion must NOT be read
        // as "spread across the top 10" — that is what made this pick disagree with the client's.
        expect(deps.focusTaskService.findAndSetNewFocusTask.mock.calls[0][3]).toBe(TASK_ID)
        expect(options.spreadAcrossTopCandidates).toBeFalsy()
    })

    it('makes its write conditional on the focus not having moved on', async () => {
        const deps = buildDeps({ [`users/${OWNER}`]: { inFocusTaskId: TASK_ID } }, { replacement: { id: 'next-task' } })

        await releaseFocusTaskOnWorkflowStepChange(PROJECT_ID, TASK_ID, openTask(), completedTask(), deps)

        const options = deps.focusTaskService.findAndSetNewFocusTask.mock.calls[0][6] || {}
        expect(options.expectedCurrentFocusTaskId).toBe(TASK_ID)
    })

    it('does nothing when the client already swapped the focus task before the trigger ran', async () => {
        // The user's focus already points at the client's pick, so there is nothing to release.
        const deps = buildDeps({ [`users/${OWNER}`]: { inFocusTaskId: 'client-already-picked-this' } })

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            openTask(),
            completedTask(),
            deps
        )

        expect(released).toEqual([])
        expect(deps.focusTaskService.findAndSetNewFocusTask).not.toHaveBeenCalled()
        expect(deps.focusTaskService.clearFocusTask).not.toHaveBeenCalled()
    })

    it('still clears the focus task when completing it leaves nothing to pick', async () => {
        const deps = buildDeps({ [`users/${OWNER}`]: { inFocusTaskId: TASK_ID } }, { replacement: null })

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            openTask(),
            completedTask(),
            deps
        )

        expect(released).toEqual([OWNER])
        expect(deps.focusTaskService.clearFocusTask).toHaveBeenCalledWith(OWNER, TASK_ID)
    })
})

/**
 * AT-3124 — the focus task must be replaced whenever a change makes it disappear from the user's
 * list, not only when its workflow step changes.
 *
 * Reproduced from production (2026-11-21): AT-3123 sat in an AI step with the assistant as reviewer.
 * The VM agent asked Karsten a question, so the AT-2188 hold made him the reviewer without changing
 * the step. The picker then (correctly) chose it as his next focus task. When he answered, the hold
 * gave the task back to the assistant — same step — and nothing released his focus, so it stayed on
 * a task he could no longer see.
 */
describe('a focus task that leaves the user without a step change (AT-3124)', () => {
    const ASSISTANT = 'assistant-id'
    const OTHER_USER = 'other-user-uid'
    const AI_STEP = 'ai-step'

    // The task while the assistant works on its step.
    const withAssistant = (overrides = {}) => ({
        userId: OWNER,
        userIds: [OWNER, ASSISTANT],
        stepHistory: [OPEN_STEP, AI_STEP],
        currentReviewerId: ASSISTANT,
        vmInteractionWorkflowStep: null,
        done: false,
        ...overrides,
    })

    // The same task while the agent's question to the owner is open.
    const heldForOwner = (overrides = {}) =>
        withAssistant({
            currentReviewerId: OWNER,
            vmInteractionWorkflowStep: {
                correlationId: 'vm-1',
                requestId: 'req-1',
                reviewerId: OWNER,
                previousReviewerId: ASSISTANT,
                workflowStepId: AI_STEP,
                reason: 'interaction',
            },
            ...overrides,
        })

    const buildDeps = (usersById, { replacement = null, pickError = null } = {}) => {
        const focusTaskService = {
            findAndSetNewFocusTask: pickError
                ? jest.fn().mockRejectedValue(pickError)
                : jest.fn().mockResolvedValue(replacement),
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

    describe('hasFocusHolderChanged', () => {
        it('detects a reviewer change on the same step', () => {
            expect(hasWorkflowStepChanged(heldForOwner(), withAssistant())).toBe(false)
            expect(hasFocusHolderChanged(heldForOwner(), withAssistant())).toBe(true)
        })

        it('detects an owner change', () => {
            expect(hasFocusHolderChanged(openTask(), openTask({ userId: OTHER_USER }))).toBe(true)
        })

        it('still detects a step change', () => {
            expect(hasFocusHolderChanged(openTask(), onFirstStepTask())).toBe(true)
        })

        it('treats missing, null and empty reviewers as the same', () => {
            const legacy = openTask({ currentReviewerId: undefined })
            expect(hasFocusHolderChanged(legacy, { ...legacy, currentReviewerId: null })).toBe(false)
            expect(hasFocusHolderChanged(legacy, { ...legacy, currentReviewerId: '' })).toBe(false)
        })

        it('ignores unrelated edits', () => {
            const task = withAssistant()
            expect(hasFocusHolderChanged(task, { ...task, name: 'renamed', lastEditionDate: 1 })).toBe(false)
        })
    })

    it('reproduction: answering the agent question hands the owner a new visible focus task', async () => {
        const deps = buildDeps(
            { [`users/${OWNER}`]: { inFocusTaskId: TASK_ID } },
            { replacement: { id: 'visible-task', projectId: PROJECT_ID } }
        )

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            heldForOwner(),
            withAssistant({ parentGoalId: 'goal-1' }),
            deps
        )

        expect(released).toEqual([OWNER])
        // The canonical picker chooses the replacement (it filters by isTaskOnUserPlate), with the
        // task that left excluded and the write conditional on the focus still being that task.
        expect(deps.focusTaskService.findAndSetNewFocusTask).toHaveBeenCalledWith(
            OWNER,
            PROJECT_ID,
            'goal-1',
            TASK_ID,
            expect.anything(),
            null,
            { expectedCurrentFocusTaskId: TASK_ID }
        )
        expect(deps.focusTaskService.clearFocusTask).not.toHaveBeenCalled()
    })

    it('clears the focus when no visible replacement exists', async () => {
        const deps = buildDeps({ [`users/${OWNER}`]: { inFocusTaskId: TASK_ID } }, { replacement: null })

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            heldForOwner(),
            withAssistant(),
            deps
        )

        expect(released).toEqual([OWNER])
        expect(deps.focusTaskService.clearFocusTask).toHaveBeenCalledWith(OWNER, TASK_ID)
    })

    it('clears the focus when picking a replacement fails, rather than leaving a hidden focus task', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {})
        const deps = buildDeps(
            { [`users/${OWNER}`]: { inFocusTaskId: TASK_ID } },
            { pickError: new Error('firestore unavailable') }
        )

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            heldForOwner(),
            withAssistant(),
            deps
        )

        expect(deps.focusTaskService.clearFocusTask).toHaveBeenCalledWith(OWNER, TASK_ID)
        expect(released).toEqual([OWNER])
        console.error.mockRestore()
    })

    it('keeps the focus of the asked user when the agent question starts', async () => {
        // Only the owner has a user document; the assistant never has a focus task.
        const deps = buildDeps({ [`users/${OWNER}`]: { inFocusTaskId: TASK_ID } })

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            withAssistant(),
            heldForOwner(),
            deps
        )

        expect(released).toEqual([])
        expect(deps.database.doc).not.toHaveBeenCalledWith(`users/${OWNER}`)
        expect(deps.focusTaskService.findAndSetNewFocusTask).not.toHaveBeenCalled()
        expect(deps.focusTaskService.clearFocusTask).not.toHaveBeenCalled()
    })

    it('leaves the owner alone when their focus is a different task', async () => {
        const deps = buildDeps({ [`users/${OWNER}`]: { inFocusTaskId: 'some-other-task' } })

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            heldForOwner(),
            withAssistant(),
            deps
        )

        expect(released).toEqual([])
        expect(deps.focusTaskService.findAndSetNewFocusTask).not.toHaveBeenCalled()
        expect(deps.focusTaskService.clearFocusTask).not.toHaveBeenCalled()
    })

    it('does nothing for writes that keep the task with the same reviewer and owner', async () => {
        const deps = buildDeps({ [`users/${OWNER}`]: { inFocusTaskId: TASK_ID } })
        const task = heldForOwner()

        const released = await releaseFocusTaskOnWorkflowStepChange(
            PROJECT_ID,
            TASK_ID,
            task,
            { ...task, name: 'renamed' },
            deps
        )

        expect(released).toEqual([])
        expect(deps.database.doc).not.toHaveBeenCalled()
    })

    it('hands the old owner a new focus task when the task is reassigned', async () => {
        const deps = buildDeps(
            {
                [`users/${OWNER}`]: { inFocusTaskId: TASK_ID },
                [`users/${OTHER_USER}`]: { inFocusTaskId: 'their-own-task' },
            },
            { replacement: { id: 'next-task' } }
        )
        // setTaskAssignee: new owner, new reviewer, workflow reset to Open (same step for an Open task).
        const reassigned = openTask({ userId: OTHER_USER, userIds: [OTHER_USER], currentReviewerId: OTHER_USER })

        const released = await releaseFocusTaskOnWorkflowStepChange(PROJECT_ID, TASK_ID, openTask(), reassigned, deps)

        expect(released).toEqual([OWNER])
        expect(deps.focusTaskService.findAndSetNewFocusTask).toHaveBeenCalledTimes(1)
        expect(deps.focusTaskService.findAndSetNewFocusTask.mock.calls[0][0]).toBe(OWNER)
        // The new owner now has the task on their plate and is never touched.
        expect(deps.database.doc).not.toHaveBeenCalledWith(`users/${OTHER_USER}`)
    })

    it('hands a human reviewer a new focus task when a hold takes the task away from them', () => {
        // A VM question asked to the owner while a human reviewer held the step.
        const oldTask = onFirstStepTask()
        const held = { ...oldTask, currentReviewerId: OWNER }

        expect(getWorkflowFocusHandoffCandidates(oldTask, held)).toEqual([REVIEWER_A])
    })
})
