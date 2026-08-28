'use strict'

const XP_NEEDED_FOR_LEVEL_UP = 42000
const SKILL_POINTS_PER_LEVEL = 5
const MAX_XP_AWARD = 10000

function getLevelForXp(currentLevel, totalXp) {
    return Math.max(currentLevel || 1, Math.floor(totalXp / XP_NEEDED_FOR_LEVEL_UP) + 1)
}

function getUtcStatisticsKeys(now) {
    const date = new Date(now)
    const day = String(date.getUTCDate()).padStart(2, '0')
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const year = String(date.getUTCFullYear())
    return { documentId: `${day}${month}${year}`, day: Number(`${year}${month}${day}`) }
}

function validateXpAward({ projectId, userId, xpEarned, increaseProjectQuota }) {
    if (!projectId || typeof projectId !== 'string') throw new Error('projectId is required')
    if (!userId || typeof userId !== 'string') throw new Error('userId is required')
    if (!Number.isInteger(xpEarned) || xpEarned <= 0 || xpEarned > MAX_XP_AWARD) {
        throw new Error(`xpEarned must be an integer between 1 and ${MAX_XP_AWARD}`)
    }
    if (typeof increaseProjectQuota !== 'boolean') throw new Error('increaseProjectQuota must be boolean')
}

async function awardUserXp({ db, FieldValue, projectId, userId, xpEarned, increaseProjectQuota, now = Date.now() }) {
    validateXpAward({ projectId, userId, xpEarned, increaseProjectQuota })
    const projectRef = db.doc(`projects/${projectId}`)
    const userRef = db.doc(`users/${userId}`)
    const statisticsKeys = getUtcStatisticsKeys(now)
    const statisticsRef = db.doc(`statistics/${projectId}/${userId}/${statisticsKeys.documentId}`)

    return db.runTransaction(async transaction => {
        const [projectSnapshot, userSnapshot] = await Promise.all([
            transaction.get(projectRef),
            transaction.get(userRef),
        ])
        if (!projectSnapshot.exists) throw new Error('Project not found')
        if (!userSnapshot.exists) throw new Error('User not found')

        const project = projectSnapshot.data() || {}
        if (!Array.isArray(project.userIds) || !project.userIds.includes(userId)) {
            throw new Error('XP recipient is not a project member')
        }

        const user = userSnapshot.data() || {}
        const previousXp = Number.isFinite(user.xp) ? user.xp : 0
        const previousLevel = Number.isFinite(user.level) ? user.level : 1
        const totalXp = previousXp + xpEarned
        const newLevel = getLevelForXp(previousLevel, totalXp)
        const earnedSkillPoints = Math.max(0, newLevel - previousLevel) * SKILL_POINTS_PER_LEVEL
        const userUpdate = {
            xp: totalXp,
            monthlyXp: FieldValue.increment(xpEarned),
        }
        if (newLevel !== previousLevel) {
            Object.assign(userUpdate, {
                level: newLevel,
                skillPoints: FieldValue.increment(earnedSkillPoints),
                showSkillPointsNotification: true,
                newEarnedSkillPoints: FieldValue.increment(earnedSkillPoints),
                lastSkillPointLevelUpAt: now,
            })
        }

        transaction.update(userRef, userUpdate)
        transaction.set(statisticsRef, { xp: FieldValue.increment(xpEarned), day: statisticsKeys.day }, { merge: true })
        if (increaseProjectQuota && !project.parentTemplateId) {
            transaction.set(projectRef, { monthlyXp: FieldValue.increment(xpEarned) }, { merge: true })
        }

        return { totalXp, level: newLevel, earnedSkillPoints }
    })
}

module.exports = {
    MAX_XP_AWARD,
    awardUserXp,
    getLevelForXp,
    getUtcStatisticsKeys,
    validateXpAward,
}
