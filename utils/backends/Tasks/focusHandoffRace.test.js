import {
    buildFocusCandidateExclusions,
    finishFocusHandoff,
    isFocusHandoffSuperseded,
    isFocusTaskReleased,
    isTaskHoldingFocus,
    readOptimisticFocus,
    resetFocusHandoffTracking,
    startFocusHandoff,
    supersedeFocusHandoffs,
} from './focusHandoffRace'

const PROJECT_ID = 'project-1'
const OTHER_PROJECT_ID = 'project-2'
const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'

const optimistic = overrides => ({
    active: true,
    taskId: null,
    projectId: PROJECT_ID,
    userId: USER_ID,
    ...overrides,
})

beforeEach(resetFocusHandoffTracking)

describe('isTaskHoldingFocus', () => {
    it('accepts the task the backend has confirmed as focused', () => {
        expect(
            isTaskHoldingFocus({
                taskId: 'task-a',
                projectId: PROJECT_ID,
                focusUserId: USER_ID,
                confirmedFocusTaskId: 'task-a',
                optimisticFocus: optimistic({ active: false }),
            })
        ).toBe(true)
    })

    // The bug in one assertion: mid-burst the confirmed value still names the FIRST postponed task,
    // and only the optimistic slice knows what the user is actually looking at.
    it('accepts the optimistically focused task while the confirmed value still lags behind', () => {
        expect(
            isTaskHoldingFocus({
                taskId: 'task-b',
                projectId: PROJECT_ID,
                focusUserId: USER_ID,
                confirmedFocusTaskId: 'task-a',
                optimisticFocus: optimistic({ taskId: 'task-b' }),
            })
        ).toBe(true)
    })

    it('rejects a task that neither mirror reports as focused', () => {
        expect(
            isTaskHoldingFocus({
                taskId: 'task-c',
                projectId: PROJECT_ID,
                focusUserId: USER_ID,
                confirmedFocusTaskId: 'task-a',
                optimisticFocus: optimistic({ taskId: 'task-b' }),
            })
        ).toBe(false)
    })

    it('ignores the optimistic slice once it has been cleared', () => {
        expect(
            isTaskHoldingFocus({
                taskId: 'task-b',
                projectId: PROJECT_ID,
                focusUserId: USER_ID,
                confirmedFocusTaskId: 'task-a',
                optimisticFocus: optimistic({ taskId: 'task-b', active: false }),
            })
        ).toBe(false)
    })

    // A swap in one project must not make a same-id task elsewhere look focused.
    it('does not match an optimistic focus belonging to another project', () => {
        expect(
            isTaskHoldingFocus({
                taskId: 'task-b',
                projectId: OTHER_PROJECT_ID,
                focusUserId: USER_ID,
                confirmedFocusTaskId: null,
                optimisticFocus: optimistic({ taskId: 'task-b' }),
            })
        ).toBe(false)
    })

    it('does not match an optimistic focus belonging to another user', () => {
        expect(
            isTaskHoldingFocus({
                taskId: 'task-b',
                projectId: PROJECT_ID,
                focusUserId: OTHER_USER_ID,
                confirmedFocusTaskId: null,
                optimisticFocus: optimistic({ taskId: 'task-b' }),
            })
        ).toBe(false)
    })

    // Dispatches that predate the userId/projectId fields must keep working.
    it('treats a missing project or user on the optimistic slice as unknown rather than a mismatch', () => {
        expect(
            isTaskHoldingFocus({
                taskId: 'task-b',
                projectId: PROJECT_ID,
                focusUserId: USER_ID,
                confirmedFocusTaskId: null,
                optimisticFocus: optimistic({ taskId: 'task-b', projectId: null, userId: null }),
            })
        ).toBe(true)
    })

    it('rejects an "optimistically no focus at all" state', () => {
        expect(
            isTaskHoldingFocus({
                taskId: 'task-b',
                projectId: PROJECT_ID,
                focusUserId: USER_ID,
                confirmedFocusTaskId: null,
                optimisticFocus: optimistic({ taskId: null }),
            })
        ).toBe(false)
    })

    it('handles a missing task id and a bare call without throwing', () => {
        expect(isTaskHoldingFocus({ taskId: null, confirmedFocusTaskId: null })).toBe(false)
        expect(isTaskHoldingFocus()).toBe(false)
    })
})

describe('readOptimisticFocus', () => {
    it('normalizes the Redux slice', () => {
        expect(
            readOptimisticFocus({
                optimisticFocusActive: true,
                optimisticFocusTaskId: 'task-b',
                optimisticFocusTaskProjectId: PROJECT_ID,
                optimisticFocusUserId: USER_ID,
            })
        ).toEqual({ active: true, taskId: 'task-b', projectId: PROJECT_ID, userId: USER_ID })
    })

    it('survives an empty or absent state', () => {
        expect(readOptimisticFocus()).toEqual({ active: false, taskId: null, projectId: null, userId: null })
    })
})

