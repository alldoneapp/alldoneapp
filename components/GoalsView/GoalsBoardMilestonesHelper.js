export const shouldShowMilestoneWithoutGoals = ({
    inAllProjects,
    inDone,
    milestoneIndex,
    isAutomaticMode,
    isLinearMilestone,
    isBacklog,
}) => !inDone && !isBacklog && (milestoneIndex === 0 || (!inAllProjects && isAutomaticMode && isLinearMilestone))

export const getPreviousOpenMilestoneDate = (milestoneId, openMilestones, backlogId) => {
    if (milestoneId === backlogId) {
        return openMilestones.length > 0 ? openMilestones[openMilestones.length - 1].date : 0
    }

    const milestoneIndex = openMilestones.findIndex(milestone => milestone.id === milestoneId)
    return milestoneIndex > 0 ? openMilestones[milestoneIndex - 1].date : 0
}
