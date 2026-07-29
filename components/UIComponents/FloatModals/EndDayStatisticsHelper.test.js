import { getEndDayMoneyEarnedSummary } from './EndDayStatisticsHelper'

const USER_ID = 'user-1'

const createProject = (id, hourlyRate, currency = 'EUR') => ({
    id,
    hourlyRatesData: {
        currency,
        hourlyRates: hourlyRate == null ? {} : { [USER_ID]: hourlyRate },
    },
})

describe('getEndDayMoneyEarnedSummary', () => {
    it('hides the row when logged time has no monetary rate', () => {
        const projects = [createProject('without-rate', null), createProject('zero-rate', 0)]
        const statistics = {
            'without-rate': { doneTime: 480 },
            'zero-rate': { doneTime: 60 },
        }

        expect(getEndDayMoneyEarnedSummary(projects, statistics, USER_ID, 'EUR')).toBeNull()
    })

    it('aggregates monetized time and formats Money earned', () => {
        const projects = [createProject('project-1', 120), createProject('project-2', 90)]
        const statistics = {
            'project-1': { doneTime: 30 },
            'project-2': { doneTime: 120 },
        }

        expect(getEndDayMoneyEarnedSummary(projects, statistics, USER_ID, 'EUR')).toEqual({
            amount: 240,
            currency: 'EUR',
            formattedValue: '240 €',
        })
    })

    it('does not count unmonetized calendar durations or estimates', () => {
        const projects = [createProject('client-work', 100), createProject('private-calendar', null)]
        const statistics = {
            'client-work': { doneTime: 15 },
            'private-calendar': { doneTime: 900 },
        }

        expect(getEndDayMoneyEarnedSummary(projects, statistics, USER_ID, 'EUR')).toEqual({
            amount: 25,
            currency: 'EUR',
            formattedValue: '25 €',
        })
    })

    it('counts reconciled day-rate time when the project has a monetary rate', () => {
        const projects = [createProject('day-rate-project', 100)]
        const statistics = {
            'day-rate-project': { doneTime: 480 },
        }

        expect(getEndDayMoneyEarnedSummary(projects, statistics, USER_ID, 'EUR')).toEqual({
            amount: 800,
            currency: 'EUR',
            formattedValue: '800 €',
        })
    })

    it('converts mixed project currencies and uses existing whole-currency rounding', () => {
        const projects = [createProject('euro-project', 100, 'EUR'), createProject('usd-project', 99, 'USD')]
        const statistics = {
            'euro-project': { doneTime: 60 },
            'usd-project': { doneTime: 30 },
        }

        const summary = getEndDayMoneyEarnedSummary(projects, statistics, USER_ID, 'EUR')

        expect(summary).toEqual({
            amount: expect.any(Number),
            currency: 'EUR',
            formattedValue: '145 €',
        })
        expect(summary.amount).toBeCloseTo(145.045)
    })
})
