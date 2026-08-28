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
}))

jest.mock('./EstimationHelper', () => ({
    ESTIMATION_TYPE_POINTS: 'points',
    getEstimationRealValue: jest.fn((_, estimation) => estimation || 0),
}))

const { runHttpsCallableFunction } = require('./backends/firestore')
const { getEarnedSkillPoints, getLevelUpUserUpdateData, updateXpByDoneTask } = require('./Levels')

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
})
