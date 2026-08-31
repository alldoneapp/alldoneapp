jest.mock('./backends/Premium/premiumFirestore', () => ({
    updateQuotaXp: jest.fn(),
}))

jest.mock('../functions/BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn(),
}))

jest.mock('./backends/Users/usersFirestore', () => ({
    getUserData: jest.fn(),
}))

jest.mock('./backends/firestore', () => ({
    runHttpsCallableFunction: jest.fn(),
}))

jest.mock('./HelperFunctions', () => ({
    chronoKeysOrder: jest.fn(),
    getWorkflowStepsIdsSorted: jest.fn(workflow => Object.keys(workflow).sort()),
}))

jest.mock('./EstimationHelper', () => ({
    ESTIMATION_TYPE_POINTS: 'points',
    getEstimationRealValue: jest.fn((_, estimation) => estimation || 0),
}))

const { runHttpsCallableFunction } = require('./backends/firestore')
const {
    getEarnedSkillPoints,
    getLevelUpUserUpdateData,
    updateXpByDoneForAllReviewers,
    updateXpByDoneTask,
} = require('./Levels')

describe('Levels skill point awards', () => {
    const firebase = {
        firestore: {
            FieldValue: {
                increment: jest.fn(value => ({ increment: value })),
            },
        },
    }

    beforeEach(() => {
        firebase.firestore.FieldValue.increment.mockClear()
        runHttpsCallableFunction.mockReset()
    })

    test('awards five skill points for a single level', () => {
        expect(getEarnedSkillPoints(2, 3)).toBe(5)
    })

    test('awards five skill points per level for multi-level gains', () => {
        expect(getEarnedSkillPoints(2, 5)).toBe(15)
    })

    test('writes earned skill points and last level-up timestamp', () => {
        expect(getLevelUpUserUpdateData(2, 4, 84000, firebase, 1710000000000)).toEqual({
            xp: 84000,
            level: 4,
            skillPoints: { increment: 10 },
            showSkillPointsNotification: true,
            newEarnedSkillPoints: { increment: 10 },
            lastSkillPointLevelUpAt: 1710000000000,
        })
    })

    test('awards XP through the authenticated server transaction', async () => {
        runHttpsCallableFunction.mockResolvedValue({ totalXp: 400 })

        await expect(updateXpByDoneTask('user-1', 1, firebase, {}, 'project-1')).resolves.toEqual({ totalXp: 400 })
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('awardXpSecondGen', {
            projectId: 'project-1',
            userId: 'user-1',
            xpEarned: 400,
            increaseProjectQuota: true,
        })
    })

    test('awards reviewer XP only to current human project members', async () => {
        runHttpsCallableFunction.mockResolvedValue({ totalXp: 600 })
        const workflow = {
            'step-1': { reviewerUid: 'member-1' },
            'step-2': { reviewerUid: 'assistant-1', reviewerType: 'assistant' },
            'step-3': { reviewerUid: 'former-member' },
        }

        await updateXpByDoneForAllReviewers(
            { 'step-1': 2, 'step-2': 3, 'step-3': 4 },
            workflow,
            firebase,
            {},
            'project-1',
            ['member-1']
        )

        expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('awardXpSecondGen', {
            projectId: 'project-1',
            userId: 'member-1',
            xpEarned: 600,
            increaseProjectQuota: true,
        })
    })
})
