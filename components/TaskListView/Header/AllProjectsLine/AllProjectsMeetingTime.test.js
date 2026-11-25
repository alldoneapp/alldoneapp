/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'

import AllProjectsMeetingTime from './AllProjectsMeetingTime'
import { DAILY_PLAN_COMPACT_ENTRY_WIDTH } from '../../DailyPlan/DailyPlanEntry'

const mockDensity = jest.fn(() => 'density')
const mockView = { status: 'ready', meetingMinutes: 60, meetingCount: 1, workingHours: {} }

jest.mock('./useMeetingTimeToday', () => ({ __esModule: true, default: () => mockView }))
jest.mock('./MeetingTimeToday', () => ({
    __esModule: true,
    default: 'MeetingTimeToday',
    getMeetingTimeDensity: (...args) => mockDensity(...args),
}))
jest.mock('../../DailyPlan/DailyPlanEntry', () => ({
    __esModule: true,
    default: 'DailyPlanEntry',
    DAILY_PLAN_COMPACT_ENTRY_WIDTH: 36,
}))

// AT-3142 merged with AT-3136: "Plan my day" shares the one-row mobile line with the time display.
describe('AllProjectsMeetingTime with Plan my day', () => {
    beforeEach(() => mockDensity.mockClear())

    it('passes the same meeting view to the time display and the plan entry', () => {
        const root = renderer.create(<AllProjectsMeetingTime />).root
        expect(root.findByType('MeetingTimeToday').props.view).toBe(mockView)
        expect(root.findByType('DailyPlanEntry').props.meetingView).toBe(mockView)
    })

    it('keeps the full entry and the unchanged density on desktop', () => {
        const root = renderer.create(<AllProjectsMeetingTime />).root
        expect(root.findByType('DailyPlanEntry').props.compact).toBe(false)
        expect(mockDensity).toHaveBeenCalledWith(false, 0, false, false)
    })

    it('makes the entry compact on mobile and takes its width off the room for the time display', () => {
        const root = renderer.create(<AllProjectsMeetingTime mobile lineWidth={358} />).root
        expect(root.findByType('DailyPlanEntry').props.compact).toBe(true)
        expect(mockDensity).toHaveBeenCalledWith(true, 358 - DAILY_PLAN_COMPACT_ENTRY_WIDTH, false, false)
    })

    it('leaves an unmeasured mobile line unmeasured (minimal density first)', () => {
        renderer.create(<AllProjectsMeetingTime mobile lineWidth={0} />)
        expect(mockDensity).toHaveBeenCalledWith(true, 0, false, false)
    })

    // AT-3157: the after-work label is wider than a figure, so the density knows about it.
    it('tells the density when the working hours are over', () => {
        mockView.workdayPhase = 'after'
        try {
            renderer.create(<AllProjectsMeetingTime mobile lineWidth={358} />)
            expect(mockDensity).toHaveBeenCalledWith(true, 358 - DAILY_PLAN_COMPACT_ENTRY_WIDTH, false, true)
        } finally {
            delete mockView.workdayPhase
        }
    })
})
