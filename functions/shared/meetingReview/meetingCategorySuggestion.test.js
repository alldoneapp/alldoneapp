'use strict'

const {
    normalizeMeetingTitlePattern,
    getHeuristicCategorySuggestion,
    resolveMeetingCategory,
    getDefaultSeriesScope,
    buildMeetingReviewUpdate,
    buildCategoryRuleUpdate,
    toAiConfidenceLevel,
} = require('./meetingCategorySuggestion')
const {
    getCalendarEventBounds,
    getCalendarEventExclusionReason,
    dedupeCalendarTasks,
} = require('./calendarEventCounting')
const {
    MEETING_CATEGORIES,
    isMeetingCategory,
    normalizeMeetingCategory,
    toMeetingDocId,
} = require('./meetingReviewConstants')

const task = (name, calendarData = {}, extra = {}) => ({
    id: 'evt1',
    projectId: 'p1',
    name,
    description: '',
    calendarData: {
        start: { dateTime: '2026-11-24T09:30:00+01:00' },
        end: { dateTime: '2026-11-24T10:30:00+01:00' },
        ...calendarData,
    },
    ...extra,
})

const NOW = 1795500000000

describe('heuristic category suggestion', () => {
    it('treats "no other participants" as own time with high confidence', () => {
        const result = getHeuristicCategorySuggestion(task('Konzept schreiben', { attendeeCount: 0 }))
        expect(result).toMatchObject({ category: 'own_time', confidence: 'high' })
        expect(result.signals[0].key).toBe('Meeting signal no attendees')
    })

    it('proposes status for a recurring "Weekly" with medium confidence and real signals only', () => {
        const result = getHeuristicCategorySuggestion(
            task('Weekly Sync Produkt', { recurringEventId: 's1', attendeeCount: 8 })
        )
        expect(result.category).toBe('status')
        expect(result.confidence).toBe('medium')
        expect(result.signals.map(item => item.key)).toEqual([
            'Meeting signal title word',
            'Meeting signal recurring',
            'Meeting signal attendees',
        ])
    })

    it('preselects nothing on thin data (title keyword but unknown participants)', () => {
        const result = getHeuristicCategorySuggestion(task('Workshop'))
        expect(result.category).toBeNull()
        expect(result.confidence).toBe('low')
        expect(result.candidates).toEqual(['work'])
    })

    it('highlights two candidates and preselects nothing when signals conflict', () => {
        const result = getHeuristicCategorySuggestion(
            task('Abstimmung Q1 Planning', { attendeeCount: 4, externalAttendeeCount: 2 })
        )
        expect(result.category).toBeNull()
        expect(result.confidence).toBe('low')
        // "Abstimmung" belongs to "Status & Stakeholder" since AT-3147; it ranks before work.
        expect(result.candidates).toEqual(['status', 'work'])
    })

    it('ignores an own-time keyword when other people attend', () => {
        const result = getHeuristicCategorySuggestion(task('Lunch', { attendeeCount: 3 }))
        expect(result.category).toBeNull()
    })

    it('never contains a usefulness judgement', () => {
        const result = resolveMeetingCategory({
            task: task('Daily Standup', { recurringEventId: 's', attendeeCount: 5 }),
        })
        expect(JSON.stringify(result)).not.toMatch(/worthwhile|not_helpful|partly|usefulness/)
    })
})