describe('handoff sequencing', () => {
    it('lets a single handoff write', () => {
        const handoffId = startFocusHandoff('task-a')
        expect(isFocusHandoffSuperseded(handoffId)).toBe(false)
    })

    // The core of defect 2: postpone #1's backend search must not write once postpone #2 exists.
    it('supersedes an older handoff as soon as a newer one opens', () => {
        const first = startFocusHandoff('task-a')
        const second = startFocusHandoff('task-b')

        expect(isFocusHandoffSuperseded(first)).toBe(true)
        expect(isFocusHandoffSuperseded(second)).toBe(false)
    })

    it('keeps only the newest of three consecutive handoffs alive', () => {
        const ids = [startFocusHandoff('task-a'), startFocusHandoff('task-b'), startFocusHandoff('task-c')]

        expect(ids.map(isFocusHandoffSuperseded)).toEqual([true, true, false])
    })

    // A manual focus pick outranks any postpone whose search is still running.
    it('supersedeFocusHandoffs invalidates everything in flight without opening a handoff', () => {
        const handoffId = startFocusHandoff('task-a')
        supersedeFocusHandoffs()

        expect(isFocusHandoffSuperseded(handoffId)).toBe(true)
    })

    // Callers that never opted into sequencing keep their old behaviour instead of never writing.
    it('never reports an untracked caller as superseded', () => {
        startFocusHandoff('task-a')

        expect(isFocusHandoffSuperseded(null)).toBe(false)
        expect(isFocusHandoffSuperseded(undefined)).toBe(false)
    })
})

describe('released-task exclusions', () => {
    it('excludes every task released by the burst, not just the last one', () => {
        startFocusHandoff('task-a')
        startFocusHandoff('task-b')

        expect(isFocusTaskReleased('task-a')).toBe(true)
        expect(isFocusTaskReleased('task-b')).toBe(true)
        expect(isFocusTaskReleased('task-c')).toBe(false)
    })

    it('merges the caller-supplied exclusion into the released set', () => {
        startFocusHandoff('task-a')

        expect([...buildFocusCandidateExclusions('task-b')].sort()).toEqual(['task-a', 'task-b'])
    })

    it('tolerates a handoff opened without a released task', () => {
        const handoffId = startFocusHandoff()

        expect([...buildFocusCandidateExclusions(null)]).toEqual([])
        expect(isFocusHandoffSuperseded(handoffId)).toBe(false)
    })

    it('keeps the exclusions while any handoff of the burst is still open', () => {
        const first = startFocusHandoff('task-a')
        startFocusHandoff('task-b')

        finishFocusHandoff(first)

        expect(isFocusTaskReleased('task-a')).toBe(true)
    })

    it('drops the exclusions once the whole burst has settled', () => {
        const first = startFocusHandoff('task-a')
        const second = startFocusHandoff('task-b')

        finishFocusHandoff(first)
        finishFocusHandoff(second)

        expect(isFocusTaskReleased('task-a')).toBe(false)
        expect(isFocusTaskReleased('task-b')).toBe(false)
    })

    it('ignores a duplicate or unknown settle', () => {
        const first = startFocusHandoff('task-a')
        startFocusHandoff('task-b')

        finishFocusHandoff(first)
        finishFocusHandoff(first)
        finishFocusHandoff(9999)

        // task-b's handoff is still open, so nothing may have been dropped yet.
        expect(isFocusTaskReleased('task-a')).toBe(true)
    })

    // A commit that throws between startFocusHandoff and finishFocusHandoff leaks the handoff.
    // Later bursts must still be able to settle, or the leaked task stays unfocusable all session.
    it('recovers from a leaked handoff once enough later ones have settled', () => {
        startFocusHandoff('task-leaked') // never settled

        for (let index = 0; index < 25; index += 1) finishFocusHandoff(startFocusHandoff(`task-${index}`))

        expect(isFocusTaskReleased('task-leaked')).toBe(false)
        expect(buildFocusCandidateExclusions().size).toBe(0)
    })

    // Safety valve: a handoff that somehow never settles must not pin the set open unboundedly.
    it('caps the released set so a leaked handoff cannot grow it forever', () => {
        startFocusHandoff('task-keeper')
        for (let index = 0; index < 60; index += 1) startFocusHandoff(`task-${index}`)

        expect(buildFocusCandidateExclusions().size).toBeLessThanOrEqual(50)
        expect(isFocusTaskReleased('task-keeper')).toBe(false)
        expect(isFocusTaskReleased('task-59')).toBe(true)
    })
})

// The exact sequence from the ticket, at the level of the rules that decide it.
describe('AT-2191 scenario — three postponements before any confirmation', () => {
    it('treats each newly focused task as focused, and keeps the earlier ones excluded', () => {
        let confirmedFocusTaskId = 'task-a'
        let optimisticFocus = optimistic({ taskId: 'task-a' })

        const postpone = taskId => {
            const holdsFocus = isTaskHoldingFocus({
                taskId,
                projectId: PROJECT_ID,
                focusUserId: USER_ID,
                confirmedFocusTaskId,
                optimisticFocus,
            })
            if (!holdsFocus) return null

            const handoffId = startFocusHandoff(taskId)
            const exclusions = buildFocusCandidateExclusions(taskId)
            const next = ['task-a', 'task-b', 'task-c', 'task-d'].find(id => !exclusions.has(id)) || null
            optimisticFocus = optimistic({ taskId: next })
            return { handoffId, next }
        }

        const first = postpone('task-a')
        expect(first.next).toBe('task-b')

        // Nothing has confirmed: users/{uid}.inFocusTaskId is still task-a.
        expect(confirmedFocusTaskId).toBe('task-a')

        const second = postpone('task-b')
        expect(second).not.toBeNull()
        expect(second.next).toBe('task-c')

        const third = postpone('task-c')
        expect(third).not.toBeNull()
        expect(third.next).toBe('task-d')

        // Only the last search may write.
        expect(isFocusHandoffSuperseded(first.handoffId)).toBe(true)
        expect(isFocusHandoffSuperseded(second.handoffId)).toBe(true)
        expect(isFocusHandoffSuperseded(third.handoffId)).toBe(false)
    })
})
