import moment from 'moment'

jest.mock('../redux/store', () => ({
    getState: () => ({ loggedUserProjects: [] }),
}))

import {
    getChartName,
    getDataForOKRCharts,
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
