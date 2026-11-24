/**
 * AT-3142 — "Plan my day": capacity-aware positive daily selection.
 *
 * Pure maths, no Firestore and no React (`dailyPlanModel.test.js` pins every rule). The modal
 * (`components/TaskListView/DailyPlan/`) feeds it a FROZEN snapshot of the Today tasks taken when it
 * opens, so the list never re-flows under the user while they review; the server
 * (`functions/Tasks/dailyPlanService.js`) re-checks every task and computes the real postpone dates.
 *
 * Decisions (see docs/claude/daily-plan.md):
 *   - Capacity: "Time to work" (AT-3136: working hours minus merged meetings) × 80%; the other 20%
 *     stays unplanned buffer. Without a connected/readable calendar the user picks an assumed
 *     meeting time and the capacity is marked provisional.
 *   - Proposal: deterministic rules, no model call. In this order:
 *       1. your Must tasks (never dropped, even when they alone exceed the budget),
 *       2. the focus task,
 *       3. milestones at risk: a goal whose DATED (fixed) milestone is at most 3 workdays away (or
 *          up to 14 days overdue) gets today's share of its due work (work ÷ workdays left) ahead
 *          of the project order, with a visible reason,
 *       4. everything else in the user's project-list order (sidebar, `sortIndexByUser`); inside a
 *          project: Should → Could → none, then the nearer goal milestone, then FEWER postpones,
 *          then the list order.
 *     Filled while it fits. Do later tasks are never proposed. How often a task was postponed never
 *     promotes or protects it; at otherwise equal rank the more postponed task comes later.
 *   - Unknown estimates count as 30 minutes and are flagged.
 *   - Meetings (calendar tasks) are already subtracted as meeting time, so they are neither counted
 *     nor postponed. Tasks waiting for an assistant are not on the user's Today at all.
 *   - Nothing is written until Apply. Someday is opt-in.
 */

import moment from 'moment'

import {
    TASK_PRIORITY_COULD_DO,
    TASK_PRIORITY_DO_LATER,
    TASK_PRIORITY_MUST_DO,
    TASK_PRIORITY_SHOULD_DO,
} from '../TaskPriority'

export const PLAN_FILL_SHARE = 0.8
export const UNKNOWN_ESTIMATE_MINUTES = 30
// Milestone urgency (agreed with the product owner 2026-11-24).
export const MILESTONE_AT_RISK_WORKDAYS = 3 // today + the next 2 workdays (Mon–Fri)
export const MILESTONE_OVERDUE_GRACE_DAYS = 14 // older open milestones are treated as stale
export const ASSUMED_MEETING_OPTIONS = [0, 60, 120, 180]
export const ESTIMATE_OPTIONS = [15, 30, 60, 120, 240]
const BACKLOG_DATE = Number.MAX_SAFE_INTEGER
const DYNAMIC_PERCENT = 'DYNAMIC_PERCENT' // GoalsHelper.DYNAMIC_PERCENT
const GOAL_SCHEDULE_MODE_DYNAMIC = 'dynamic' // GoalMilestonesHelper
const OPEN_STEP = -1

export const TIER_MUST = 'must'
export const TIER_SHOULD = 'should'
export const TIER_COULD = 'could'
export const TIER_LATER = 'later'
export const PLAN_TIERS = [TIER_MUST, TIER_SHOULD, TIER_COULD]

export const TIER_PRIORITY = {
    [TIER_MUST]: TASK_PRIORITY_MUST_DO,
    [TIER_SHOULD]: TASK_PRIORITY_SHOULD_DO,
    [TIER_COULD]: TASK_PRIORITY_COULD_DO,
}

const TIER_ORDER = { [TIER_MUST]: 0, [TIER_SHOULD]: 1, [TIER_COULD]: 2, [TIER_LATER]: 3 }

// Why a task is where it is (shown under each row).
export const RULE_YOUR_MUST = 'yourMust'
export const RULE_FOCUS = 'focus'
export const RULE_YOUR_PRIORITY = 'yourPriority'
export const RULE_MILESTONE_AT_RISK = 'milestoneAtRisk'
export const RULE_GOAL = 'goal'
export const RULE_RANKED = 'ranked'
export const RULE_NO_ROOM = 'noRoom'
export const RULE_DO_LATER = 'doLater'
export const RULE_YOU = 'you'

