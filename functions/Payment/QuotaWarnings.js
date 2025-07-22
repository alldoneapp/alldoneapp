const { difference } = require('lodash')
const { logEvent } = require('../GAnalytics/GAnalytics')
const { getUsers } = require('../Users/usersFirestore')

const PERSONAL_QUOTA_TYPE = 0
const PROJECT_QUOTA_TYPE = 1

const PERSONAL_XP_QUOTE_LIMIT = 8000
const PERSONAL_TRAFFIC_QUOTE_LIMIT = 100

const PROJECT_XP_QUOTE_LIMIT = 50000
const PROJECT_TRAFFIC_QUOTE_LIMIT = 200

const PERCENT_100 = 1
const PERCENT_80 = 0.8
const PERCENT_50 = 0.5

const checkIfNeededGenerateWarning = (consumedQuota, quotaLimit, decimalPercent) => {
    const XP_QUOTE_LIMIT_PERCENT = quotaLimit * decimalPercent
    return consumedQuota >= XP_QUOTE_LIMIT_PERCENT
}

const getPercentToGenerateWarning = (oldMonthlyXp, newMonthlyXp, quotaLimit) => {
    const currently100PercentWarningGenerated = checkIfNeededGenerateWarning(oldMonthlyXp, quotaLimit, PERCENT_100)
    if (!currently100PercentWarningGenerated) {
        const needGenerate100PercentWarning = checkIfNeededGenerateWarning(newMonthlyXp, quotaLimit, PERCENT_100)

        if (needGenerate100PercentWarning) {
            return PERCENT_100
        } else {
            const currently80PercentWarningGenerated = checkIfNeededGenerateWarning(
                oldMonthlyXp,
                quotaLimit,
                PERCENT_80
            )
            if (!currently80PercentWarningGenerated) {
                const needGenerate80PercentWarning = checkIfNeededGenerateWarning(newMonthlyXp, quotaLimit, PERCENT_80)

                if (needGenerate80PercentWarning) {
                    return PERCENT_80
                } else {
                    const currently50PercentWarningGenerated = checkIfNeededGenerateWarning(
                        oldMonthlyXp,
                        quotaLimit,
                        PERCENT_50
                    )
                    if (!currently50PercentWarningGenerated) {
                        const needGenerate50PercentWarning = checkIfNeededGenerateWarning(
                            newMonthlyXp,
                            quotaLimit,
                            PERCENT_50
                        )

                        if (needGenerate50PercentWarning) {
                            return PERCENT_50
                        }
                    }
                }
            }
        }
    }
}

const generateQuoatsReachedLogs = async (
    quotaType,
    objectId,
    percentToGenerateXpWarning,
    percentToGenerateTrafficWarning
) => {
    if (percentToGenerateXpWarning) {
        if (percentToGenerateXpWarning === PERCENT_100) {
            quotaType === PERSONAL_QUOTA_TYPE
                ? await logEvent(objectId, 'personal_xp_quota_100', { userId: objectId })
                : await logEvent(objectId, 'project_xp_quota_100', { projectId: objectId })
        } else if (percentToGenerateXpWarning === PERCENT_80) {
            quotaType === PERSONAL_QUOTA_TYPE
                ? await logEvent(objectId, 'personal_xp_quota_80', { userId: objectId })
                : await logEvent(objectId, 'project_xp_quota_80', { projectId: objectId })
        } else if (percentToGenerateXpWarning === PERCENT_50) {
            quotaType === PERSONAL_QUOTA_TYPE
                ? await logEvent(objectId, 'personal_xp_quota_50', { userId: objectId })
                : await logEvent(objectId, 'project_xp_quota_50', { projectId: objectId })
        }
    }
    if (percentToGenerateTrafficWarning) {
        if (percentToGenerateTrafficWarning === PERCENT_100) {
            quotaType === PERSONAL_QUOTA_TYPE
                ? await logEvent(objectId, 'personal_traffic_quota_100', { userId: objectId })
                : await logEvent(objectId, 'project_traffic_quota_100', { projectId: objectId })
        } else if (percentToGenerateTrafficWarning === PERCENT_80) {
            quotaType === PERSONAL_QUOTA_TYPE
                ? await logEvent(objectId, 'personal_traffic_quota_80', { userId: objectId })
                : await logEvent(objectId, 'project_traffic_quota_80', { projectId: objectId })
        } else if (percentToGenerateTrafficWarning === PERCENT_50) {
            quotaType === PERSONAL_QUOTA_TYPE
                ? await logEvent(objectId, 'personal_traffic_quota_50', { userId: objectId })
                : await logEvent(objectId, 'project_traffic_quota_50', { projectId: objectId })
        }
    }
}