describe('resolveMeetingCategory priority', () => {
    const weekly = task('Weekly Sync', { recurringEventId: 'series-1', attendeeCount: 8 })

    it('1. the user confirmed category wins and is the only confirmed state', () => {
        const result = resolveMeetingCategory({
            task: weekly,
            review: { category: 'work', categorySource: 'user' },
            seriesCategory: 'status',
        })
        expect(result).toMatchObject({ category: 'work', confirmed: true, source: 'user' })
    })

    it('2. a series default is a high-confidence suggestion, not yet confirmed', () => {
        const result = resolveMeetingCategory({ task: weekly, seriesCategory: 'network' })
        expect(result).toMatchObject({
            category: 'network',
            confirmed: false,
            source: 'series',
            confidence: 'high',
        })
        expect(result.preselected).toBe(true)
    })

    it('3. a learned rule beats AI and keywords', () => {
        const result = resolveMeetingCategory({
            task: task('Jour fixe 24.11.', { attendeeCount: 3 }),
            rules: [{ pattern: 'jour fixe', category: 'work', corrections: 3 }],
            review: { aiSuggestion: { category: 'status', confidence: 'medium' } },
        })
        expect(result).toMatchObject({ category: 'work', source: 'rule', confidence: 'high' })
    })

    it('5. uses the AI suggestion from the routing run with its signals', () => {
        const result = resolveMeetingCategory({
            task: task('Q1 Abstimmung', { attendeeCount: 4 }),
            review: {
                aiSuggestion: { category: 'status', confidence: 'medium', signals: ['2 external domains'] },
            },
        })
        expect(result).toMatchObject({ category: 'status', source: 'ai', confidence: 'medium', preselected: true })
        expect(result.signals[0]).toEqual({ key: 'Meeting signal ai text', params: { text: '2 external domains' } })
    })

    it('a low-confidence AI suggestion is highlighted but not preselected', () => {
        const result = resolveMeetingCategory({
            task: task('Call', { attendeeCount: 1 }),
            review: { aiSuggestion: { category: 'network', confidence: 'low' } },
        })
        expect(result.preselected).toBe(false)
        expect(result.category).toBeNull()
        expect(result.candidates[0]).toBe('network')
    })

    it('maps the classifier score to medium/low, never high', () => {
        expect(toAiConfidenceLevel(0.99)).toBe('medium')
        expect(toAiConfidenceLevel(0.4)).toBe('low')
        expect(toAiConfidenceLevel(undefined)).toBe('low')
    })
})