// Milestone of a goal-linked task (candidate.milestone.status).
export const MILESTONE_NONE = 'none' // no goal, goal in Backlog, goal complete, milestone closed
export const MILESTONE_UNKNOWN = 'unknown' // goal data not loaded / not readable: neutral
export const MILESTONE_UPCOMING = 'upcoming'
export const MILESTONE_OVERDUE = 'overdue' // ≤ MILESTONE_OVERDUE_GRACE_DAYS past: counts as due today
export const MILESTONE_STALE = 'stale' // longer overdue: neutral
// candidate.milestone.kind
export const MILESTONE_KIND_DATED = 'dated' // fixed goal schedule: a real date, may override project order
export const MILESTONE_KIND_PERIOD = 'period' // dynamic goal schedule (e.g. "1 Nov – 30 Nov"): ranks inside its project only

// The existing auto-postpone ladder (autoPostponeTasksCloud.getDateToMoveTaskInAutoPostpone).
export const DESTINATIONS = [
    { key: '3d', amount: 3, unit: 'days' },
    { key: '1w', amount: 1, unit: 'week' },
    { key: '1m', amount: 1, unit: 'month' },
    { key: '3m', amount: 3, unit: 'months' },
    { key: '6m', amount: 6, unit: 'months' },
    { key: '1y', amount: 1, unit: 'year' },
    { key: 'someday', amount: null, unit: null },
]
export const DESTINATION_SOMEDAY = 'someday'

export const getDestinationKey = (timesPostponed, isObservedTask) => {
    if (isObservedTask || !timesPostponed) return DESTINATIONS[0].key
    return DESTINATIONS[Math.min(Math.max(Math.floor(timesPostponed), 0), DESTINATIONS.length - 1)].key
}

/** The date a destination resolves to from `nowMs` (local time), or BACKLOG for Someday. */
export const getDestinationDate = (key, nowMs = Date.now()) => {
    const destination = DESTINATIONS.find(item => item.key === key)
    if (!destination || !destination.unit) return BACKLOG_DATE
    return moment(nowMs).add(destination.amount, destination.unit).valueOf()
}

// ---------------------------------------------------------------- capacity

/**
 * `view` is `useMeetingTimeToday()`'s result (utils/meetingTimeToday.js). Returns
 *   { status: 'loading' } while the working hours or the meetings are not known yet, else
 *   { status: 'ready', provisional, calendarState, windowMinutes, meetingMinutes, freeMinutes,
 *     budgetMinutes, bufferMinutes }.
 * `provisional` = the meeting time is the user's assumption (no calendar, or it could not be read).
 */
export const computePlanCapacity = (view, assumedMeetingMinutes = 0) => {
    if (!view || !view.workingHours || view.status === 'loading' || view.status === 'calendarLoading') {
        return { status: 'loading' }
    }
    const windowMinutes = Math.max(0, Math.round(view.windowMinutes || 0))
    const provisional = view.status !== 'ready'
    const meetingMinutes = Math.min(
        windowMinutes,
        Math.max(0, Math.round(provisional ? Number(assumedMeetingMinutes) || 0 : view.meetingMinutes || 0))
    )
    const freeMinutes = windowMinutes - meetingMinutes
    const budgetMinutes = Math.round(freeMinutes * PLAN_FILL_SHARE)
    return {
        status: 'ready',
        provisional,
        calendarState: view.status,
        workingHours: view.workingHours,
        windowMinutes,
        meetingMinutes,
        // Only a read calendar has counted meetings; an assumption has none.
        meetingCount: provisional ? 0 : Number(view.meetingCount) || 0,
        freeMinutes,
        budgetMinutes,
        bufferMinutes: freeMinutes - budgetMinutes,
    }
}

// ---------------------------------------------------------------- today tasks

const getEffectiveDueDate = (task, userId) =>
    task.isObservedTask ? task.dueDateByObserversIds?.[userId] : task.dueDate

export const isPlanTodayTask = (task, userId, endOfDay) => {
    if (!task || task.done || task.inDone || task.parentId) return false
    const dueDate = getEffectiveDueDate(task, userId)
    return typeof dueDate === 'number' && Number.isFinite(dueDate) && dueDate < BACKLOG_DATE && dueDate <= endOfDay
}

