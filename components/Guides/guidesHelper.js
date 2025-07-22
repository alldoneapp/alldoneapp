import store from '../../redux/store'

export const UNLOCK_GOAL_COST = 80

export function checkIfUserIsGuideAdmin(user) {
    return user.realTemplateProjectIds.length > 0
}

export function objectIsLockedForUser(projectId, unlockedKeysByGuides, lockKey, ownerId) {
    const { loggedUser, administratorUser, projectUsers } = store.getState()

    return objectIsLocked(
        projectId,
        unlockedKeysByGuides,
        lockKey,
        ownerId,
        loggedUser,
        administratorUser.uid,
        projectUsers
    )
}

export function objectIsLocked(
    projectId,
    unlockedKeysByGuides,
    lockKey,
    ownerId,
    loggedUser,
    administratorUserId,
    projectUsers
) {
    if (!lockKey) return false

    if (loggedUser.isAnonymous) return true

    const isCreator = administratorUserId === loggedUser.uid || loggedUser.realTemplateProjectIds.includes(projectId)
    if (isCreator) {
        const owner = projectUsers[projectId]?.find(user => user.uid === ownerId)
        if (owner) {
            return !owner.unlockedKeysByGuides[projectId] || !owner.unlockedKeysByGuides[projectId].includes(lockKey)
        }
    }

    return !isCreator && (!unlockedKeysByGuides[projectId] || !unlockedKeysByGuides[projectId].includes(lockKey))
}
