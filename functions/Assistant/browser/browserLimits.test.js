'use strict'

const {
    DEFAULT_BROWSER_LIMITS,
    MAX_BROWSER_LIMITS,
    applyWorkerUsage,
    chargeBrowserBudget,
    createRunBudget,
    normalizeBudget,
    resolveBrowserLimits,
} = require('./browserLimits')

describe('browser limits', () => {
    describe('resolveBrowserLimits', () => {
        it('clamps a configured override to the hard ceiling', () => {
            const limits = resolveBrowserLimits({ maxNavigations: 10000, maxRunWallClockMs: 60 * 60 * 1000 })
            expect(limits.maxNavigations).toBe(MAX_BROWSER_LIMITS.maxNavigations)
            expect(limits.maxRunWallClockMs).toBe(MAX_BROWSER_LIMITS.maxRunWallClockMs)
        })

        it('falls back to the DEFAULT — never to the ceiling — for an unusable override', () => {
            // The failure direction of a typo has to be "less browsing".
            for (const bad of [undefined, null, 0, -5, 'lots', NaN]) {
                expect(resolveBrowserLimits({ maxSteps: bad }).maxSteps).toBe(DEFAULT_BROWSER_LIMITS.maxSteps)
            }
        })

        it('lets a project narrow a limit', () => {
            expect(resolveBrowserLimits({ maxNavigations: 2 }).maxNavigations).toBe(2)
        })
    })

    describe('chargeBrowserBudget', () => {
        const limits = resolveBrowserLimits({ maxSteps: 3, maxNavigations: 2, maxRunWallClockMs: 10000 })

        it('does not mutate the budget it is given', () => {
            const budget = createRunBudget(1000)
            const charged = chargeBrowserBudget(budget, limits, { steps: 1 }, 1000)
            expect(budget.steps).toBe(0)
            expect(charged.budget.steps).toBe(1)
        })

        it('refuses the step that would exceed a counter, and consumes nothing', () => {
            let budget = createRunBudget(0)
            budget = chargeBrowserBudget(budget, limits, { steps: 1, navigations: 1 }, 0).budget
            budget = chargeBrowserBudget(budget, limits, { steps: 1, navigations: 1 }, 0).budget
            const third = chargeBrowserBudget(budget, limits, { steps: 1, navigations: 1 }, 0)
            expect(third.ok).toBe(false)
            expect(third.violation.counter).toBe('navigations')
            expect(third.budget.navigations).toBe(2)
            expect(third.violation.message).toMatch(/2 page loads/)
        })

        it('checks the wall clock before any counter', () => {
            const budget = createRunBudget(0)
            const late = chargeBrowserBudget(budget, limits, { steps: 1 }, 10001)
            expect(late.ok).toBe(false)
            expect(late.violation.counter).toBe('wallClock')
        })

        it('treats a missing or corrupt persisted budget as empty rather than as unlimited', () => {
            expect(normalizeBudget(null, 5).steps).toBe(0)
            expect(normalizeBudget({ steps: 'many', navigations: -3 }, 5).steps).toBe(0)
            const charged = chargeBrowserBudget({ steps: 'many' }, limits, { steps: 1 }, 5)
            expect(charged.ok).toBe(true)
            expect(charged.budget.steps).toBe(1)
        })
    })

    describe('applyWorkerUsage', () => {
        it('records an overshoot instead of discarding it', () => {
            // The bytes are already downloaded. Refusing to record them would let the run repeat
            // the same expensive step forever.
            const limits = resolveBrowserLimits({ maxResponseBytes: 1000 })
            const budget = applyWorkerUsage(createRunBudget(0), { responseBytes: 5000, networkRequests: 12 }, 0)
            expect(budget.responseBytes).toBe(5000)
            expect(chargeBrowserBudget(budget, limits, { responseBytes: 1 }, 0).ok).toBe(false)
        })

        it('ignores nonsense reported by the worker', () => {
            const budget = applyWorkerUsage(createRunBudget(0), { responseBytes: -1, networkRequests: 'lots' }, 0)
            expect(budget.responseBytes).toBe(0)
            expect(budget.networkRequests).toBe(0)
        })
    })
})
