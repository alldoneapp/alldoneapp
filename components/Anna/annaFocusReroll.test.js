import { getSkippedFocusTaskIds, rerollFocusTask, resetFocusRerollSession } from './annaFocusReroll'

jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({ pickDifferentFocusTask: jest.fn() }))

/**
 * A pick over today's tasks in display order: the first one that is neither the current task nor
 * skipped. Mirrors pickDifferentFocusTask's contract without Firestore.
 */
const pickOver = tasks =>
    jest.fn(async (userId, { taskId, skippedTaskIds }) => {
        const next = tasks.find(id => id !== taskId && !skippedTaskIds.includes(id))
        return next ? 'picked' : 'none'
    })

beforeEach(() => resetFocusRerollSession())

describe('AT-3067: a different focus task, click after click', () => {
    it('remembers every task passed over, so repeated clicks walk through all of them', async () => {
        const pick = pickOver(['a', 'b', 'c'])
        await rerollFocusTask({ userId: 'u1', taskId: 'a', projectId: 'p1', pick })
        await rerollFocusTask({ userId: 'u1', taskId: 'b', projectId: 'p1', pick })
        expect(pick.mock.calls.map(([, options]) => options.skippedTaskIds)).toEqual([[], ['a']])
        expect(getSkippedFocusTaskIds()).toEqual(['a', 'b'])
    })

    it('starts over once every task for today has been shown', async () => {
        const pick = pickOver(['a', 'b', 'c'])
        await rerollFocusTask({ userId: 'u1', taskId: 'a', projectId: 'p1', pick })
        await rerollFocusTask({ userId: 'u1', taskId: 'b', projectId: 'p1', pick })
        pick.mockClear()

        // On c with a and b skipped nothing is left: start over, excluding only the current task.
        await expect(rerollFocusTask({ userId: 'u1', taskId: 'c', projectId: 'p1', pick })).resolves.toEqual({
            status: 'picked',
            startedOver: true,
        })
        expect(pick.mock.calls.map(([, options]) => options.skippedTaskIds)).toEqual([['a', 'b'], []])
        expect(getSkippedFocusTaskIds()).toEqual(['c'])
    })

    it('says none when the current task is the only one, without a second search', async () => {
        const pick = pickOver(['a'])
        await expect(rerollFocusTask({ userId: 'u1', taskId: 'a', projectId: 'p1', pick })).resolves.toEqual({
            status: 'none',
            startedOver: false,
        })
        expect(pick).toHaveBeenCalledTimes(1)
        expect(getSkippedFocusTaskIds()).toEqual([])
    })

    it('never sends the current task as skipped, even when it was passed over before', async () => {
        const pick = pickOver(['a', 'b', 'c'])
        await rerollFocusTask({ userId: 'u1', taskId: 'a', projectId: 'p1', pick })
        // The user focused a again by hand; the next click must not exclude it twice or reset.
        await rerollFocusTask({ userId: 'u1', taskId: 'a', projectId: 'p1', pick })
        expect(pick.mock.calls[1][1].skippedTaskIds).toEqual([])
    })

    it('runs one swap at a time', async () => {
        let finish
        const pick = jest.fn(() => new Promise(resolve => (finish = resolve)))
        const first = rerollFocusTask({ userId: 'u1', taskId: 'a', projectId: 'p1', pick })
        await expect(rerollFocusTask({ userId: 'u1', taskId: 'a', projectId: 'p1', pick })).resolves.toEqual({
            status: 'busy',
            startedOver: false,
        })
        expect(pick).toHaveBeenCalledTimes(1)
        finish('picked')
        await first
        // Free again afterwards, also after a failure.
        pick.mockRejectedValueOnce(new Error('boom'))
        await expect(rerollFocusTask({ userId: 'u1', taskId: 'b', projectId: 'p1', pick })).rejects.toThrow('boom')
        pick.mockResolvedValueOnce('picked')
        await expect(rerollFocusTask({ userId: 'u1', taskId: 'b', projectId: 'p1', pick })).resolves.toMatchObject({
            status: 'picked',
        })
    })

    it('does not remember a task the swap did not replace', async () => {
        const pick = jest.fn().mockResolvedValue('superseded')
        await rerollFocusTask({ userId: 'u1', taskId: 'a', projectId: 'p1', pick })
        expect(getSkippedFocusTaskIds()).toEqual([])
    })
})
