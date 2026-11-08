'use strict'

// Security audit 2026-11 (low): feed state was one process-wide object. Two guide copies served by
// the same instance overwrote each other's feed creator, project and members between their awaits,
// so guide A's tasks were followed by guide B's user.

const { getGlobalState, loadFeedsGlobalState, runWithFeedsState } = require('./globalState')

const tick = ms => new Promise(resolve => setTimeout(resolve, ms))

describe('runWithFeedsState', () => {
    test('interleaved invocations each read back their own state after awaits', async () => {
        const seen = {}
        const copy = (uid, projectId, loadDelay, readDelay) =>
            runWithFeedsState(async () => {
                await tick(loadDelay)
                loadFeedsGlobalState('admin', 'appAdmin', { uid }, { id: projectId }, [{ uid }], { uid: 'creator' })
                await tick(readDelay)
                const { feedCreator, project, users } = getGlobalState()
                seen[uid] = { creator: feedCreator.uid, project: project.id, users: users.map(u => u.uid) }
            })

        // A loads first and reads last; B loads while A is waiting.
        await Promise.all([copy('userA', 'guideA', 0, 30), copy('userB', 'guideB', 10, 0)])

        expect(seen.userA).toEqual({ creator: 'userA', project: 'guideA', users: ['userA'] })
        expect(seen.userB).toEqual({ creator: 'userB', project: 'guideB', users: ['userB'] })
    })

    test('an invocation starts with no state, even after another one loaded some', async () => {
        loadFeedsGlobalState('admin', 'appAdmin', { uid: 'shared' }, { id: 'p' }, [], null)
        const inside = await runWithFeedsState(async () => getGlobalState())
        expect(inside).toEqual({})
        expect(getGlobalState().feedCreator).toEqual({ uid: 'shared' })
    })
})