export const getStoredEstimateMinutes = task => {
    const value = Number(task?.estimations?.[OPEN_STEP])
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

// ---------------------------------------------------------------- milestones

const startOfLocalDay = ms => moment(ms).startOf('day')

/** Workdays (Mon–Fri) from today through the milestone's day; today always counts as 1. */
export const countWorkdaysLeft = (milestoneDate, nowMs) => {
    const today = startOfLocalDay(nowMs)
    const target = startOfLocalDay(milestoneDate)
    let workdays = 1
    const day = today.clone().add(1, 'day')
    while (!day.isAfter(target)) {
        const weekday = day.isoWeekday()
        if (weekday <= 5) workdays++
        day.add(1, 'day')
    }
    return workdays
}

const isGoalComplete = goal =>
    goal.progress === 100 || (goal.progress === DYNAMIC_PERCENT && Number(goal.dynamicProgress) === 100)

const NO_MILESTONE = { status: MILESTONE_NONE }

/**
 * The milestone a goal-linked task works towards, from the real data: the task's `parentGoalId`
 * goal (`goals/{projectId}/items`, redux `goalsByProjectInTasks`) and that goal's
 * `completionMilestoneDate` — the milestone the goal is due at. A goal with a fixed schedule has a
 * dated milestone; a dynamic one sits in a rolling period milestone (e.g. "1 Nov – 30 Nov"). When the
 * project's open milestones are loaded (`openMilestonesByProjectInTasks`) and none is on that date,
 * the milestone was closed and the task is neutral. Tasks never get a deadline of their own here.
 */
export const resolveTaskMilestone = ({ goalId, goalsById, openMilestones, nowMs }) => {
    if (!goalId) return NO_MILESTONE
    if (!goalsById) return { status: MILESTONE_UNKNOWN }
    const goal = goalsById[goalId]
    if (!goal) return { status: MILESTONE_UNKNOWN }
    const date = Number(goal.completionMilestoneDate)
    if (!Number.isFinite(date) || date <= 0 || date >= BACKLOG_DATE || isGoalComplete(goal)) return NO_MILESTONE
    if (Array.isArray(openMilestones) && !openMilestones.some(milestone => milestone && milestone.date === date)) {
        return NO_MILESTONE
    }
    const kind = goal.scheduleMode === GOAL_SCHEDULE_MODE_DYNAMIC ? MILESTONE_KIND_PERIOD : MILESTONE_KIND_DATED
    const overdueDays = startOfLocalDay(nowMs).diff(startOfLocalDay(date), 'days')
    if (overdueDays > MILESTONE_OVERDUE_GRACE_DAYS) return { status: MILESTONE_STALE, kind, date, overdueDays }
    if (overdueDays > 0) return { status: MILESTONE_OVERDUE, kind, date, overdueDays, workdaysLeft: 1 }
    return { status: MILESTONE_UPCOMING, kind, date, overdueDays: 0, workdaysLeft: countWorkdaysLeft(date, nowMs) }
}

const hasActiveMilestone = candidate =>
    candidate.milestone?.status === MILESTONE_UPCOMING || candidate.milestone?.status === MILESTONE_OVERDUE

/** Dated milestone today … in 2 more workdays, or up to 14 days overdue: may override project order. */
export const isMilestoneImminent = milestone =>
    !!milestone &&
    milestone.kind === MILESTONE_KIND_DATED &&
    (milestone.status === MILESTONE_OVERDUE ||
        (milestone.status === MILESTONE_UPCOMING && milestone.workdaysLeft <= MILESTONE_AT_RISK_WORKDAYS))

// ---------------------------------------------------------------- candidates

/**
 * The Today tasks of all projects, frozen into plan candidates. `openTasksMap` is the redux map
 * `{ [projectId]: { [taskId]: task } }` the task lists already load (the same source as the
 * existing Auto-postpone modal). `projectOrder` is the display order of the project groups;
 * `projectPriorityOrder` is the user's project-list order used for ranking (defaults to
 * `projectOrder`). `goalsByProject` / `openMilestonesByProject` are the redux maps the Today list
 * loads per project; a project without them simply has no milestone data (neutral).
 */
export const buildPlanCandidates = ({
    openTasksMap,
    projectOrder = [],
    projectPriorityOrder = null,
    userId,
    endOfDay,
    nowMs = Date.now(),
    focusTaskId = null,
    focusProjectId = null,
    goalsByProject = {},
    openMilestonesByProject = {},
}) => {
    const rank = new Map(projectOrder.map((projectId, index) => [projectId, index]))
    const priorityRankMap = new Map(
        (projectPriorityOrder || projectOrder).map((projectId, index) => [projectId, index])
    )
    const candidates = []
    let meetingCount = 0
    Object.keys(openTasksMap || {}).forEach(projectId => {
        Object.values(openTasksMap[projectId] || {}).forEach(task => {
            if (!task || !task.id || !isPlanTodayTask(task, userId, endOfDay)) return
            if (task.calendarData) {
                meetingCount++
                return
            }
            const storedEstimate = getStoredEstimateMinutes(task)
            const timesPostponed = Number(task.timesPostponed) || 0
            const goalId = task.parentGoalId || null
            candidates.push({
                key: `${projectId}:${task.id}`,
                projectId,
                taskId: task.id,
                name: task.name || task.extendedName || '',
                priority: task.priority || 'none',
                isObservedTask: !!task.isObservedTask,
                storedEstimate,
                estimateKnown: storedEstimate > 0,
                timesPostponed,
                goalLinked: !!goalId,
                goalKey: goalId ? `${projectId}:${goalId}` : null,
                milestone: resolveTaskMilestone({
                    goalId,
                    goalsById: goalsByProject?.[projectId],
                    openMilestones: openMilestonesByProject?.[projectId],
                    nowMs,
                }),
                projectRank: priorityRankMap.has(projectId) ? priorityRankMap.get(projectId) : Number.MAX_SAFE_INTEGER,
                isFocus: task.id === focusTaskId && (!focusProjectId || focusProjectId === projectId),
                dueDate: getEffectiveDueDate(task, userId),
                sortIndex: Number(task.sortIndex) || 0,
                destinationKey: getDestinationKey(timesPostponed, !!task.isObservedTask),
            })
        })
    })
    // Static goal effort (stored estimates) for the order inside a project; the proposal recomputes
    // it with the user's estimate edits.
    const effort = computeGoalEffort(candidates)
    candidates.forEach(candidate => {
        candidate.goalEffortMinutes = candidate.goalKey ? effort.get(candidate.goalKey) || 0 : 0
    })
    const projectRank = projectId => (rank.has(projectId) ? rank.get(projectId) : Number.MAX_SAFE_INTEGER)
    const projectIds = [...new Set(candidates.map(candidate => candidate.projectId))].sort(
        (a, b) => projectRank(a) - projectRank(b) || a.localeCompare(b)
    )
    return { candidates, meetingCount, projectIds }
}

// ---------------------------------------------------------------- proposal

const PROPOSAL_PRIORITY_RANK = {
    [TASK_PRIORITY_MUST_DO]: 5,
    [TASK_PRIORITY_SHOULD_DO]: 4,
    [TASK_PRIORITY_COULD_DO]: 3,
    none: 2,
    [TASK_PRIORITY_DO_LATER]: 1,
}
const priorityRank = priority => PROPOSAL_PRIORITY_RANK[priority] || PROPOSAL_PRIORITY_RANK.none

export const getEstimate = (candidate, estimateOverrides = {}) =>
    estimateOverrides[candidate.key] || candidate.storedEstimate || UNKNOWN_ESTIMATE_MINUTES

/** Minutes of due work per goal (Do later excluded): `Map(goalKey → minutes)`. */
export const computeGoalEffort = (candidates, estimateOverrides = {}) => {
    const effort = new Map()
    candidates.forEach(candidate => {
        if (!candidate.goalKey || candidate.priority === TASK_PRIORITY_DO_LATER) return
        effort.set(candidate.goalKey, (effort.get(candidate.goalKey) || 0) + getEstimate(candidate, estimateOverrides))
    })
    return effort
}

// Inside a project: an active milestone first, the fewest workdays left first, then the goal that
// needs more work per remaining workday, then the earlier date.
const compareMilestones = (a, b) => {
    const activeA = hasActiveMilestone(a)
    const activeB = hasActiveMilestone(b)
    if (activeA !== activeB) return activeA ? -1 : 1
    if (!activeA) return 0
    return (
        a.milestone.workdaysLeft - b.milestone.workdaysLeft ||
        (b.goalEffortMinutes || 0) / b.milestone.workdaysLeft - (a.goalEffortMinutes || 0) / a.milestone.workdaysLeft ||
        a.milestone.date - b.milestone.date
    )
}

/**
 * Best fit first. Also the order of each project's Not today list and (reversed) of the overload
 * suggestions. Project-list order first, then priority, milestone, fewer postpones, list order.
 * The due date is deliberately not a key: being overdue longer is not a reason to rank higher.
 */
export const compareByFit = (a, b) =>
    (a.projectRank ?? Number.MAX_SAFE_INTEGER) - (b.projectRank ?? Number.MAX_SAFE_INTEGER) ||
    priorityRank(b.priority) - priorityRank(a.priority) ||
    compareMilestones(a, b) ||
    a.timesPostponed - b.timesPostponed ||
    b.sortIndex - a.sortIndex ||
    a.name.localeCompare(b.name)

const tierFromPriority = priority =>
    priority === TASK_PRIORITY_MUST_DO ? TIER_MUST : priority === TASK_PRIORITY_COULD_DO ? TIER_COULD : TIER_SHOULD

/**
 * Goals whose dated milestone is imminent: `[{ goalKey, milestone, effortMinutes, workdaysLeft,
 * shareMinutes }]`, nearest milestone first, then project-list order. `shareMinutes` = the goal's due
 * work spread evenly over the workdays left (rounded up): what has to happen today so that further
 * delay does not jeopardize the milestone.
 */
export const getMilestonesAtRisk = (candidates, estimateOverrides = {}) => {
    const effort = computeGoalEffort(candidates, estimateOverrides)
    const byGoal = new Map()
    candidates.forEach(candidate => {
        if (!candidate.goalKey || byGoal.has(candidate.goalKey) || !isMilestoneImminent(candidate.milestone)) return
        const effortMinutes = effort.get(candidate.goalKey) || 0
        if (effortMinutes <= 0) return
        const workdaysLeft = candidate.milestone.workdaysLeft
        byGoal.set(candidate.goalKey, {
            goalKey: candidate.goalKey,
            projectRank: candidate.projectRank ?? Number.MAX_SAFE_INTEGER,
            milestone: candidate.milestone,
            effortMinutes,
            workdaysLeft,
            shareMinutes: Math.ceil(effortMinutes / workdaysLeft),
        })
    })
    return [...byGoal.values()].sort(
        (a, b) =>
            a.milestone.date - b.milestone.date || a.projectRank - b.projectRank || a.goalKey.localeCompare(b.goalKey)
    )
}

/**
 * Anna's proposal: `{ [key]: { tier, rule, detail? } }`. Runs when the review opens and on an
 * explicit "Re-propose"; the user's own edits are overrides on top and are never re-flowed silently.
 * `keepTiers` (the user's overrides) are honoured first so a re-proposal fills around them.
 * `detail` (milestone rows): `{ shareMinutes, effortMinutes, workdaysLeft }` for the visible reason.
 */
export const proposePlan = (candidates, budgetMinutes, { estimateOverrides = {}, keepTiers = {} } = {}) => {
    const proposal = {}
    let used = 0
    const take = (candidate, tier, rule, detail) => {
        proposal[candidate.key] = detail ? { tier, rule, detail } : { tier, rule }
        if (tier !== TIER_LATER) used += getEstimate(candidate, estimateOverrides)
    }

    candidates.forEach(candidate => {
        if (keepTiers[candidate.key]) take(candidate, keepTiers[candidate.key], RULE_YOU)
    })
    const open = () => candidates.filter(candidate => !proposal[candidate.key])

    open()
        .filter(candidate => candidate.priority === TASK_PRIORITY_MUST_DO)
        .forEach(candidate => take(candidate, TIER_MUST, RULE_YOUR_MUST))
    open()
        .filter(candidate => candidate.isFocus && candidate.priority !== TASK_PRIORITY_DO_LATER)
        .forEach(candidate => take(candidate, tierFromPriority(candidate.priority), RULE_FOCUS))

    // Milestones at risk: today's share of the goal's due work, ahead of the project order.
    const atRisk = getMilestonesAtRisk(candidates, estimateOverrides)
    const riskByGoal = new Map(atRisk.map(goal => [goal.goalKey, goal]))
    atRisk.forEach(goal => {
        const goalCandidates = candidates.filter(candidate => candidate.goalKey === goal.goalKey)
        let needed =
            goal.shareMinutes -
            goalCandidates
                .filter(candidate => proposal[candidate.key] && proposal[candidate.key].tier !== TIER_LATER)
                .reduce((total, candidate) => total + getEstimate(candidate, estimateOverrides), 0)
        const detail = {
            shareMinutes: goal.shareMinutes,
            effortMinutes: goal.effortMinutes,
            workdaysLeft: goal.workdaysLeft,
        }
        goalCandidates
            .filter(candidate => !proposal[candidate.key] && candidate.priority !== TASK_PRIORITY_DO_LATER)
            .sort(compareByFit)
            .forEach(candidate => {
                if (needed <= 0) return
                const estimate = getEstimate(candidate, estimateOverrides)
                if (used + estimate > budgetMinutes) return
                take(candidate, tierFromPriority(candidate.priority), RULE_MILESTONE_AT_RISK, detail)
                needed -= estimate
            })
    })

    open()
        .filter(candidate => candidate.priority !== TASK_PRIORITY_DO_LATER)
        .sort(compareByFit)
        .forEach(candidate => {
            const estimate = getEstimate(candidate, estimateOverrides)
            const risk = candidate.goalKey ? riskByGoal.get(candidate.goalKey) : null
            if (used + estimate > budgetMinutes) {
                proposal[candidate.key] = risk
                    ? {
                          tier: TIER_LATER,
                          rule: RULE_NO_ROOM,
                          detail: {
                              shareMinutes: risk.shareMinutes,
                              effortMinutes: risk.effortMinutes,
                              workdaysLeft: risk.workdaysLeft,
                          },
                      }
                    : { tier: TIER_LATER, rule: RULE_NO_ROOM }
                return
            }
            const rule =
                candidate.priority === TASK_PRIORITY_SHOULD_DO || candidate.priority === TASK_PRIORITY_COULD_DO
                    ? RULE_YOUR_PRIORITY
                    : candidate.goalLinked
                      ? RULE_GOAL
                      : RULE_RANKED
            take(candidate, tierFromPriority(candidate.priority), rule)
        })

    open().forEach(candidate => {
        proposal[candidate.key] = { tier: TIER_LATER, rule: RULE_DO_LATER }
    })
    return proposal
}

// ---------------------------------------------------------------- summary

/**
 * The current plan = proposal + the user's overrides, with every derived number. All totals are
 * sums over the same rows, so project subtotals always add up to the overall figures.
 */
export const summarizePlan = ({ candidates, proposal, tierOverrides = {}, estimateOverrides = {}, capacity }) => {
    const rows = candidates.map(candidate => {
        const proposed = proposal[candidate.key] || { tier: TIER_LATER, rule: RULE_NO_ROOM }
        const override = tierOverrides[candidate.key]
        const tier = override || proposed.tier
        return {
            key: candidate.key,
            candidate,
            tier,
            proposedTier: proposed.tier,
            rule: override && override !== proposed.tier ? RULE_YOU : proposed.rule,
            detail: override && override !== proposed.tier ? null : proposed.detail || null,
            estimate: getEstimate(candidate, estimateOverrides),
            estimateKnown: !!estimateOverrides[candidate.key] || candidate.estimateKnown,
            selected: tier !== TIER_LATER,
        }
    })
    const selectedRows = rows.filter(row => row.selected)
    const minutesOf = list => list.reduce((total, row) => total + row.estimate, 0)
    const tierCounts = {}
    const tierMinutes = {}
    PLAN_TIERS.forEach(tier => {
        const tierRows = selectedRows.filter(row => row.tier === tier)
        tierCounts[tier] = tierRows.length
        tierMinutes[tier] = minutesOf(tierRows)
    })
    const selectedMinutes = minutesOf(selectedRows)
    const budgetMinutes = capacity?.status === 'ready' ? capacity.budgetMinutes : 0
    const freeMinutes = capacity?.status === 'ready' ? capacity.freeMinutes : 0
    return {
        rows,
        selectedCount: selectedRows.length,
        selectedMinutes,
        laterCount: rows.length - selectedRows.length,
        allCount: rows.length,
        tierCounts,
        tierMinutes,
        mustMinutes: tierMinutes[TIER_MUST],
        unknownEstimateCount: selectedRows.filter(row => !row.estimateKnown).length,
        budgetMinutes,
        freeMinutes,
        remainingMinutes: budgetMinutes - selectedMinutes,
        overMinutes: Math.max(0, selectedMinutes - budgetMinutes),
        isOverBudget: selectedMinutes > budgetMinutes,
        // Even your Must tasks alone do not fit: the "Overload" state.
        isOverloaded: tierMinutes[TIER_MUST] > budgetMinutes,
    }
}

/**
 * Overload help: the selected tasks Anna suggests moving out to get back within the budget —
 * weakest fit first (lowest project first), Could before Should, milestone-at-risk rows last. Your Must tasks and the focus task are never suggested;
 * `remainingOverMinutes` is what is still over when they alone exceed the budget.
 */
export const suggestOverloadMoves = summary => {
    if (!summary.isOverBudget) return { moves: [], remainingOverMinutes: 0 }
    const movable = summary.rows
        .filter(row => row.selected && row.tier !== TIER_MUST && !row.candidate.isFocus)
        .sort(
            (a, b) =>
                Number(a.rule === RULE_MILESTONE_AT_RISK) - Number(b.rule === RULE_MILESTONE_AT_RISK) ||
                TIER_ORDER[b.tier] - TIER_ORDER[a.tier] ||
                compareByFit(b.candidate, a.candidate)
        )
    const moves = []
    let over = summary.overMinutes
    for (const row of movable) {
        if (over <= 0) break
        moves.push(row)
        over -= row.estimate
    }
    return { moves, remainingOverMinutes: Math.max(0, over) }
}

// ---------------------------------------------------------------- project grouping

/** Selected rows: Must → Should → Could, then best fit (the task list's priority-first order). */
export const compareSelectedRows = (a, b) =>
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || compareByFit(a.candidate, b.candidate)

const rowMatches = (row, query) => !query || row.candidate.name.toLowerCase().includes(query)

/**
 * Per-project groups in sidebar order (`projectIds` from buildPlanCandidates). `query` filters the
 * rows by name; the counts and minutes always describe the whole project.
 */
export const groupPlanByProject = (summary, projectIds, query = '') => {
    const normalizedQuery = (query || '').trim().toLowerCase()
    const projects = projectIds
        .map(projectId => {
            const rows = summary.rows.filter(row => row.candidate.projectId === projectId)
            if (rows.length === 0) return null
            const selected = rows.filter(row => row.selected).sort(compareSelectedRows)
            const later = rows.filter(row => !row.selected).sort((a, b) => compareByFit(a.candidate, b.candidate))
            const tierCounts = {}
            PLAN_TIERS.forEach(tier => {
                tierCounts[tier] = selected.filter(row => row.tier === tier).length
            })
            return {
                projectId,
                selected,
                later,
                visibleSelected: selected.filter(row => rowMatches(row, normalizedQuery)),
                visibleLater: later.filter(row => rowMatches(row, normalizedQuery)),
                selectedCount: selected.length,
                selectedMinutes: selected.reduce((total, row) => total + row.estimate, 0),
                laterCount: later.length,
                allCount: rows.length,
                tierCounts,
            }
        })
        .filter(Boolean)
    return {
        projects,
        totals: {
            selectedCount: projects.reduce((total, project) => total + project.selectedCount, 0),
            selectedMinutes: projects.reduce((total, project) => total + project.selectedMinutes, 0),
            laterCount: projects.reduce((total, project) => total + project.laterCount, 0),
            allCount: projects.reduce((total, project) => total + project.allCount, 0),
        },
    }
}

// ---------------------------------------------------------------- postpone confirmation

/**
 * Default tick in the postpone check: only Someday is opt-in. How often a task was postponed gives
 * it no protection; a task whose milestone is at risk is ticked too but shows the warning.
 */
export const isDefaultTicked = row => row.candidate.destinationKey !== DESTINATION_SOMEDAY

export const isRowTicked = (row, ticks = {}) =>
    Object.prototype.hasOwnProperty.call(ticks, row.key) ? !!ticks[row.key] : isDefaultTicked(row)

/**
 * Destination first, project second. Also the reconciliation per project and overall:
 * planned + postponed + stays = due today.
 */
export const buildPostponeView = (summary, projectIds, ticks = {}) => {
    const later = summary.rows.filter(row => !row.selected)
    const projectRank = new Map(projectIds.map((projectId, index) => [projectId, index]))
    const byProject = (a, b) =>
        (projectRank.get(a) ?? Number.MAX_SAFE_INTEGER) - (projectRank.get(b) ?? Number.MAX_SAFE_INTEGER)

    const groups = DESTINATIONS.map(destination => {
        const rows = later.filter(row => row.candidate.destinationKey === destination.key)
        const projects = [...new Set(rows.map(row => row.candidate.projectId))].sort(byProject).map(projectId => {
            const projectRows = rows
                .filter(row => row.candidate.projectId === projectId)
                .sort((a, b) => compareByFit(a.candidate, b.candidate))
            return {
                projectId,
                rows: projectRows,
                tickedCount: projectRows.filter(row => isRowTicked(row, ticks)).length,
            }
        })
        return {
            key: destination.key,
            isSomeday: destination.key === DESTINATION_SOMEDAY,
            rows,
            projects,
            tickedCount: rows.filter(row => isRowTicked(row, ticks)).length,
        }
    }).filter(group => group.rows.length > 0)

    const moved = later.filter(row => isRowTicked(row, ticks))
    const stays = later.filter(row => !isRowTicked(row, ticks))
    const perProject = projectIds
        .map(projectId => {
            const rows = summary.rows.filter(row => row.candidate.projectId === projectId)
            return {
                projectId,
                planned: rows.filter(row => row.selected).length,
                postponed: moved.filter(row => row.candidate.projectId === projectId).length,
                stays: stays.filter(row => row.candidate.projectId === projectId).length,
                all: rows.length,
            }
        })
        .filter(project => project.all > 0)
    return {
        groups,
        moved,
        stays,
        perProject,
        totals: {
            planned: summary.selectedCount,
            postponed: moved.length,
            stays: stays.length,
            all: summary.allCount,
        },
    }
}

/** Ticks after toggling a set of rows (a task, a project inside a destination, a destination). */
export const toggleTicks = (ticks, rows, value) => {
    const next = { ...ticks }
    rows.forEach(row => {
        if (value === isDefaultTicked(row)) delete next[row.key]
        else next[row.key] = value
    })
    return next
}

// ---------------------------------------------------------------- apply

/** The callable payload (functions/Tasks/dailyPlanService.js). */
export const buildApplyTasks = (summary, postponeView) => {
    const moved = new Set(postponeView.moved.map(row => row.key))
    return summary.rows.map(row => {
        const base = {
            projectId: row.candidate.projectId,
            taskId: row.candidate.taskId,
            isObservedTask: row.candidate.isObservedTask,
        }
        if (row.selected) {
            return { ...base, decision: 'plan', priority: TIER_PRIORITY[row.tier], estimateMinutes: row.estimate }
        }
        if (moved.has(row.key)) {
            return {
                ...base,
                decision: 'postpone',
                confirmSomeday: row.candidate.destinationKey === DESTINATION_SOMEDAY,
            }
        }
        return { ...base, decision: 'keep' }
    })
}

// ---------------------------------------------------------------- formatting

/** "2h 30m", "45m", "0m"; negative values get a minus sign. */
export const formatPlanDuration = minutes => {
    const value = Math.round(Number(minutes) || 0)
    const sign = value < 0 ? '−' : ''
    const total = Math.abs(value)
    const hours = Math.floor(total / 60)
    const rest = total % 60
    if (hours && rest) return `${sign}${hours}h ${rest}m`
    if (hours) return `${sign}${hours}h`
    return `${sign}${rest}m`
}