describe('AT-3147: five categories, "Status & Stakeholder" and "Learning & knowledge sharing"', () => {
    const insight = (calendarData = {}) => task('AI Insight Session #8: AI Pricing', calendarData)

    it('offers exactly five categories and maps the retired "stakeholder" key to "status"', () => {
        expect(MEETING_CATEGORIES).toEqual(['work', 'status', 'learning', 'network', 'own_time'])
        expect(normalizeMeetingCategory('stakeholder')).toBe('status')
        expect(normalizeMeetingCategory('status')).toBe('status')
        expect(normalizeMeetingCategory('learning')).toBe('learning')
        expect(normalizeMeetingCategory('nonsense')).toBeNull()
        expect(normalizeMeetingCategory(undefined)).toBeNull()
        // retired keys are read, never offered or written
        expect(isMeetingCategory('stakeholder')).toBe(false)
        expect(() =>
            buildMeetingReviewUpdate({
                task: task('x'),
                resolved: null,
                action: { type: 'category', category: 'stakeholder' },
                nowMs: NOW,
            })
        ).toThrow('Invalid meeting category')
    })

    it('proposes learning for "AI Insight Session #8: AI Pricing" with participants (not "session" = work)', () => {
        const result = getHeuristicCategorySuggestion(insight({ attendeeCount: 25 }))
        expect(result).toMatchObject({ category: 'learning', confidence: 'medium', candidates: ['learning'] })
        expect(result.signals[0]).toEqual({ key: 'Meeting signal title word', params: { word: 'insight session' } })
    })

    it('a clear learning title overrides "no participants → own time" and ranks above the AI suggestion', () => {
        const heuristic = getHeuristicCategorySuggestion(insight({ attendeeCount: 0 }))
        expect(heuristic).toMatchObject({ category: 'learning', confidence: 'medium' })
        expect(heuristic.candidates).toEqual(['learning', 'own_time'])

        // the screenshot case: the private copy of the event was suggested as own time before
        const result = resolveMeetingCategory({
            task: insight({ attendeeCount: 0 }),
            review: { aiSuggestion: { category: 'own_time', confidence: 'medium', signals: ['keine Teilnehmenden'] } },
        })
        expect(result).toMatchObject({
            category: 'learning',
            source: 'heuristic',
            confidence: 'medium',
            preselected: true,
            confirmed: false,
        })
    })

    it('keeps own time for a solo block without a learning title, and for "Lunch" alone', () => {
        expect(getHeuristicCategorySuggestion(task('Konzept schreiben', { attendeeCount: 0 }))).toMatchObject({
            category: 'own_time',
            confidence: 'high',
        })
        expect(getHeuristicCategorySuggestion(task('Lunch', { attendeeCount: 0 }))).toMatchObject({
            category: 'own_time',
        })
        expect(getHeuristicCategorySuggestion(task('Lunch & Learn: Prompting', { attendeeCount: 0 }))).toMatchObject({
            category: 'learning',
        })
    })

    it('proposes learning for webinars and trainings even without a participant list', () => {
        expect(getHeuristicCategorySuggestion(task('Webinar: EU AI Act'))).toMatchObject({
            category: 'learning',
            confidence: 'medium',
        })
        expect(getHeuristicCategorySuggestion(task('Schulung Datenschutz', { attendeeCount: 6 }))).toMatchObject({
            category: 'learning',
        })
    })

    it('moves sales to "Network & sales" and keeps intros there', () => {
        expect(getHeuristicCategorySuggestion(task('Sales Call ACME', { attendeeCount: 2 }))).toMatchObject({
            category: 'network',
        })
        expect(getHeuristicCategorySuggestion(task('Intro Julius', { attendeeCount: 1 }))).toMatchObject({
            category: 'network',
        })
    })

    it('suggests "Status & Stakeholder" for former stakeholder meetings (steering, board, investor)', () => {
        expect(getHeuristicCategorySuggestion(task('SteerCo Juno', { attendeeCount: 6 }))).toMatchObject({
            category: 'status',
        })
        expect(getHeuristicCategorySuggestion(task('Investor Update', { attendeeCount: 3 }))).toMatchObject({
            category: 'status',
        })
        expect(
            getHeuristicCategorySuggestion(task('Termin', { attendeeCount: 3, externalAttendeeCount: 2 }))
        ).toMatchObject({ category: null, candidates: ['status'] })
    })

    it('the user, a series default and a learned rule still beat the learning override', () => {
        expect(
            resolveMeetingCategory({
                task: insight({ attendeeCount: 0 }),
                review: { category: 'own_time', categorySource: 'user' },
            })
        ).toMatchObject({ category: 'own_time', confirmed: true })
        expect(
            resolveMeetingCategory({
                task: insight({ attendeeCount: 0 }),
                rules: [{ pattern: 'ai insight session ai pricing', category: 'work', corrections: 1 }],
            })
        ).toMatchObject({ category: 'work', source: 'rule' })
    })

    describe('historic data saved as "stakeholder"', () => {
        const weekly = task('Weekly Sync', { recurringEventId: 'series-1', attendeeCount: 8 })

        it('a confirmed rating stays confirmed, now as "Status & Stakeholder"', () => {
            expect(
                resolveMeetingCategory({
                    task: weekly,
                    review: { category: 'stakeholder', categorySource: 'user', usefulness: 'worthwhile' },
                })
            ).toMatchObject({ category: 'status', confirmed: true, source: 'user', candidates: ['status'] })
        })

        it('a series default, a learned rule and an AI suggestion are read as "status"', () => {
            expect(resolveMeetingCategory({ task: weekly, seriesCategory: 'stakeholder' })).toMatchObject({
                category: 'status',
                source: 'series',
                preselected: true,
            })
            expect(getDefaultSeriesScope({ recurringEventId: 's', seriesCategory: 'stakeholder' })).toBe('instance')
            expect(
                resolveMeetingCategory({
                    task: task('Steuerkreis Juno', { attendeeCount: 5 }),
                    rules: [{ pattern: 'steuerkreis juno', category: 'stakeholder', corrections: 2 }],
                })
            ).toMatchObject({ category: 'status', source: 'rule', confidence: 'high' })
            expect(
                resolveMeetingCategory({
                    task: task('Q1 Gespräch', { attendeeCount: 4 }),
                    review: { aiSuggestion: { category: 'stakeholder', confidence: 'medium' } },
                })
            ).toMatchObject({ category: 'status', source: 'ai', preselected: true })
        })

        it('a correction to "status" continues a learned "stakeholder" rule instead of restarting it', () => {
            const update = buildCategoryRuleUpdate({
                task: task('Steuerkreis Juno'),
                resolved: { category: 'work', preselected: true, confirmed: false },
                chosenCategory: 'status',
                scope: null,
                existingRule: { pattern: 'steuerkreis juno', category: 'stakeholder', corrections: 2 },
                nowMs: NOW,
            })
            expect(update).toMatchObject({ pattern: 'steuerkreis juno', category: 'status', corrections: 3 })
        })
    })
})

