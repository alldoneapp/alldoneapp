import {
    getOptimisticGoalPostponeKey,
    isOptimisticGoalPostponePending,
    OPTIMISTIC_GOAL_POSTPONE_TTL_MS,
} from './optimisticGoalPostpone'

// AT-2160
describe('optimistic goal postpone', () => {
    const NOW = 1786340000000

    test('keys entries per project and goal so two goals can be in flight at once', () => {
        expect(getOptimisticGoalPostponeKey('p1', 'g1')).toBe('p1_g1')
        expect(getOptimisticGoalPostponeKey('p1', 'g1')).not.toBe(getOptimisticGoalPostponeKey('p1', 'g2'))
        expect(getOptimisticGoalPostponeKey('p1', 'g1')).not.toBe(getOptimisticGoalPostponeKey('p2', 'g1'))
    })

    test('a freshly started postpone is pending', () => {
        expect(isOptimisticGoalPostponePending({ date: 1, startedAt: NOW }, NOW)).toBe(true)
        expect(isOptimisticGoalPostponePending({ date: 1, startedAt: NOW }, NOW + 1000)).toBe(true)
    })

    test('nothing is pending without an entry', () => {
        expect(isOptimisticGoalPostponePending(undefined, NOW)).toBe(false)
        expect(isOptimisticGoalPostponePending(null, NOW)).toBe(false)
    })

    // The whole point of the TTL: a postpone whose response never arrives must not leave the goal
    // permanently invisible.
    test('ages out once the TTL has elapsed', () => {
        const entry = { date: 1, startedAt: NOW }
        expect(isOptimisticGoalPostponePending(entry, NOW + OPTIMISTIC_GOAL_POSTPONE_TTL_MS - 1)).toBe(true)
        expect(isOptimisticGoalPostponePending(entry, NOW + OPTIMISTIC_GOAL_POSTPONE_TTL_MS)).toBe(false)
        expect(isOptimisticGoalPostponePending(entry, NOW + OPTIMISTIC_GOAL_POSTPONE_TTL_MS * 10)).toBe(false)
    })

    test('a clock that jumped backwards cannot extend the hide', () => {
        expect(isOptimisticGoalPostponePending({ date: 1, startedAt: NOW + 60000 }, NOW)).toBe(false)
    })

    test('a malformed entry is never pending', () => {
        expect(isOptimisticGoalPostponePending({ date: 1 }, NOW)).toBe(false)
        expect(isOptimisticGoalPostponePending({ date: 1, startedAt: 'soon' }, NOW)).toBe(false)
        expect(isOptimisticGoalPostponePending({ date: 1, startedAt: NaN }, NOW)).toBe(false)
    })
})
