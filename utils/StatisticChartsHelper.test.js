import moment from 'moment'

jest.mock('../redux/store', () => ({
    getState: () => ({ loggedUserProjects: [] }),
}))

import {
    getChartBucketTimestamp,
    getChartName,
    getDataForCharts,
    getDataForOKRCharts,
    getDataForOneProjectCharts,
    getOKRDataForOneProjectChart,
    STATISTIC_CHART_OKRS,
} from './StatisticChartsHelper'

describe('StatisticChartsHelper OKR charts', () => {
    it('averages OKR progress in the same project chart bucket', () => {
        const firstDay = moment('2026-06-01').valueOf()
        const secondDay = moment('2026-06-02').valueOf()
        const result = getOKRDataForOneProjectChart(
            [
                { timestamp: firstDay, progress: 0 },
                { timestamp: firstDay, progress: 80 },
                { timestamp: secondDay, progress: 100 },
            ],
            moment('2026-06-01'),
            moment('2026-06-30')
        )

        expect(result).toEqual({
            data: [
                { x: firstDay, y: 40 },
                { x: secondDay, y: 100 },
            ],
            unit: 'day',
        })
    })

    it('aligns all-project OKR data to shared chart labels', () => {
        const result = getDataForOKRCharts(
            [
                { timestamp: moment('2026-06-01').valueOf(), progress: 20 },
                { timestamp: moment('2026-06-01').valueOf(), progress: 60 },
            ],
            'D MMM YYYY',
            ['1 Jun 2026', '2 Jun 2026']
        )

        expect(result).toEqual([
            { x: '1 Jun 2026', y: 40 },
            { x: '2 Jun 2026', y: 0 },
        ])
    })

    it('returns the OKR chart label', () => {
        expect(getChartName(STATISTIC_CHART_OKRS)).toBe('OKRs')
    })
})

describe('StatisticChartsHelper bar spacing', () => {
    // A statistics document's `timestamp` is the completion time of the last task that touched
    // it. Chart.js sizes bars on a time axis from the smallest gap between x values, so two
    // stamps minutes apart (23:48 followed by a day-rate midnight write) collapse a whole month
    // of bars into hairlines. The chart must receive one evenly spaced x per day.
    it('snaps daily statistics points to the start of their day', () => {
        const day1 = moment('2026-08-12 23:48:43', 'YYYY-MM-DD HH:mm:ss')
        const day2 = moment('2026-08-13 00:00:00', 'YYYY-MM-DD HH:mm:ss')
        const day3 = moment('2026-08-14 17:12:00', 'YYYY-MM-DD HH:mm:ss')
        const data = {
            [day1.valueOf()]: 11.25,
            [day2.valueOf()]: 8,
            [day3.valueOf()]: 8,
        }

        const { data: points, unit } = getDataForOneProjectCharts(
            data,
            moment('2026-08-01', 'YYYY-MM-DD').startOf('day'),
            moment('2026-08-31', 'YYYY-MM-DD').endOf('day')
        )

        expect(unit).toBe('day')
        expect(points).toEqual([
            { x: day1.clone().startOf('day').valueOf(), y: 11.25 },
            { x: day2.clone().startOf('day').valueOf(), y: 8 },
            { x: day3.clone().startOf('day').valueOf(), y: 8 },
        ])
        const gaps = points.slice(1).map((point, index) => point.x - points[index].x)
        expect(gaps).toEqual([24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000])
    })

    it('snaps to the month when the range is charted by month', () => {
        const stamp = moment('2026-08-12 23:48:43', 'YYYY-MM-DD HH:mm:ss')
        const { data: points, unit } = getDataForOneProjectCharts(
            { [stamp.valueOf()]: 3 },
            moment('2026-01-01', 'YYYY-MM-DD').startOf('day'),
            moment('2026-08-31', 'YYYY-MM-DD').endOf('day')
        )

        expect(unit).toBe('month')
        expect(points).toEqual([{ x: stamp.clone().startOf('month').valueOf(), y: 3 }])
    })

    it('still merges several stamps of the same day into one point', () => {
        const morning = moment('2026-08-12 09:00:00', 'YYYY-MM-DD HH:mm:ss')
        const evening = moment('2026-08-12 21:00:00', 'YYYY-MM-DD HH:mm:ss')
        const points = getDataForCharts({ [morning.valueOf()]: 2, [evening.valueOf()]: 3 }, 'D MMM YYYY', 'day')

        expect(points).toEqual([{ x: morning.clone().startOf('day').valueOf(), y: 5 }])
    })

    it('keeps the label list of the all-projects chart as the x value', () => {
        const stamp = moment('2026-08-12 23:48:43', 'YYYY-MM-DD HH:mm:ss')
        const points = getDataForCharts({ [stamp.valueOf()]: 4 }, 'D MMM YYYY', 'day', ['11 Aug 2026', '12 Aug 2026'])

        expect(points).toEqual([
            { x: '11 Aug 2026', y: 0 },
            { x: '12 Aug 2026', y: 4 },
        ])
    })

    it('leaves a timestamp untouched when no unit is known', () => {
        expect(getChartBucketTimestamp(1755035323000, '')).toBe(1755035323000)
    })
})
