import {
    ASSUMED_MEETING_OPTIONS,
    DESTINATION_SOMEDAY,
    MILESTONE_AT_RISK_WORKDAYS,
    MILESTONE_KIND_DATED,
    MILESTONE_KIND_PERIOD,
    MILESTONE_NONE,
    MILESTONE_OVERDUE,
    MILESTONE_OVERDUE_GRACE_DAYS,
    MILESTONE_STALE,
    MILESTONE_UNKNOWN,
    MILESTONE_UPCOMING,
    PLAN_FILL_SHARE,
    RULE_DO_LATER,
    RULE_FOCUS,
    RULE_GOAL,
    RULE_MILESTONE_AT_RISK,
    RULE_NO_ROOM,
    RULE_RANKED,
    RULE_YOU,
    RULE_YOUR_MUST,
    RULE_YOUR_PRIORITY,
    TIER_COULD,
    TIER_LATER,
    TIER_MUST,
    TIER_SHOULD,
    UNKNOWN_ESTIMATE_MINUTES,
    buildApplyTasks,
    buildPlanCandidates,
    buildPostponeView,
    compareByFit,
    computePlanCapacity,
    countWorkdaysLeft,
    formatPlanDuration,
    getDestinationDate,
    getDestinationKey,
    getMilestonesAtRisk,
    groupPlanByProject,
    isDefaultTicked,
    isMilestoneImminent,
    proposePlan,
    resolveTaskMilestone,
    suggestOverloadMoves,
    summarizePlan,
    toggleTicks,
} from './dailyPlanModel'