describe('series scope', () => {
    it('defaults to the series without a default, otherwise to the single occurrence', () => {
        expect(getDefaultSeriesScope({ recurringEventId: '' })).toBeNull()
        expect(getDefaultSeriesScope({ recurringEventId: 's' })).toBe('series')
        expect(getDefaultSeriesScope({ recurringEventId: 's', seriesCategory: 'status' })).toBe('instance')
    })
})

describe('buildMeetingReviewUpdate', () => {
    const weekly = task('Weekly', { recurringEventId: 's1', startMs: 1000, endMs: 2000 })
    const preselected = { category: 'status', preselected: true, confirmed: false, source: 'series' }

    it('a usefulness tap confirms the preselected category (1 tap)', () => {
        const update = buildMeetingReviewUpdate({
            task: weekly,
            resolved: preselected,
            action: { type: 'rate', usefulness: 'not_helpful' },
            nowMs: NOW,
        })
        expect(update).toMatchObject({
            usefulness: 'not_helpful',
            reviewStatus: 'rated',
            category: 'status',
            categorySource: 'user',
            categoryConfirmedFrom: 'series',
            recurringEventId: 's1',
            startMs: 1000,
            endMs: 2000,
        })
    })

    it('with nothing preselected, a usefulness tap leaves the category open', () => {
        const update = buildMeetingReviewUpdate({
            task: weekly,
            resolved: { category: null, preselected: false, confirmed: false, candidates: ['work', 'status'] },
            action: { type: 'rate', usefulness: 'worthwhile' },
            nowMs: NOW,
        })
        expect(update.usefulness).toBe('worthwhile')
        expect(update).not.toHaveProperty('category')
    })

    it('skip never overwrites an existing rating', () => {
        expect(
            buildMeetingReviewUpdate({ task: weekly, resolved: preselected, action: { type: 'skip' }, nowMs: NOW })
                .reviewStatus
        ).toBe('skipped')
        expect(
            buildMeetingReviewUpdate({
                task: weekly,
                resolved: preselected,
                action: { type: 'skip' },
                existing: { reviewStatus: 'rated' },
                nowMs: NOW,
            })
        ).not.toHaveProperty('reviewStatus')
    })

    it('not attended removes the usefulness question; clear makes it unrated again', () => {
        const notAttended = buildMeetingReviewUpdate({
            task: weekly,
            resolved: preselected,
            action: { type: 'not_attended' },
            nowMs: NOW,
        })
        expect(notAttended).toMatchObject({ attendance: 'not_attended', usefulness: null, reviewStatus: null })
        const cleared = buildMeetingReviewUpdate({ task: weekly, resolved: preselected, action: { type: 'clear' } })
        expect(cleared).toMatchObject({ usefulness: null, reviewStatus: null })
    })

    it('a duration equal to the plan is stored as "as planned"', () => {
        const same = buildMeetingReviewUpdate({
            task: weekly,
            resolved: preselected,
            action: { type: 'duration', actualStartMs: 1000, actualEndMs: 2000 },
        })
        expect(same).toMatchObject({ actualStartMs: null, actualEndMs: null })
        const shorter = buildMeetingReviewUpdate({
            task: weekly,
            resolved: preselected,
            action: { type: 'duration', actualStartMs: 1000, actualEndMs: 1500 },
        })
        expect(shorter).toMatchObject({ actualStartMs: 1000, actualEndMs: 1500 })
    })

    it('rejects values outside the fixed scales', () => {
        expect(() =>
            buildMeetingReviewUpdate({
                task: weekly,
                resolved: preselected,
                action: { type: 'rate', usefulness: 'meh' },
            })
        ).toThrow()
        expect(() =>
            buildMeetingReviewUpdate({
                task: weekly,
                resolved: preselected,
                action: { type: 'category', category: 'x' },
            })
        ).toThrow()
    })
})

