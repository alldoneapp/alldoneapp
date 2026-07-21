export default function getAllProjectsOpenTasksAmount(
    sidebarNumbers,
    userId,
    archivedProjectIds = [],
    templateProjectIds = []
) {
    if (!sidebarNumbers || !userId) return 0

    return Object.keys(sidebarNumbers).reduce((amount, projectId) => {
        if (archivedProjectIds.includes(projectId) || templateProjectIds.includes(projectId)) return amount

        const projectAmount = sidebarNumbers[projectId]?.[userId]
        return amount + (Number.isFinite(projectAmount) && projectAmount > 0 ? projectAmount : 0)
    }, 0)
}