// Monday 23 Nov 2026, 9:00 local time.
const NOW = new Date(2026, 10, 23, 9, 0).getTime()
const END_OF_DAY = new Date(2026, 10, 23, 23, 59, 59, 999).getTime()
// Milestones are stored at noon of their day (like the real goalsMilestones documents).
const dayAt = (month, day) => new Date(2026, month, day, 12, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

const readyView = (meetingMinutes, windowMinutes = 540) => ({
    status: 'ready',
    workingHours: { start: '09:00', end: '18:00', isDefault: false },
    windowMinutes,
    meetingMinutes,
    freeMinutes: windowMinutes - meetingMinutes,
})

let sortIndex = 1000
const task = (id, fields = {}) => ({
    id,
    name: id,
    dueDate: NOW - DAY,
    priority: 'none',
    timesPostponed: 0,
    estimations: { [-1]: 30 },
    sortIndex: sortIndex--,
    ...fields,
})

const build = (openTasksMap, extra = {}) =>
    buildPlanCandidates({
        openTasksMap,
        projectOrder: ['product', 'client', 'private'],
        userId: 'u1',
        endOfDay: END_OF_DAY,
        nowMs: NOW,
        ...extra,
    })

// A goal as mapGoalData returns it: completionMilestoneDate is the milestone it is due at.
const goal = (id, completionMilestoneDate, fields = {}) => ({
    id,
    startingMilestoneDate: completionMilestoneDate,
    completionMilestoneDate,
    scheduleMode: 'fixed',
    progress: 'DYNAMIC_PERCENT',
    dynamicProgress: 0,
    ...fields,
})

const plan = (openTasksMap, capacity, { tierOverrides = {}, estimateOverrides = {}, extra } = {}) => {
    const { candidates, projectIds, meetingCount } = build(openTasksMap, extra)
    // Like the modal: the proposal is made once; the user's edits are layered on top of it.
    const proposal = proposePlan(candidates, capacity.budgetMinutes)
    const summary = summarizePlan({ candidates, proposal, tierOverrides, estimateOverrides, capacity })
    return { candidates, projectIds, meetingCount, proposal, summary }
}

describe('capacity', () => {
    it('fills 80% of time to work (working hours minus meetings) and keeps the rest as buffer', () => {
        const capacity = computePlanCapacity({ ...readyView(90), meetingCount: 2 })
        expect(PLAN_FILL_SHARE).toBe(0.8)
        expect(capacity.meetingCount).toBe(2)
        expect(capacity).toMatchObject({
            status: 'ready',
            provisional: false,
            windowMinutes: 540,
            meetingMinutes: 90,
            freeMinutes: 450,
            budgetMinutes: 360,
            bufferMinutes: 90,
        })
    })

    it('waits while the hours or the calendar are loading instead of planning on unknown numbers', () => {
        expect(computePlanCapacity(null)).toEqual({ status: 'loading' })
        expect(computePlanCapacity({ status: 'loading' })).toEqual({ status: 'loading' })
        expect(computePlanCapacity({ ...readyView(0), status: 'calendarLoading' })).toEqual({ status: 'loading' })
    })

    it('uses the assumed meeting time when no calendar is connected or readable, marked provisional', () => {
        ASSUMED_MEETING_OPTIONS.forEach(assumed => {
            const capacity = computePlanCapacity(
                { ...readyView(0), status: 'noCalendar', meetingMinutes: undefined },
                assumed
            )
            expect(capacity).toMatchObject({
                provisional: true,
                meetingMinutes: assumed,
                freeMinutes: 540 - assumed,
                meetingCount: 0,
            })
            expect(capacity.budgetMinutes).toBe(Math.round((540 - assumed) * 0.8))
        })
        expect(computePlanCapacity({ ...readyView(0), status: 'calendarUnavailable' }, 60).provisional).toBe(true)
    })

    it('never goes negative when meetings fill the day', () => {
        expect(computePlanCapacity(readyView(600, 540))).toMatchObject({ freeMinutes: 0, budgetMinutes: 0 })
    })
})

describe('candidates', () => {
    it('takes open top-level tasks due today or earlier from every project; meetings are counted, not planned', () => {
        const { candidates, meetingCount, projectIds } = build({
            client: { c1: task('c1') },
            product: {
                due: task('due'),
                future: task('future', { dueDate: END_OF_DAY + 1 }),
                someday: task('someday', { dueDate: Number.MAX_SAFE_INTEGER }),
                done: task('done', { done: true }),
                sub: task('sub', { parentId: 'due' }),
                meeting: task('meeting', { calendarData: { start: {}, end: {} } }),
                observed: task('observed', {
                    isObservedTask: true,
                    dueDate: END_OF_DAY + DAY,
                    dueDateByObserversIds: { u1: NOW },
                }),
            },
        })
        expect(candidates.map(candidate => candidate.key).sort()).toEqual([
            'client:c1',
            'product:due',
            'product:observed',
        ])
        expect(meetingCount).toBe(1)
        expect(projectIds).toEqual(['product', 'client'])
    })

    it('flags unknown estimates (counted as 30m); a goal link alone gives no flag or protection', () => {
        const { candidates } = build({
            product: {
                unknown: task('unknown', { estimations: {} }),
                zero: task('zero', { estimations: { [-1]: 0 } }),
                old: task('old', { parentGoalId: 'g1', timesPostponed: 3 }),
                plain: task('plain'),
            },
        })
        const byId = Object.fromEntries(candidates.map(candidate => [candidate.taskId, candidate]))
        expect(byId.unknown).toMatchObject({ estimateKnown: false, storedEstimate: 0 })
        expect(byId.zero.estimateKnown).toBe(false)
        expect(byId.old).not.toHaveProperty('protected')
        expect(byId.old).toMatchObject({ goalLinked: true, goalKey: 'product:g1' })
        // No goal data handed in for the project: the milestone is unknown, never invented.
        expect(byId.old.milestone).toEqual({ status: MILESTONE_UNKNOWN })
        expect(byId.plain.milestone).toEqual({ status: MILESTONE_NONE })
        expect(UNKNOWN_ESTIMATE_MINUTES).toBe(30)
    })

    it('ranks by the project-list order, which can differ from the display order of the groups', () => {
        const { candidates, projectIds } = build(
            { product: { p: task('p') }, client: { c: task('c') } },
            { projectOrder: ['client', 'product'], projectPriorityOrder: ['product', 'client'] }
        )
        expect(projectIds).toEqual(['client', 'product']) // display: e.g. focus project on top
        const byId = Object.fromEntries(candidates.map(candidate => [candidate.taskId, candidate]))
        expect(byId.p.projectRank).toBe(0)
        expect(byId.c.projectRank).toBe(1)
    })
})

describe('proposal', () => {
    it('always keeps your Must tasks and the focus task, then fills by fit while it fits', () => {
        const capacity = computePlanCapacity(readyView(390)) // free 150, budget 120
        const { summary, proposal } = plan(
            {
                product: {
                    must: task('must', { priority: 'must_do', estimations: { [-1]: 60 } }),
                    focus: task('focus', { estimations: { [-1]: 30 } }),
                    should: task('should', { priority: 'should_do', estimations: { [-1]: 45 } }),
                    plain: task('plain', { estimations: { [-1]: 15 } }),
                    later: task('later', { priority: 'do_later', estimations: { [-1]: 15 } }),
                },
            },
            capacity,
            { extra: { focusTaskId: 'focus', focusProjectId: 'product' } }
        )
        expect(proposal['product:must']).toEqual({ tier: TIER_MUST, rule: RULE_YOUR_MUST })
        expect(proposal['product:focus']).toEqual({ tier: TIER_SHOULD, rule: RULE_FOCUS })
        expect(proposal['product:should'].tier).toBe(TIER_LATER) // 60 + 30 + 45 > 120
        expect(proposal['product:should'].rule).toBe(RULE_NO_ROOM)
        expect(proposal['product:plain'].tier).toBe(TIER_SHOULD) // 15 still fits
        expect(proposal['product:later']).toEqual({ tier: TIER_LATER, rule: RULE_DO_LATER })
        expect(summary.selectedMinutes).toBe(105)
        expect(summary.selectedMinutes).toBeLessThanOrEqual(capacity.budgetMinutes)
    })

    it('inside a project: Should, Could, then the rest; goal work without a milestone gets no bonus', () => {
        const capacity = computePlanCapacity(readyView(540 - 75)) // free 75, budget 60
        const { proposal } = plan(
            {
                product: {
                    a: task('a'),
                    b: task('b', { parentGoalId: 'g', timesPostponed: 4 }),
                    c: task('c', { priority: 'could_do' }),
                    s: task('s', { priority: 'should_do' }),
                },
            },
            capacity
        )
        expect(proposal['product:s']).toEqual({ tier: TIER_SHOULD, rule: RULE_YOUR_PRIORITY })
        expect(proposal['product:c']).toEqual({ tier: TIER_COULD, rule: RULE_YOUR_PRIORITY })
        expect(proposal['product:a'].tier).toBe(TIER_LATER)
        expect(proposal['product:b'].tier).toBe(TIER_LATER)
    })

    it('a re-proposal keeps the user’s own tier decisions and fills around them', () => {
        const capacity = computePlanCapacity(readyView(540 - 75))
        const { candidates } = build({ product: { a: task('a'), b: task('b'), c: task('c') } })
        const keepTiers = { 'product:c': TIER_MUST }
        const proposal = proposePlan(candidates, capacity.budgetMinutes, { keepTiers })
        expect(proposal['product:c']).toEqual({ tier: TIER_MUST, rule: RULE_YOU })
        expect(Object.values(proposal).filter(item => item.tier !== TIER_LATER)).toHaveLength(2)
    })
})

describe('summary, edits and overload', () => {
    const capacity = computePlanCapacity(readyView(540 - 150)) // free 150, budget 120

    it('removing, adding, re-prioritising and re-estimating update all totals consistently', () => {
        const openTasksMap = {
            product: { a: task('a'), b: task('b'), c: task('c', { estimations: {} }) },
            client: { d: task('d', { priority: 'should_do' }), e: task('e') },
        }
        const base = plan(openTasksMap, capacity).summary
        expect(base.selectedCount).toBe(4)
        expect(base.selectedMinutes).toBe(120)
        expect(base.unknownEstimateCount).toBe(1)

        const edited = plan(openTasksMap, capacity, {
            tierOverrides: { 'product:a': TIER_LATER, 'client:e': TIER_MUST },
            estimateOverrides: { 'product:c': 60 },
        }).summary
        expect(edited.rows.find(row => row.key === 'product:a').rule).toBe(RULE_YOU)
        expect(edited.selectedCount).toBe(4)
        expect(edited.selectedMinutes).toBe(30 + 60 + 30 + 30)
        expect(edited.unknownEstimateCount).toBe(0)
        expect(edited.tierCounts).toEqual({ must: 1, should: 3, could: 0 })
        expect(edited.isOverBudget).toBe(true)
        expect(edited.overMinutes).toBe(30)
        expect(edited.selectedCount + edited.laterCount).toBe(edited.allCount)
    })

    it('overload: Must tasks alone exceed the budget; none is dropped and Anna only suggests other moves', () => {
        const tight = computePlanCapacity(readyView(540 - 100)) // budget 80
        const { summary } = plan(
            {
                product: {
                    m1: task('m1', { priority: 'must_do', estimations: { [-1]: 60 } }),
                    m2: task('m2', { priority: 'must_do', estimations: { [-1]: 60 } }),
                    s: task('s', { priority: 'should_do', estimations: { [-1]: 30 } }),
                },
            },
            tight,
            { tierOverrides: { 'product:s': TIER_SHOULD } }
        )
        expect(summary.isOverloaded).toBe(true)
        expect(summary.rows.filter(row => row.tier === TIER_MUST)).toHaveLength(2)
        const { moves, remainingOverMinutes } = suggestOverloadMoves(summary)
        expect(moves.map(row => row.key)).toEqual(['product:s'])
        expect(remainingOverMinutes).toBe(40)
    })

    it('suggests the weakest fits first and stops once the gap is closed', () => {
        const { summary } = plan(
            {
                product: {
                    a: task('a'),
                    b: task('b', { priority: 'could_do' }),
                    c: task('c', { priority: 'should_do' }),
                },
            },
            capacity,
            {
                tierOverrides: { 'product:a': TIER_SHOULD, 'product:b': TIER_COULD, 'product:c': TIER_SHOULD },
                estimateOverrides: { 'product:a': 120 },
            }
        )
        expect(summary.overMinutes).toBe(60)
        const { moves, remainingOverMinutes } = suggestOverloadMoves(summary)
        expect(moves[0].key).toBe('product:b')
        expect(remainingOverMinutes).toBe(0)
        expect(suggestOverloadMoves(plan({ product: { a: task('a') } }, capacity).summary).moves).toEqual([])
    })
})

describe('project grouping', () => {
    it('groups by project in sidebar order with counts and minutes that add up to the totals', () => {
        const capacity = computePlanCapacity(readyView(540 - 250)) // budget 200
        const { summary, projectIds } = plan(
            {
                private: { p1: task('p1') },
                client: { c1: task('c1', { priority: 'could_do' }), c2: task('c2') },
                product: {
                    a: task('a'),
                    m: task('m', { priority: 'must_do' }),
                    s: task('s', { priority: 'should_do' }),
                    x: task('x', { priority: 'do_later' }),
                },
            },
            capacity
        )
        const grouped = groupPlanByProject(summary, projectIds)
        expect(grouped.projects.map(project => project.projectId)).toEqual(['product', 'client', 'private'])
        const product = grouped.projects[0]
        // Priority order inside the project: Must, Should, then the rest.
        expect(product.selected.map(row => row.candidate.taskId)).toEqual(['m', 's', 'a'])
        expect(product.later.map(row => row.candidate.taskId)).toEqual(['x'])
        expect(product).toMatchObject({ selectedCount: 3, selectedMinutes: 90, laterCount: 1, allCount: 4 })
        expect(product.tierCounts).toEqual({ must: 1, should: 2, could: 0 })
        expect(grouped.totals.selectedCount).toBe(summary.selectedCount)
        expect(grouped.totals.selectedMinutes).toBe(summary.selectedMinutes)
        expect(grouped.totals.laterCount).toBe(summary.laterCount)
        expect(grouped.totals.allCount).toBe(summary.allCount)
    })

    it('search filters the visible rows across projects without changing the subtotals', () => {
        const capacity = computePlanCapacity(readyView(540 - 40)) // budget 32
        const { summary, projectIds } = plan(
            {
                product: { a: task('a', { name: 'Write invoice' }), b: task('b', { name: 'Call bank' }) },
                client: { c: task('c', { name: 'Invoice client' }) },
            },
            capacity
        )
        const grouped = groupPlanByProject(summary, projectIds, 'invoice')
        const visible = grouped.projects.flatMap(project => [...project.visibleSelected, ...project.visibleLater])
        expect(visible.map(row => row.candidate.name).sort()).toEqual(['Invoice client', 'Write invoice'])
        expect(grouped.totals.allCount).toBe(3)
    })
})

describe('postpone confirmation', () => {
    const capacity = computePlanCapacity(readyView(540)) // budget 0 → everything not today
    const openTasksMap = {
        product: {
            t0: task('t0', { timesPostponed: 0 }),
            t1: task('t1', { timesPostponed: 1 }),
            t6: task('t6', { timesPostponed: 6 }),
            prot: task('prot', { timesPostponed: 4, parentGoalId: 'g' }),
        },
        client: { c0: task('c0'), c6: task('c6', { timesPostponed: 9 }) },
        private: { obs: task('obs', { isObservedTask: true, timesPostponed: 8, dueDateByObserversIds: { u1: NOW } }) },
    }

    it('maps the existing ladder to destinations (observed tasks always 3 days)', () => {
        expect([0, 1, 2, 3, 4, 5, 6, 12].map(count => getDestinationKey(count, false))).toEqual([
            '3d',
            '1w',
            '1m',
            '3m',
            '6m',
            '1y',
            'someday',
            'someday',
        ])
        expect(getDestinationKey(8, true)).toBe('3d')
        expect(getDestinationDate('1w', NOW)).toBe(NOW + 7 * DAY)
        expect(getDestinationDate(DESTINATION_SOMEDAY, NOW)).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('groups destination first, project second; only Someday is opt-in (no protection for postponed goal work)', () => {
        const { summary, projectIds } = plan(openTasksMap, capacity)
        const view = buildPostponeView(summary, projectIds)
        expect(view.groups.map(group => group.key)).toEqual(['3d', '1w', '6m', 'someday'])
        expect(view.groups[0].projects.map(project => project.projectId)).toEqual(['product', 'client', 'private'])
        const someday = view.groups.find(group => group.isSomeday)
        expect(someday.projects.map(project => project.projectId)).toEqual(['product', 'client'])
        expect(someday.tickedCount).toBe(0)
        // The goal task postponed 4× is ticked like any other task.
        expect(view.groups.find(group => group.key === '6m').tickedCount).toBe(1)
        expect(view.totals).toEqual({ planned: 0, postponed: 5, stays: 2, all: 7 })
    })

    it('reconciles planned + postponed + stays = due today per project and overall after toggles', () => {
        const { summary, projectIds } = plan(openTasksMap, capacity, { tierOverrides: { 'product:t0': TIER_SHOULD } })
        let view = buildPostponeView(summary, projectIds)
        const someday = view.groups.find(group => group.isSomeday)
        let ticks = toggleTicks({}, someday.projects[0].rows, true) // opt into Someday for Product only
        ticks = toggleTicks(ticks, [view.groups[0].projects[1].rows[0]], false) // untick one client task
        view = buildPostponeView(summary, projectIds, ticks)
        view.perProject.forEach(project =>
            expect(project.planned + project.postponed + project.stays).toBe(project.all)
        )
        expect(view.totals.planned + view.totals.postponed + view.totals.stays).toBe(view.totals.all)
        expect(view.perProject.find(project => project.projectId === 'product')).toMatchObject({
            planned: 1,
            postponed: 3,
            stays: 0,
        })

        // Opting back out removes the explicit tick again.
        expect(toggleTicks(ticks, someday.projects[0].rows, false)).not.toHaveProperty('product:t6')
    })

    it('builds the apply payload: plan with priorities, postpone with Someday confirmation, keep the rest', () => {
        const { summary, projectIds } = plan(openTasksMap, capacity, {
            tierOverrides: { 'product:t0': TIER_MUST, 'client:c0': TIER_COULD },
        })
        const someday = buildPostponeView(summary, projectIds).groups.find(group => group.isSomeday)
        const ticks = toggleTicks({}, someday.projects[1].rows, true)
        const tasks = buildApplyTasks(summary, buildPostponeView(summary, projectIds, ticks))
        const byKey = Object.fromEntries(tasks.map(item => [`${item.projectId}:${item.taskId}`, item]))
        // Anna had no room for t0; the user made it a Must. Both go to the server for the dataset.
        expect(byKey['product:t0']).toEqual({
            projectId: 'product',
            taskId: 't0',
            isObservedTask: false,
            proposedTier: TIER_LATER,
            proposedRule: RULE_NO_ROOM,
            decision: 'plan',
            priority: 'must_do',
            estimateMinutes: 30,
        })
        expect(byKey['client:c0'].priority).toBe('could_do')
        expect(byKey['client:c6']).toMatchObject({ decision: 'postpone', confirmSomeday: true })
        expect(byKey['product:t1']).toMatchObject({ decision: 'postpone', confirmSomeday: false })
        expect(byKey['product:t6'].decision).toBe('keep')
        expect(byKey['product:prot']).toMatchObject({ decision: 'postpone', confirmSomeday: false })
        expect(byKey['private:obs']).toMatchObject({ decision: 'postpone', isObservedTask: true })
        expect(tasks).toHaveLength(summary.allCount)
    })
})

describe('project-list order is a real priority', () => {
    const budget60 = computePlanCapacity(readyView(540 - 75)) // free 75, budget 60

    it('a higher project outranks a lower one, even against a Should or Could set there', () => {
        const { proposal } = plan(
            {
                product: { p1: task('p1'), p2: task('p2') },
                client: { cs: task('cs', { priority: 'should_do' }) },
                private: { pc: task('pc', { priority: 'could_do' }) },
            },
            budget60
        )
        expect(proposal['product:p1'].tier).toBe(TIER_SHOULD)
        expect(proposal['product:p2'].tier).toBe(TIER_SHOULD)
        expect(proposal['client:cs']).toEqual({ tier: TIER_LATER, rule: RULE_NO_ROOM })
        expect(proposal['private:pc']).toEqual({ tier: TIER_LATER, rule: RULE_NO_ROOM })
    })

    it('lower projects fill what is left, in order, while it fits', () => {
        const { proposal, summary } = plan(
            {
                product: {
                    big: task('big', { estimations: { [-1]: 45 } }),
                    huge: task('huge', { estimations: { [-1]: 60 } }),
                },
                client: { small: task('small', { estimations: { [-1]: 15 } }) },
            },
            budget60
        )
        expect(proposal['product:big'].tier).toBe(TIER_SHOULD)
        expect(proposal['product:huge'].rule).toBe(RULE_NO_ROOM)
        expect(proposal['client:small']).toEqual({ tier: TIER_SHOULD, rule: RULE_RANKED })
        expect(summary.selectedMinutes).toBe(60)
    })
})

describe('postponing never promotes or protects', () => {
    const budget30 = computePlanCapacity(readyView(540 - 38)) // free 38, budget 30

    it('at otherwise equal rank the less postponed task comes first', () => {
        const { proposal } = plan(
            {
                product: {
                    often: task('often', { timesPostponed: 5 }), // created first: higher list position
                    fresh: task('fresh', { timesPostponed: 0 }),
                },
            },
            budget30
        )
        expect(proposal['product:fresh'].tier).toBe(TIER_SHOULD)
        expect(proposal['product:often']).toEqual({ tier: TIER_LATER, rule: RULE_NO_ROOM })
    })

    it('goal work postponed 3× or more gets no bonus (the old protected rule is gone)', () => {
        const { proposal } = plan(
            { product: { goalOld: task('goalOld', { parentGoalId: 'g', timesPostponed: 3 }), plain: task('plain') } },
            budget30
        )
        expect(proposal['product:plain'].tier).toBe(TIER_SHOULD)
        expect(proposal['product:goalOld'].tier).toBe(TIER_LATER)
    })

    it('being overdue longer is not a reason to rank higher (no aging): the list order decides', () => {
        const { proposal } = plan(
            {
                product: {
                    recent: task('recent', { dueDate: NOW - DAY }), // created first: higher list position
                    ancient: task('ancient', { dueDate: NOW - 60 * DAY }),
                },
            },
            budget30
        )
        expect(proposal['product:recent'].tier).toBe(TIER_SHOULD)
        expect(proposal['product:ancient'].tier).toBe(TIER_LATER)
    })

    it('project order still wins over the postpone count, which is only a tie-breaker', () => {
        const { proposal } = plan(
            { product: { p: task('p', { timesPostponed: 5 }) }, client: { c: task('c') } },
            budget30
        )
        expect(proposal['product:p'].tier).toBe(TIER_SHOULD)
        expect(proposal['client:c'].tier).toBe(TIER_LATER)
    })

    it('a frequently postponed goal task is ticked for postponing like any other; only Someday is opt-in', () => {
        const row = destinationKey => ({
            key: 'k',
            rule: RULE_NO_ROOM,
            candidate: { destinationKey, timesPostponed: 5, goalLinked: true },
        })
        expect(isDefaultTicked(row('1y'))).toBe(true)
        expect(isDefaultTicked(row(DESTINATION_SOMEDAY))).toBe(false)
    })
})

describe('milestones from the real goal data', () => {
    const WED = dayAt(10, 25)
    const resolve = (goalsById, { goalId = 'g', openMilestones } = {}) =>
        resolveTaskMilestone({ goalId, goalsById, openMilestones, nowMs: NOW })

    it('uses the goal’s completion milestone: dated (fixed) or period (dynamic), with workdays left', () => {
        expect(MILESTONE_AT_RISK_WORKDAYS).toBe(3)
        expect(MILESTONE_OVERDUE_GRACE_DAYS).toBe(14)
        expect(resolve({ g: goal('g', WED) })).toEqual({
            status: MILESTONE_UPCOMING,
            kind: MILESTONE_KIND_DATED,
            date: WED,
            overdueDays: 0,
            workdaysLeft: 3, // Mon (today), Tue, Wed
        })
        // "1 Nov – 30 Nov" monthly milestone: Mon 23 … Mon 30 = 6 workdays (the weekend does not count).
        expect(resolve({ g: goal('g', dayAt(10, 30), { scheduleMode: 'dynamic' }) })).toMatchObject({
            status: MILESTONE_UPCOMING,
            kind: MILESTONE_KIND_PERIOD,
            workdaysLeft: 6,
        })
    })

    it('missing or neutral data never invents a deadline', () => {
        expect(resolve({ g: goal('g', WED) }, { goalId: null })).toEqual({ status: MILESTONE_NONE })
        expect(resolve(undefined)).toEqual({ status: MILESTONE_UNKNOWN }) // goals of the project not loaded
        expect(resolve({ other: goal('other', WED) })).toEqual({ status: MILESTONE_UNKNOWN }) // goal not readable
        expect(resolve({ g: goal('g', Number.MAX_SAFE_INTEGER) })).toEqual({ status: MILESTONE_NONE }) // Backlog
        expect(resolve({ g: goal('g', WED, { progress: 100 }) })).toEqual({ status: MILESTONE_NONE })
        expect(resolve({ g: goal('g', WED, { dynamicProgress: 100 }) })).toEqual({ status: MILESTONE_NONE })
        // Open milestones loaded and none on that date: the milestone was closed.
        expect(resolve({ g: goal('g', WED) }, { openMilestones: [{ date: dayAt(10, 30) }] })).toEqual({
            status: MILESTONE_NONE,
        })
        expect(resolve({ g: goal('g', WED) }, { openMilestones: [{ date: WED }] }).status).toBe(MILESTONE_UPCOMING)
    })

    it('up to 14 days overdue counts as due today; older open milestones are stale and neutral', () => {
        expect(resolve({ g: goal('g', dayAt(10, 18)) })).toMatchObject({
            status: MILESTONE_OVERDUE,
            overdueDays: 5,
            workdaysLeft: 1,
        })
        expect(resolve({ g: goal('g', dayAt(10, 9)) }).status).toBe(MILESTONE_OVERDUE) // 14 days
        expect(resolve({ g: goal('g', dayAt(10, 8)) }).status).toBe(MILESTONE_STALE) // 15 days
    })

    it('counts workdays Mon–Fri, today always included', () => {
        expect(countWorkdaysLeft(dayAt(10, 23), NOW)).toBe(1)
        expect(countWorkdaysLeft(dayAt(10, 28), NOW)).toBe(5) // Saturday: through Friday
        expect(countWorkdaysLeft(dayAt(10, 30), new Date(2026, 10, 27, 9).getTime())).toBe(2) // Fri → Mon
    })

    it('only a dated milestone at most 3 workdays away (or overdue ≤ 14 days) is imminent', () => {
        const dated = { kind: MILESTONE_KIND_DATED, status: MILESTONE_UPCOMING }
        expect(isMilestoneImminent({ ...dated, workdaysLeft: 3 })).toBe(true)
        expect(isMilestoneImminent({ ...dated, workdaysLeft: 4 })).toBe(false)
        expect(isMilestoneImminent({ ...dated, status: MILESTONE_OVERDUE, workdaysLeft: 1 })).toBe(true)
        expect(isMilestoneImminent({ ...dated, status: MILESTONE_STALE })).toBe(false)
        expect(isMilestoneImminent({ kind: MILESTONE_KIND_PERIOD, status: MILESTONE_UPCOMING, workdaysLeft: 1 })).toBe(
            false
        )
        expect(isMilestoneImminent({ status: MILESTONE_UNKNOWN })).toBe(false)
    })

    it('inside a project: nearer milestone first, then more goal work per workday; Should still leads', () => {
        const dynamic = { scheduleMode: 'dynamic' }
        const { candidates } = build(
            {
                product: {
                    plain: task('plain'),
                    far: task('far', { parentGoalId: 'gFar' }),
                    near: task('near', { parentGoalId: 'gNear' }),
                    small: task('small', { parentGoalId: 'gSmall' }),
                    big1: task('big1', { parentGoalId: 'gBig' }),
                    big2: task('big2', { parentGoalId: 'gBig' }),
                    should: task('should', { priority: 'should_do' }),
                },
            },
            {
                goalsByProject: {
                    product: {
                        gFar: goal('gFar', dayAt(11, 31), dynamic),
                        gNear: goal('gNear', dayAt(10, 27), dynamic),
                        gSmall: goal('gSmall', dayAt(10, 30), dynamic),
                        gBig: goal('gBig', dayAt(10, 30), dynamic),
                    },
                },
            }
        )
        const order = [...candidates].sort(compareByFit).map(candidate => candidate.taskId)
        expect(order).toEqual(['should', 'near', 'big1', 'big2', 'small', 'far', 'plain'])
        expect(candidates.find(candidate => candidate.taskId === 'big1').goalEffortMinutes).toBe(60)
    })

    it('a remote dated milestone does not override the project order', () => {
        const { proposal } = plan(
            { product: { p1: task('p1'), p2: task('p2') }, client: { g1: task('g1', { parentGoalId: 'g' }) } },
            computePlanCapacity(readyView(540 - 75)),
            { extra: { goalsByProject: { client: { g: goal('g', dayAt(11, 31)) } } } }
        )
        expect(proposal['product:p1'].tier).toBe(TIER_SHOULD)
        expect(proposal['client:g1']).toEqual({ tier: TIER_LATER, rule: RULE_NO_ROOM })
    })
})

describe('imminent milestone may override the project order', () => {
    const budget60 = computePlanCapacity(readyView(540 - 75)) // budget 60
    // Product (top project) has 4 ordinary tasks; Private (bottom) has 3 tasks of goal g.
    const tasks = () => ({
        product: { p1: task('p1'), p2: task('p2'), p3: task('p3'), p4: task('p4') },
        private: {
            g1: task('g1', { parentGoalId: 'g' }),
            g2: task('g2', { parentGoalId: 'g' }),
            g3: task('g3', { parentGoalId: 'g' }),
        },
    })
    const withGoal = (completion, fields) => ({
        extra: { goalsByProject: { private: { g: goal('g', completion, fields) } } },
    })

    it('pulls in today’s share (goal work ÷ workdays left) ahead of the project order, with the numbers', () => {
        const { proposal, summary } = plan(tasks(), budget60, withGoal(dayAt(10, 25))) // Wed: 3 workdays
        const detail = { shareMinutes: 30, effortMinutes: 90, workdaysLeft: 3 }
        expect(proposal['private:g1']).toEqual({ tier: TIER_SHOULD, rule: RULE_MILESTONE_AT_RISK, detail })
        expect(proposal['product:p1'].tier).toBe(TIER_SHOULD)
        expect(proposal['product:p2'].tier).toBe(TIER_LATER)
        // The rest of the goal is beyond today's share: it competes normally and shows the risk.
        expect(proposal['private:g2']).toEqual({ tier: TIER_LATER, rule: RULE_NO_ROOM, detail })
        expect(summary.rows.find(row => row.key === 'private:g1').detail).toEqual(detail)
        expect(getMilestonesAtRisk(summary.rows.map(row => row.candidate))).toHaveLength(1)
    })

    it('otherwise the project order applies: 4 workdays away, a period milestone, stale or missing data', () => {
        const cases = [
            withGoal(dayAt(10, 26)), // Thu: 4 workdays
            withGoal(dayAt(10, 25), { scheduleMode: 'dynamic' }), // monthly period
            withGoal(dayAt(10, 1)), // 22 days overdue: stale
            { extra: { goalsByProject: {} } }, // goals of the project not loaded
        ]
        cases.forEach(options => {
            const { proposal } = plan(tasks(), budget60, options)
            expect(proposal['product:p1'].tier).toBe(TIER_SHOULD)
            expect(proposal['product:p2'].tier).toBe(TIER_SHOULD)
            expect(proposal['private:g1']).toEqual({ tier: TIER_LATER, rule: RULE_NO_ROOM })
        })
    })

    it('an overdue milestone (≤ 14 days) needs all of its due work today, as far as it fits', () => {
        const { proposal } = plan(tasks(), budget60, withGoal(dayAt(10, 20)))
        expect(proposal['private:g1'].rule).toBe(RULE_MILESTONE_AT_RISK)
        expect(proposal['private:g2'].rule).toBe(RULE_MILESTONE_AT_RISK)
        expect(proposal['private:g1'].detail).toEqual({ shareMinutes: 90, effortMinutes: 90, workdaysLeft: 1 })
        expect(proposal['private:g3'].tier).toBe(TIER_LATER)
        expect(proposal['product:p1'].tier).toBe(TIER_LATER)
    })

    it('the share follows the estimates, including the ones edited in the review', () => {
        const { candidates } = build(tasks(), withGoal(dayAt(10, 25)).extra)
        const estimateOverrides = { 'private:g1': 15, 'private:g2': 120, 'private:g3': 15 } // 150 → 50 today
        const proposal = proposePlan(candidates, 300, { estimateOverrides })
        expect(proposal['private:g1']).toMatchObject({ rule: RULE_MILESTONE_AT_RISK, detail: { shareMinutes: 50 } })
        expect(proposal['private:g2'].rule).toBe(RULE_MILESTONE_AT_RISK) // 15 + 120 ≥ 50
        expect(proposal['private:g3'].rule).toBe(RULE_GOAL) // planned later by the normal order
    })

    it('the nearer of two imminent milestones goes first', () => {
        const { proposal } = plan(
            { client: { c: task('c', { parentGoalId: 'gc' }) }, private: { v: task('v', { parentGoalId: 'gv' }) } },
            computePlanCapacity(readyView(540 - 38)), // budget 30
            {
                extra: {
                    goalsByProject: {
                        client: { gc: goal('gc', dayAt(10, 25)) },
                        private: { gv: goal('gv', dayAt(10, 24)) },
                    },
                },
            }
        )
        expect(proposal['private:v'].rule).toBe(RULE_MILESTONE_AT_RISK)
        expect(proposal['client:c']).toMatchObject({ tier: TIER_LATER, rule: RULE_NO_ROOM })
    })
})

describe('your Must tasks and the focus task stay foremost', () => {
    it('Must and focus come before milestones at risk and the project order', () => {
        const { proposal } = plan(
            {
                product: { p1: task('p1') },
                client: { focus: task('focus') },
                private: {
                    must: task('must', { priority: 'must_do', estimations: { [-1]: 60 } }),
                    g1: task('g1', { parentGoalId: 'g' }),
                },
            },
            computePlanCapacity(readyView(540 - 75)), // budget 60
            {
                extra: {
                    focusTaskId: 'focus',
                    focusProjectId: 'client',
                    goalsByProject: { private: { g: goal('g', dayAt(10, 24)) } },
                },
            }
        )
        expect(proposal['private:must']).toEqual({ tier: TIER_MUST, rule: RULE_YOUR_MUST })
        expect(proposal['client:focus']).toEqual({ tier: TIER_SHOULD, rule: RULE_FOCUS })
        expect(proposal['private:g1'].tier).toBe(TIER_LATER) // at risk, but today is full
        expect(proposal['product:p1'].tier).toBe(TIER_LATER)
    })

    it('a Must task of the goal counts towards today’s share', () => {
        const { proposal } = plan(
            {
                product: { p1: task('p1'), p2: task('p2'), p3: task('p3') },
                private: {
                    gm: task('gm', { priority: 'must_do', parentGoalId: 'g' }),
                    g1: task('g1', { parentGoalId: 'g' }),
                    g2: task('g2', { parentGoalId: 'g' }),
                },
            },
            computePlanCapacity(readyView(540 - 113)), // free 113, budget 90
            { extra: { goalsByProject: { private: { g: goal('g', dayAt(10, 25)) } } } } // share 30 = gm
        )
        expect(proposal['private:gm'].rule).toBe(RULE_YOUR_MUST)
        expect(proposal['private:g1'].tier).toBe(TIER_LATER)
        expect(proposal['product:p1'].tier).toBe(TIER_SHOULD)
        expect(proposal['product:p2'].tier).toBe(TIER_SHOULD)
    })
})

describe('arithmetic stays consistent with the new ranking', () => {
    it('totals, project subtotals, reconciliation and overload suggestions add up; at-risk rows are suggested last', () => {
        const capacity = computePlanCapacity(readyView(540 - 75)) // budget 60
        const openTasksMap = {
            product: { p1: task('p1'), p2: task('p2') },
            client: { c1: task('c1', { timesPostponed: 2 }) },
            private: { g1: task('g1', { parentGoalId: 'g' }), g2: task('g2', { parentGoalId: 'g' }) },
        }
        const extra = { goalsByProject: { private: { g: goal('g', dayAt(10, 24)) } } } // Tue: 2 workdays → 30
        const { summary, projectIds } = plan(openTasksMap, capacity, {
            tierOverrides: { 'product:p2': TIER_SHOULD },
            extra,
        })
        expect(summary.rows.find(row => row.key === 'private:g1').rule).toBe(RULE_MILESTONE_AT_RISK)
        expect(summary.selectedMinutes).toBe(90)
        expect(summary.selectedCount + summary.laterCount).toBe(summary.allCount)
        const grouped = groupPlanByProject(summary, projectIds)
        expect(grouped.totals).toMatchObject({
            selectedCount: summary.selectedCount,
            selectedMinutes: summary.selectedMinutes,
            laterCount: summary.laterCount,
            allCount: summary.allCount,
        })
        const view = buildPostponeView(summary, projectIds)
        view.perProject.forEach(project =>
            expect(project.planned + project.postponed + project.stays).toBe(project.all)
        )
        expect(view.totals.planned + view.totals.postponed + view.totals.stays).toBe(view.totals.all)
        const { moves } = suggestOverloadMoves(summary)
        expect(moves.map(row => row.key)).toEqual(['product:p2'])
        expect(buildApplyTasks(summary, view)).toHaveLength(summary.allCount)
    })
})

it('formats durations', () => {
    expect(formatPlanDuration(450)).toBe('7h 30m')
    expect(formatPlanDuration(120)).toBe('2h')
    expect(formatPlanDuration(45)).toBe('45m')
    expect(formatPlanDuration(0)).toBe('0m')
    expect(formatPlanDuration(-150)).toBe('−2h 30m')
})
