import {
    ASSUMED_MEETING_OPTIONS,
    DESTINATION_SOMEDAY,
    PLAN_FILL_SHARE,
    RULE_DO_LATER,
    RULE_FOCUS,
    RULE_NO_ROOM,
    RULE_YOU,
    RULE_YOUR_MUST,
    TIER_COULD,
    TIER_LATER,
    TIER_MUST,
    TIER_SHOULD,
    UNKNOWN_ESTIMATE_MINUTES,
    buildApplyTasks,
    buildPlanCandidates,
    buildPostponeView,
    computePlanCapacity,
    formatPlanDuration,
    getDestinationDate,
    getDestinationKey,
    groupPlanByProject,
    proposePlan,
    suggestOverloadMoves,
    summarizePlan,
    toggleTicks,
} from './dailyPlanModel'

const NOW = new Date(2026, 10, 23, 9, 0).getTime()
const END_OF_DAY = new Date(2026, 10, 23, 23, 59, 59, 999).getTime()
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
        ...extra,
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

    it('flags unknown estimates (counted as 30m) and protected goal work', () => {
        const { candidates } = build({
            product: {
                unknown: task('unknown', { estimations: {} }),
                zero: task('zero', { estimations: { [-1]: 0 } }),
                old: task('old', { parentGoalId: 'g1', timesPostponed: 3 }),
                young: task('young', { parentGoalId: 'g1', timesPostponed: 2 }),
            },
        })
        const byId = Object.fromEntries(candidates.map(candidate => [candidate.taskId, candidate]))
        expect(byId.unknown).toMatchObject({ estimateKnown: false, storedEstimate: 0 })
        expect(byId.zero.estimateKnown).toBe(false)
        expect(byId.old.protected).toBe(true)
        expect(byId.young.protected).toBe(false)
        expect(UNKNOWN_ESTIMATE_MINUTES).toBe(30)
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

    it('ranks set priorities, then protected goal work, goal work, most postponed, oldest', () => {
        const capacity = computePlanCapacity(readyView(540 - 75)) // free 75, budget 60
        const { proposal } = plan(
            {
                product: {
                    a: task('a', { dueDate: NOW - 9 * DAY }),
                    b: task('b', { parentGoalId: 'g', timesPostponed: 4 }),
                    c: task('c', { priority: 'could_do' }),
                    d: task('d', { parentGoalId: 'g' }),
                },
            },
            capacity
        )
        expect(proposal['product:c'].tier).toBe(TIER_COULD)
        expect(proposal['product:b'].tier).toBe(TIER_SHOULD)
        expect(proposal['product:d'].tier).toBe(TIER_LATER)
        expect(proposal['product:a'].tier).toBe(TIER_LATER)
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

    it('groups destination first, project second; Someday and protected tasks are opt-in', () => {
        const { summary, projectIds } = plan(openTasksMap, capacity)
        const view = buildPostponeView(summary, projectIds)
        expect(view.groups.map(group => group.key)).toEqual(['3d', '1w', '6m', 'someday'])
        expect(view.groups[0].projects.map(project => project.projectId)).toEqual(['product', 'client', 'private'])
        const someday = view.groups.find(group => group.isSomeday)
        expect(someday.projects.map(project => project.projectId)).toEqual(['product', 'client'])
        expect(someday.tickedCount).toBe(0)
        expect(view.groups.find(group => group.key === '6m').tickedCount).toBe(0) // protected goal task
        expect(view.totals).toEqual({ planned: 0, postponed: 4, stays: 3, all: 7 })
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
            postponed: 2,
            stays: 1,
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
        expect(byKey['product:t0']).toEqual({
            projectId: 'product',
            taskId: 't0',
            isObservedTask: false,
            decision: 'plan',
            priority: 'must_do',
            estimateMinutes: 30,
        })
        expect(byKey['client:c0'].priority).toBe('could_do')
        expect(byKey['client:c6']).toMatchObject({ decision: 'postpone', confirmSomeday: true })
        expect(byKey['product:t1']).toMatchObject({ decision: 'postpone', confirmSomeday: false })
        expect(byKey['product:t6'].decision).toBe('keep')
        expect(byKey['product:prot'].decision).toBe('keep')
        expect(byKey['private:obs']).toMatchObject({ decision: 'postpone', isObservedTask: true })
        expect(tasks).toHaveLength(summary.allCount)
    })
})

it('formats durations', () => {
    expect(formatPlanDuration(450)).toBe('7h 30m')
    expect(formatPlanDuration(120)).toBe('2h')
    expect(formatPlanDuration(45)).toBe('45m')
    expect(formatPlanDuration(0)).toBe('0m')
    expect(formatPlanDuration(-150)).toBe('−2h 30m')
})
