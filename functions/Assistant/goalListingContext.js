'use strict'

// What a model sees of a goal. A user with many projects has hundreds of goals; get_goals with
// status "all" returned 331 of them as 224k characters (2026-11-11), most of it empty fields, the
// backlog placeholder dates and one entry per done milestone of a recurring goal. The generic
// ceiling then kept only the first 20 goals. So: drop what carries no information here, and when a
// listing is still too large keep every goal's identity and drop details instead (compactGoalListing).

const MAX_DONE_MILESTONES_PER_GOAL = 5
const MAX_DESCRIPTION_LENGTH = 1000
const MAX_LAST_COMMENT_LENGTH = 300
const ALL_USERS_OWNER = 'ALL_USERS'

const clip = (value, length) =>
    typeof value === 'string' && value.length > length ? `${value.slice(0, length)}…` : value

// Backlog goals carry Number.MAX_SAFE_INTEGER as both milestone dates; that is not a date.
function realDate(value) {
    const date = Number(value)
    return Number.isFinite(date) && date > 0 && date < Number.MAX_SAFE_INTEGER ? date : null
}

function mapGoalComments(commentsData) {
    if (!commentsData || typeof commentsData !== 'object') return null
    const amount = Number(commentsData.amount) || 0
    const lastComment = typeof commentsData.lastComment === 'string' ? commentsData.lastComment.trim() : ''
    if (!amount && !lastComment) return null
    return {
        ...(amount ? { amount } : {}),
        ...(lastComment ? { lastComment: clip(lastComment, MAX_LAST_COMMENT_LENGTH) } : {}),
    }
}

function mapDoneMilestone(milestone) {
    return {
        milestoneId: milestone?.milestoneId,
        date: milestone?.date,
        ...(milestone?.extendedName ? { extendedName: milestone.extendedName } : {}),
        progress: milestone?.progress,
    }
}

// Fields that are empty, null or a default are left out rather than sent as such.
function mapAssistantGoalForToolResponse(goal) {
    const description = typeof goal?.description === 'string' ? goal.description.trim() : ''
    const assigneesIds = Array.isArray(goal?.assigneesIds) ? goal.assigneesIds.filter(Boolean) : []
    const comments = mapGoalComments(goal?.commentsData)
    const startingMilestoneDate = realDate(goal?.startingMilestoneDate)
    const completionMilestoneDate = realDate(goal?.completionMilestoneDate)
    const latestDoneMilestoneDate = realDate(goal?.latestDoneMilestoneDate)
    // GoalRetrievalService sorts done milestones newest first.
    const doneMilestones = Array.isArray(goal?.doneMilestones) ? goal.doneMilestones : []

    return {
        id: goal?.id,
        name: goal?.name,
        ...(description ? { description: clip(description, MAX_DESCRIPTION_LENGTH) } : {}),
        progress: goal?.progress,
        projectId: goal?.projectId || null,
        projectName: goal?.projectName || null,
        ...(goal?.ownerId && goal.ownerId !== ALL_USERS_OWNER ? { ownerId: goal.ownerId } : {}),
        ...(assigneesIds.length ? { assigneesIds } : {}),
        ...(comments ? { commentsData: comments } : {}),
        status: goal?.status || 'active',
        ...(startingMilestoneDate ? { startingMilestoneDate } : {}),
        ...(completionMilestoneDate ? { completionMilestoneDate } : {}),
        ...(goal?.isBacklog === true ? { isBacklog: true } : {}),
        ...(goal?.matchedMilestone ? { matchedMilestone: goal.matchedMilestone } : {}),
        ...(doneMilestones.length
            ? { doneMilestones: doneMilestones.slice(0, MAX_DONE_MILESTONES_PER_GOAL).map(mapDoneMilestone) }
            : {}),
        ...(doneMilestones.length > MAX_DONE_MILESTONES_PER_GOAL
            ? {
                  doneMilestoneCount: doneMilestones.length,
                  olderDoneMilestonesOmitted: doneMilestones.length - MAX_DONE_MILESTONES_PER_GOAL,
              }
            : {}),
        ...(latestDoneMilestoneDate ? { latestDoneMilestoneDate } : {}),
    }
}

// Keeps every goal it can as an identity line (id, name, progress, grouped under its project)
// before dropping any goal, and says plainly that the listing is partial when it has to.
function compactGoalListing(result, maxChars) {
    const goals = Array.isArray(result?.goals) ? result.goals.filter(goal => goal && typeof goal === 'object') : []
    const totalCount = Math.max(Number(result?.count) || 0, goals.length)
    const projects = []
    const projectsByKey = new Map()
    let shownCount = 0
    const build = () => ({
        projects,
        count: totalCount,
        shownCount,
        listingComplete: shownCount >= totalCount,
        ...(result?.appliedFilters ? { appliedFilters: result.appliedFilters } : {}),
        contextTruncated: true,
        goalDetailsOmitted: true,
        countGuidance:
            (shownCount >= totalCount
                ? 'Every goal is listed, grouped by project. '
                : 'count is the total; only shownCount goals fit, so say the list is partial. ') +
            'Goals are active unless status says otherwise. Descriptions, comments and milestones were left out to fit; call get_goals for one project to see them.',
    })
    for (const goal of goals) {
        const key = goal.projectId || goal.projectName || ''
        let project = projectsByKey.get(key)
        const isNewProject = !project
        if (isNewProject) {
            project = { projectId: goal.projectId || null, projectName: clip(goal.projectName, 100) || null, goals: [] }
            projectsByKey.set(key, project)
            projects.push(project)
        }
        const latestDoneMilestoneDate = realDate(goal.latestDoneMilestoneDate)
        project.goals.push({
            id: goal.id,
            name: clip(goal.name, 200),
            progress: goal.progress,
            ...(goal.status && goal.status !== 'active' ? { status: goal.status } : {}),
            ...(latestDoneMilestoneDate ? { latestDoneMilestoneDate } : {}),
        })
        shownCount++
        if (JSON.stringify(build()).length > maxChars) {
            project.goals.pop()
            shownCount--
            if (isNewProject) {
                projects.pop()
                projectsByKey.delete(key)
            }
            break
        }
    }
    return build()
}

module.exports = { mapAssistantGoalForToolResponse, compactGoalListing, MAX_DONE_MILESTONES_PER_GOAL }
