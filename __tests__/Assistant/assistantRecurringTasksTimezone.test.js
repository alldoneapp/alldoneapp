const moment = require('moment')

const { resolveTimezoneContext } = require('../../functions/Assistant/timezoneResolver')

function getNextExecutionTimeMock(originalScheduledTime, recurrence, lastExecuted) {
    const next = originalScheduledTime.clone()
    const lastExecutedMoment = moment(lastExecuted)

    if (next.isAfter(lastExecutedMoment)) {
        return next
    }

    const maxIterations = 10000
    let iterations = 0
    while (next.isSameOrBefore(lastExecutedMoment) && iterations < maxIterations) {
        iterations++
        switch (recurrence) {
            case 'daily':
                next.add(1, 'days')
                break
            case 'everyWorkday':
                do {
                    next.add(1, 'days')
                } while (next.isoWeekday() > 5)
                break
            case 'weekly':
                next.add(1, 'weeks')
                break
            case 'every2Weeks':
                next.add(2, 'weeks')
                break
            case 'every3Weeks':
                next.add(3, 'weeks')
                break
            case 'monthly':
                next.add(1, 'months')
                break
            case 'every3Months':
                next.add(3, 'months')
                break
            case 'every6Months':
                next.add(6, 'months')
                break
            case 'annually':
                next.add(1, 'years')
                break
            default:
                next.add(1, 'days')
                break
        }
    }

    return next
}

describe('resolveTimezoneContext DST handling', () => {
    it('keeps the stored offset even when it looks stale for the season', () => {
        const nowUtc = moment.utc('2025-06-15T09:30:00Z')
        const task = {
            id: 'task-dst-summer',
            startDate: Date.parse('2025-01-01T10:30:00Z'),
            startTime: '11:30',
            recurrence: 'daily',
            lastExecuted: {
                toDate: () => new Date('2025-06-14T09:30:00Z'),
            },
            userTimezone: 1, // Stored during winter (UTC+1)
        }
        const userData = { timezone: 1 }

        const context = resolveTimezoneContext(task, userData, { nowUtc }, getNextExecutionTimeMock)

        // The +1 stored in winter still wins in June: a DST-adjusted +2 exists
        // among the candidates but is only a fallback.
        expect(context.selectedEvaluation.offsetMinutes).toBe(60)
        expect(context.selectedEvaluation.heuristic).toBeFalsy()
        expect(context.candidates.some(candidate => candidate.offsetMinutes === 120)).toBe(true)
    })

    it('prefers the stored offset over a DST-adjusted guess after the transition', () => {
        const nowUtc = moment.utc('2025-12-01T10:30:00Z')
        const task = {
            id: 'task-dst-winter',
            startDate: Date.parse('2025-06-01T09:30:00Z'),
            startTime: '11:30',
            recurrence: 'daily',
            lastExecuted: {
                toDate: () => new Date('2025-11-30T10:30:00Z'),
            },
            userTimezone: 2, // Stored during summer (UTC+2)
        }
        const userData = { timezone: 2 }

        const context = resolveTimezoneContext(task, userData, { nowUtc }, getNextExecutionTimeMock)

        // selectBestEvaluation deliberately sets the DST-adjusted candidates
        // aside while a non-heuristic one is available, so that a task cannot be
        // run twice across a transition. The stored +2 therefore wins over the
        // +1 guess, and the heuristics only come into play when nothing else
        // resolves.
        expect(context.selectedEvaluation.offsetMinutes).toBe(120)
        expect(context.selectedEvaluation.heuristic).toBeFalsy()
        expect(context.candidates.some(candidate => candidate.offsetMinutes === 60)).toBe(true)
    })
})
