'use strict'

// The Roadmap Creator's view of an Alldone project (alldone.team, JO-3355): which projects it may
// offer, and the read-only snapshot of one project's focus areas, goals, milestones and OKRs.
//
// Two ways deliver the same snapshot:
//   - inside alldone.app, the embed window pushes it live over postMessage
//     (utils/roadmapSourceBridge.js, protocol version 1);
//   - on alldone.team itself, alldone.team's Functions ask POST /api/roadmap/source
//     (functions/Roadmap/roadmapSourceApi.js), signed like the Gold webhook.
// Both build it from the normalizers below, so alldone.team's projection reads one shape.
//
// Pure module: the web app imports it too, so it must not require anything (not even moment).
// Inputs are already mapped documents (mapGoalData, mapMilestoneData, mapProjectData, mapOKRData).

// mapGoalData's marker for "progress comes from the goal's live child data".
const DYNAMIC_PERCENT = 'DYNAMIC_PERCENT'
const ALL_USERS = 'ALL_USERS'

// The project marker colours (Themes/Modern/ProjectColors.js: PROJECT_COLOR_SYSTEM, whose keys are
// the stored colour and whose MARKER equals the key). A stored colour outside this list shows as the
// default blue, as it does in the app. roadmapSourceParity.test.js pins the list to the app's.
const ROADMAP_PROJECT_COLOR_DEFAULT = '#47A3FF'
const ROADMAP_PROJECT_COLORS = [
    '#47A3FF',
    '#47DEFF',
    '#FF5274',
    '#CB70FF',
    '#00F477',
    '#FF70B3',
    '#FF925C',
    '#F0E219',
    '#0AFFBE',
    '#BFFF0A',
    '#7C70FF',
]

function normalizeNumber(value, fallback = 0) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
}

function normalizeProjectColor(color) {
    return ROADMAP_PROJECT_COLORS.includes(color) ? color : ROADMAP_PROJECT_COLOR_DEFAULT
}

const cleanIdList = value => (Array.isArray(value) ? value : [])

// The projects the Roadmap Creator may offer: the user's projects minus archived, template and
// guide projects, as a minimal DTO sorted by name. Callers on the server must pass only projects
// whose document lists the user as a member.
function getActiveRoadmapProjects(projects, user) {
    const projectIds = new Set(cleanIdList(user?.projectIds))
    const excludedIds = new Set([
        ...cleanIdList(user?.archivedProjectIds),
        ...cleanIdList(user?.templateProjectIds),
        ...cleanIdList(user?.guideProjectIds),
    ])

    return (Array.isArray(projects) ? projects : [])
        .filter(project => project?.id && projectIds.has(project.id) && !excludedIds.has(project.id))
        .map(project => ({
            id: project.id,
            name: project.name || 'Untitled project',
            color: normalizeProjectColor(project.color),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

function normalizeFocusAreas(catalog) {
    return Object.entries(catalog && typeof catalog === 'object' && !Array.isArray(catalog) ? catalog : {})
        .map(([id, area]) => ({
            id,
            name: typeof area?.name === 'string' ? area.name.trim().replace(/\s+/g, ' ') : '',
        }))
        .filter(area => area.name && area.name.toLowerCase() !== 'general')
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
}

function normalizeRoadmapProject(project) {
    return {
        id: project.id,
        name: project.name || 'Untitled project',
        color: normalizeProjectColor(project.color),
        focusAreas: normalizeFocusAreas(project.focusAreas),
    }
}

function normalizeGoalComments(commentsData) {
    const lastComment = typeof commentsData?.lastComment === 'string' ? commentsData.lastComment.trim() : ''
    if (!lastComment) return null

    return {
        lastComment,
        lastCommentType: typeof commentsData.lastCommentType === 'string' ? commentsData.lastCommentType : '',
        amount: Math.max(1, Math.round(normalizeNumber(commentsData.amount))),
    }
}

function normalizeRoadmapGoal(goal) {
    return {
        id: goal.id,
        name: goal.name || '',
        // mapGoalData uses this sentinel when progress is calculated from the
        // goal's live child data. Preserve that meaning for the roadmap
        // consumer instead of coercing the string to 0.
        progress: goal.progress === DYNAMIC_PERCENT ? -1 : normalizeNumber(goal.progress),
        dynamicProgress: normalizeNumber(goal.dynamicProgress),
        startingMilestoneDate: normalizeNumber(goal.startingMilestoneDate),
        completionMilestoneDate: normalizeNumber(goal.completionMilestoneDate),
        parentDoneMilestoneIds: Array.isArray(goal.parentDoneMilestoneIds) ? goal.parentDoneMilestoneIds : [],
        progressByDoneMilestone: goal.progressByDoneMilestone || {},
        dateByDoneMilestone: goal.dateByDoneMilestone || {},
        sortIndexByMilestone: goal.sortIndexByMilestone || {},
        scheduleMode: goal.scheduleMode || '',
        focusAreaId: typeof goal.focusAreaId === 'string' ? goal.focusAreaId : null,
        commentsData: normalizeGoalComments(goal.commentsData),
    }
}

function normalizeRoadmapMilestone(milestone) {
    return {
        id: milestone.id,
        name: milestone.extendedName || 'Milestone',
        date: normalizeNumber(milestone.date),
        done: milestone.done === true,
        doneDate: normalizeNumber(milestone.doneDate),
        milestoneType: milestone.milestoneType || '',
        periodStartDate: milestone.periodStartDate == null ? null : normalizeNumber(milestone.periodStartDate),
        periodEndDate: milestone.periodEndDate == null ? null : normalizeNumber(milestone.periodEndDate),
        periodKey: milestone.periodKey || '',
        cadence: milestone.cadence || '',
    }
}

// `resolvedCurrentValue` is the value the user sees: for a time-logged revenue OKR the revenue from
// the user's own logged time, otherwise the stored current value. `paceStatusOf` receives the OKR
// with `resolvedCurrentValue` set and returns its pace status; the web app passes its
// calculateOkrPace, the server the equivalent from functions/shared/OKRHelper.js.
function normalizeRoadmapOkr(okr, resolvedCurrentValue, paceStatusOf) {
    const withResolvedValue = { ...okr, resolvedCurrentValue: normalizeNumber(resolvedCurrentValue) }
    return {
        id: okr.id,
        label: okr.label || '',
        type: okr.type,
        currentValue: normalizeNumber(okr.currentValue),
        resolvedCurrentValue: withResolvedValue.resolvedCurrentValue,
        targetValue: normalizeNumber(okr.targetValue),
        unit: okr.unit || '',
        cadence: okr.cadence || '',
        periodStart: normalizeNumber(okr.periodStart),
        periodEnd: normalizeNumber(okr.periodEnd),
        status: okr.status || '',
        paceStatus: paceStatusOf(withResolvedValue),
    }
}

module.exports = {
    ALL_USERS,
    DYNAMIC_PERCENT,
    ROADMAP_PROJECT_COLORS,
    ROADMAP_PROJECT_COLOR_DEFAULT,
    getActiveRoadmapProjects,
    normalizeFocusAreas,
    normalizeProjectColor,
    normalizeRoadmapGoal,
    normalizeRoadmapMilestone,
    normalizeRoadmapOkr,
    normalizeRoadmapProject,
}
