import moment from 'moment'

import { chronoKeysOrder } from './HelperFunctions'
import { updateQuotaXp } from './backends/Premium/premiumFirestore'
import { ESTIMATION_TYPE_POINTS, getEstimationRealValue } from './EstimationHelper'
import { BatchWrapper } from '../functions/BatchWrapper/batchWrapper'
import { getUserData } from './backends/Users/usersFirestore'

const XP_NEEDED_FOR_LEVEL_UP = 42000

export function getXpNeededToReachLevel(level) {
    return level <= 1 ? 0 : XP_NEEDED_FOR_LEVEL_UP
}

export function getTotalXpNeededToReachLevel(level) {
    return level <= 1 ? 0 : XP_NEEDED_FOR_LEVEL_UP * (level - 1)
}

function getUpdateLevel(currentLevel, newTotalXp) {
    const nextLevel = currentLevel + 1
    if (getTotalXpNeededToReachLevel(nextLevel) <= newTotalXp) {
        return getUpdateLevel(nextLevel, newTotalXp)
    } else {
        return currentLevel
    }
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
    updateXp(userId, firebase, db, xpEarned, projectId, true)
}

export async function updateXpByDoneForAllReviewers(estimations, workflow, firebase, db, projectId) {
    const steps = Object.keys(workflow).sort(chronoKeysOrder)

    for (let i = 0; i < steps.length; i++) {
        const reviewerUid = workflow[steps[i]].reviewerUid
        const estimation = estimations[steps[i]] ? estimations[steps[i]] : 0
        const estimationInPoints = getEstimationRealValue(null, estimation, ESTIMATION_TYPE_POINTS)
        const xpEarned = getEarnedXpByDoneTask(estimationInPoints)
        updateXp(reviewerUid, firebase, db, xpEarned, projectId, true)
    }
}

export async function updateXpByCreateProject(userId, firebase, db, projectId) {
    const xpEarned = 200
    updateXp(userId, firebase, db, xpEarned, projectId, false)
}

export async function updateXpByChangeGoalProgress(userId, firebase, db, projectId) {
    const xpEarned = 400
    updateXp(userId, firebase, db, xpEarned, projectId, true)
}

export async function updateXpByEditingNote(userId, firebase, db, projectId) {
    const xpEarned = 50
    updateXp(userId, firebase, db, xpEarned, projectId, true)
}

export async function updateXpByCommentInChat(userId, firebase, db, projectId) {
    const xpEarned = 1
    updateXp(userId, firebase, db, xpEarned, projectId, true)
}

const getEarnedSkillPoints = (level, newLevel) => {
    const earnedLevels = newLevel - level
    let earnedSkillPoints = 0
    for (let i = 0; i < earnedLevels; i++) {
        earnedSkillPoints += Math.floor(Math.random() * 2) + 2
    }
    return earnedSkillPoints
}

async function updateXp(userId, firebase, db, xpEarned, projectId, increaseProjectQuota) {
    const user = await getUserData(userId, false)
    const xp = user.xp ? user.xp : 0
    const level = user.level ? user.level : 1

    const totalXp = xp + xpEarned
    const newLevel = getUpdateLevel(level, totalXp)

    let data
    if (newLevel !== level) {
        const earnedSkillPoints = getEarnedSkillPoints(level, newLevel)
        data = {
            xp: totalXp,
            level: newLevel,
            skillPoints: firebase.firestore.FieldValue.increment(earnedSkillPoints),
            showSkillPointsNotification: true,
            newEarnedSkillPoints: firebase.firestore.FieldValue.increment(earnedSkillPoints),
        }
    } else {
        data = { xp: totalXp }
    }

    const batch = new BatchWrapper(db)

    const usersRef = firebase.firestore().doc(`users/${userId}`)
    batch.update(usersRef, data)

    updateQuotaXp(projectId, userId, xpEarned, increaseProjectQuota)

    const date = moment()
    const slimDate = date.format('DDMMYYYY')
    const dayDate = parseInt(date.format('YYYYMMDD'))

    batch.set(
        db.doc(`statistics/${projectId}/${userId}/${slimDate}`),
        { xp: firebase.firestore.FieldValue.increment(xpEarned), day: dayDate },
        { merge: true }
    )

    batch.commit()
}
