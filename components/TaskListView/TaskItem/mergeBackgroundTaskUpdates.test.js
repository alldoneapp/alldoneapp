import { mergeBackgroundTaskUpdates } from './mergeBackgroundTaskUpdates'

const openedTask = () => ({
    id: 'task-1',
    name: 'buy milk',
    extendedName: 'buy milk',
    parentGoalId: null,
    parentGoalIsPublicFor: null,
    lockKey: '',
    dueDate: 100,
    priority: 'none',
    userId: 'user-1',
    estimations: { open: 2 },
    subtaskIds: [],
})

/** The same task after an assistant assigned it a goal while the editor was open. */
const remoteWithGoal = () => ({
    ...openedTask(),
    parentGoalId: 'goal-1',
    parentGoalIsPublicFor: [0],
    lockKey: 'lock-1',
    sortIndex: 42,
    lastEditionDate: 999,
})

describe('mergeBackgroundTaskUpdates', () => {
    it('AT-2267: keeps a goal assigned in the background when the user saves a new title', () => {
        const edited = { ...openedTask(), name: 'buy oat milk', extendedName: 'buy oat milk' }

        const merged = mergeBackgroundTaskUpdates(openedTask(), edited, remoteWithGoal())

        expect(merged.extendedName).toBe('buy oat milk')
        expect(merged.name).toBe('buy oat milk')
        expect(merged.parentGoalId).toBe('goal-1')
        expect(merged.parentGoalIsPublicFor).toEqual([0])
        expect(merged.lockKey).toBe('lock-1')
    })

    it('keeps fields the live document gained while the editor was open', () => {
        const edited = { ...openedTask(), extendedName: 'typed' }

        const merged = mergeBackgroundTaskUpdates(openedTask(), edited, remoteWithGoal())

        expect(merged.sortIndex).toBe(42)
        expect(merged.lastEditionDate).toBe(999)
    })

    it('lets the user win on a field they actually changed, even if it also changed remotely', () => {
        const edited = { ...openedTask(), dueDate: 555 }
        const remote = { ...remoteWithGoal(), dueDate: 777 }

        expect(mergeBackgroundTaskUpdates(openedTask(), edited, remote).dueDate).toBe(555)
    })

    it('takes the remote value for a field the user never touched', () => {
        const edited = { ...openedTask(), extendedName: 'typed' }
        const remote = { ...remoteWithGoal(), priority: 'must_do' }

        expect(mergeBackgroundTaskUpdates(openedTask(), edited, remote).priority).toBe('must_do')
    })

    it('compares deeply, so an untouched object field does not look edited', () => {
        const edited = { ...openedTask(), estimations: { open: 2 } }
        const remote = { ...remoteWithGoal(), estimations: { open: 2, review: 5 } }

        expect(mergeBackgroundTaskUpdates(openedTask(), edited, remote).estimations).toEqual({ open: 2, review: 5 })
    })

    it('carries a deep edit through', () => {
        const edited = { ...openedTask(), estimations: { open: 8 } }
        const remote = { ...remoteWithGoal(), estimations: { open: 2, review: 5 } }

        expect(mergeBackgroundTaskUpdates(openedTask(), edited, remote).estimations).toEqual({ open: 8 })
    })

    it('is a no-op when nothing changed in the background', () => {
        const edited = { ...openedTask(), extendedName: 'typed' }

        expect(mergeBackgroundTaskUpdates(openedTask(), edited, openedTask()).extendedName).toBe('typed')
    })

    it('falls back to the edited task when there is nothing to merge against', () => {
        const edited = { ...openedTask(), extendedName: 'typed' }

        // `adding` mode has no opened task, and a missing live task means there is no newer truth.
        expect(mergeBackgroundTaskUpdates(null, edited, remoteWithGoal())).toBe(edited)
        expect(mergeBackgroundTaskUpdates(openedTask(), edited, null)).toBe(edited)
        expect(mergeBackgroundTaskUpdates(openedTask(), null, remoteWithGoal())).toBeNull()
    })
})
