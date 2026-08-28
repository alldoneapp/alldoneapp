import { getWorkflowStepsIdsSorted } from './HelperFunctions'
import { ESTIMATION_TYPE_POINTS, getEstimationRealValue } from './EstimationHelper'
import { runHttpsCallableFunction } from './backends/firestore'

const XP_NEEDED_FOR_LEVEL_UP = 42000
export const SKILL_POINTS_PER_LEVEL = 5

export function getXpNeededToReachLevel(level) {
    return level <= 1 ? 0 : XP_NEEDED_FOR_LEVEL_UP
}

export function getTotalXpNeededToReachLevel(level) {
    return level <= 1 ? 0 : XP_NEEDED_FOR_LEVEL_UP * (level - 1)
}

export function getRelativeLevelXp(currentLevel, currentXp) {
    return getXpNeededToReachLevel(currentLevel + 1) - (getTotalXpNeededToReachLevel(currentLevel + 1) - currentXp)
}

const getEarnedXpByDoneTask = estimationInPoints => {
    return (estimationInPoints + 1) * 200
}

export async function updateXpByDoneTask(userId, estimation, firebase, db, projectId) {
    const estimationInPoints = getEstimationRealValue(null, estimation, ESTIMATION_TYPE_POINTS)
    const xpEarned = getEarnedXpByDoneTask(estimationInPoints)
    return updateXp(userId, xpEarned, projectId, true)
}

export async function updateXpByDoneForAllReviewers(estimations, workflow, firebase, db, projectId) {
    const steps = getWorkflowStepsIdsSorted(workflow)

    for (let i = 0; i < steps.length; i++) {
        const reviewerUid = workflow[steps[i]].reviewerUid
        const estimation = estimations[steps[i]] ? estimations[steps[i]] : 0
        const estimationInPoints = getEstimationRealValue(null, estimation, ESTIMATION_TYPE_POINTS)
        const xpEarned = getEarnedXpByDoneTask(estimationInPoints)
        await updateXp(reviewerUid, xpEarned, projectId, true)
    }
}

export async function updateXpByCreateProject(userId, firebase, db, projectId) {
    const xpEarned = 200
    return updateXp(userId, xpEarned, projectId, false)
}

export async function updateXpByChangeGoalProgress(userId, firebase, db, projectId) {
    const xpEarned = 400
    return updateXp(userId, xpEarned, projectId, true)
}

export async function updateXpByEditingNote(userId, firebase, db, projectId) {
    const xpEarned = 50
    return updateXp(userId, xpEarned, projectId, true)
}

export async function updateXpByCommentInChat(userId, firebase, db, projectId) {
    const xpEarned = 1
    return updateXp(userId, xpEarned, projectId, true)
}

export const getEarnedSkillPoints = (level, newLevel) => {
    const earnedLevels = newLevel - level
    return earnedLevels * SKILL_POINTS_PER_LEVEL
}

export const getLevelUpUserUpdateData = (level, newLevel, totalXp, firebase, now = Date.now()) => {
    const earnedSkillPoints = getEarnedSkillPoints(level, newLevel)
    return {
        xp: totalXp,
        level: newLevel,
        skillPoints: firebase.firestore.FieldValue.increment(earnedSkillPoints),
        showSkillPointsNotification: true,
        newEarnedSkillPoints: firebase.firestore.FieldValue.increment(earnedSkillPoints),
        lastSkillPointLevelUpAt: now,
    }
}

async function updateXp(userId, xpEarned, projectId, increaseProjectQuota) {
    return runHttpsCallableFunction('awardXpSecondGen', {
        projectId,
        userId,
        xpEarned,
        increaseProjectQuota,
    })
}