const getWarningPercent = async (
    quotaType,
    objectId,
    oldMonthlyXp,
    newMonthlyXp,
    oldMonthlyTraffic,
    newMonthlyTraffic,
    xpQuotaLimit,
    trafficQuotaLimit
) => {
    let percentToGenerateXpWarning = getPercentToGenerateWarning(oldMonthlyXp, newMonthlyXp, xpQuotaLimit)
    let percentToGenerateTrafficWarning = getPercentToGenerateWarning(
        oldMonthlyTraffic,
        newMonthlyTraffic,
        trafficQuotaLimit
    )

    if (percentToGenerateXpWarning || percentToGenerateTrafficWarning) {
        percentToGenerateXpWarning = percentToGenerateXpWarning ? percentToGenerateXpWarning : 0
        percentToGenerateTrafficWarning = percentToGenerateTrafficWarning ? percentToGenerateTrafficWarning : 0

        const percent =
            percentToGenerateXpWarning >= percentToGenerateTrafficWarning
                ? percentToGenerateXpWarning
                : percentToGenerateTrafficWarning

        await generateQuoatsReachedLogs(
            quotaType,
            objectId,
            percentToGenerateXpWarning,
            percentToGenerateTrafficWarning
        )

        return percent
    }

    return null
}

const generateProjectWarnings = async (projectId, oldProject, newProject, admin) => {
    const percent = await getWarningPercent(
        PROJECT_QUOTA_TYPE,
        projectId,
        oldProject.monthlyXp,
        newProject.monthlyXp,
        oldProject.monthlyTraffic,
        newProject.monthlyTraffic,
        PROJECT_XP_QUOTE_LIMIT,
        PROJECT_TRAFFIC_QUOTE_LIMIT
    )

    if (percent) {
        const db = admin.firestore()
        const promises = []
        const userIds = newProject.userIds
        userIds.forEach(userId => {
            promises.push(db.doc(`users/${userId}`).update({ [`quotaWarnings.${projectId}`]: percent }))
        })
        await Promise.all(promises)
    }
}

const generateUserWarnings = async (userId, oldUser, newUser, admin) => {
    const percent = await getWarningPercent(
        PERSONAL_QUOTA_TYPE,
        userId,
        oldUser.monthlyXp,
        newUser.monthlyXp,
        oldUser.monthlyTraffic,
        newUser.monthlyTraffic,
        PERSONAL_XP_QUOTE_LIMIT,
        PERSONAL_TRAFFIC_QUOTE_LIMIT
    )

    if (percent) {
        const db = admin.firestore()
        await db.doc(`users/${userId}`).update({ [`quotaWarnings.${userId}`]: percent })
    }
}

const resetWarningsAndQuotas = async admin => {
    const db = admin.firestore()

    let promises = []
    promises.push(getUsers(true))
    promises.push(db.collection(`projects`).get())
    const promiseResults = await Promise.all(promises)

    const usersDocs = promiseResults[0]
    const projectsDocs = promiseResults[1].docs

    promises = []
    usersDocs.forEach(userDoc => {
        promises.push(db.doc(`users/${userDoc.id}`).update({ quotaWarnings: {}, monthlyXp: 0, monthlyTraffic: 0 }))
    })

    projectsDocs.forEach(projectDoc => {
        promises.push(db.doc(`projects/${projectDoc.id}`).update({ monthlyXp: 0, monthlyTraffic: 0 }))
    })
    await Promise.all(promises)
}

module.exports = {
    resetWarningsAndQuotas,
    generateProjectWarnings,
    generateUserWarnings,
}
