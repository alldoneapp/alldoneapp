export const mergeRequiredPrivateAccess = (selectedUserIds = [], permanentUserIds = [], actingUserId) => {
    const actingUserIds = actingUserId ? [actingUserId] : []
    return Array.from(new Set([...selectedUserIds, ...permanentUserIds, ...actingUserIds]))
}