describe('learned rules', () => {
    it('normalizes titles so occurrences share a pattern', () => {
        expect(normalizeMeetingTitlePattern('Jour fixe 24.11. – Team')).toBe('jour fixe team')
    })

    it('learns from a correction of a single occurrence and counts repeated corrections', () => {
        const resolved = { category: 'status', preselected: true }
        const first = buildCategoryRuleUpdate({
            task: task('Jour fixe 1'),
            resolved,
            chosenCategory: 'work',
            scope: 'instance',
            nowMs: NOW,
        })
        expect(first).toEqual({ pattern: 'jour fixe', category: 'work', corrections: 1, updatedAt: NOW })
        const second = buildCategoryRuleUpdate({
            task: task('Jour fixe 2'),
            resolved,
            chosenCategory: 'work',
            scope: 'instance',
            existingRule: first,
            nowMs: NOW,
        })
        expect(second.corrections).toBe(2)
    })

    it('learns nothing when the proposal was confirmed, for series changes or unusable titles', () => {
        const resolved = { category: 'status', preselected: true }
        expect(buildCategoryRuleUpdate({ task: task('Weekly'), resolved, chosenCategory: 'status' })).toBeNull()
        expect(
            buildCategoryRuleUpdate({ task: task('Weekly'), resolved, chosenCategory: 'work', scope: 'series' })
        ).toBeNull()
        expect(buildCategoryRuleUpdate({ task: task('42'), resolved, chosenCategory: 'work' })).toBeNull()
    })
})

describe('counting rules shared with AT-3136', () => {
    it('reads numeric bounds first and falls back to provider ISO strings', () => {
        expect(getCalendarEventBounds({ startMs: 1, endMs: 2, start: { dateTime: 'x' } })).toEqual({
            startMs: 1,
            endMs: 2,
            isAllDay: false,
        })
        expect(
            getCalendarEventBounds({
                start: { dateTime: '2026-11-24T09:00:00+01:00' },
                end: { dateTime: '2026-11-24T10:00:00+01:00' },
            })
        ).toEqual({ startMs: Date.UTC(2026, 10, 24, 8), endMs: Date.UTC(2026, 10, 24, 9), isAllDay: false })
    })

    it('reads offset-less Microsoft UTC values as UTC', () => {
        expect(
            getCalendarEventBounds({
                start: { dateTime: '2026-11-24T08:00:00.0000000', timeZone: 'UTC' },
                end: { dateTime: '2026-11-24T09:00:00.0000000', timeZone: 'UTC' },
            })
        ).toEqual({ startMs: Date.UTC(2026, 10, 24, 8), endMs: Date.UTC(2026, 10, 24, 9), isAllDay: false })
    })

    it('excludes all-day, cancelled and declined events', () => {
        expect(
            getCalendarEventExclusionReason({
                calendarData: { start: { date: '2026-11-24' }, end: { date: '2026-11-25' } },
            })
        ).toBe('all_day')
        expect(getCalendarEventExclusionReason(task('x', { status: 'cancelled' }))).toBe('cancelled')
        expect(getCalendarEventExclusionReason(task('x', { selfResponseStatus: 'declined' }))).toBe('declined')
        expect(getCalendarEventExclusionReason(task('x', { selfResponseStatus: 'tentative' }))).toBeNull()
        expect(getCalendarEventExclusionReason({ calendarData: null })).toBe('invalid')
    })

    it('counts one appointment once: same id, or same title and time from two calendars', () => {
        const a = task('Weekly', { startMs: 1, endMs: 2 }, { id: 'a' })
        const aAgain = { ...a }
        const fromOtherCalendar = task(' weekly ', { startMs: 1, endMs: 2 }, { id: 'b' })
        const different = task('Weekly', { startMs: 3, endMs: 4 }, { id: 'c' })
        expect(dedupeCalendarTasks([a, aAgain, fromOtherCalendar, different]).map(item => item.id)).toEqual(['a', 'c'])
    })

    it('encodes ids that are not valid Firestore document ids', () => {
        expect(toMeetingDocId('abc_123')).toBe('abc_123')
        expect(toMeetingDocId('AAMk/xy+z=')).toBe('AAMk%2Fxy+z=')
        expect(toMeetingDocId('..')).toBe('')
    })
})
