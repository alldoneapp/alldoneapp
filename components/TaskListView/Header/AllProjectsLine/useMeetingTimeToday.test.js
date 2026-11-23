import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { useSelector } from 'react-redux'

import useMeetingTimeToday from './useMeetingTimeToday'
import { getDb } from '../../../../utils/backends/firestore'
import { getTasksCompletedTodayQuery } from '../../../../utils/backends/Tasks/myDayDoneTasks'
import { resetCalendarSyncStatuses, setCalendarSyncStatus } from '../../../../utils/calendarSyncStatus'

jest.mock('react-redux', () => ({ useSelector: jest.fn(), shallowEqual: jest.fn((a, b) => a === b) }))
// The page-visible signal (tab shown, focus, thaw) is fired by hand.
const mockPageVisibleSubscribers = new Set()
jest.mock('../../../../utils/appResume', () => ({
    subscribePageVisible: callback => {
        mockPageVisibleSubscribers.add(callback)
        return () => mockPageVisibleSubscribers.delete(callback)
    },
}))
jest.mock('../../../../utils/backends/firestore', () => ({ getDb: jest.fn() }))
jest.mock('../../../../utils/backends/Tasks/myDayDoneTasks', () => ({ getTasksCompletedTodayQuery: jest.fn() }))
jest.mock('../../taskBoardCalendarSync', () => ({
    getCalendarConnectedProjectIdsFromApis: apis =>
        Object.entries(apis || {})
            .filter(([, flags]) => flags?.calendar)
            .map(([projectId]) => projectId)
            .sort(),
}))

// A tiny Firestore double: every query records its clauses and its listeners by path.
let listeners
let settingsListener
const makeQuery = (path, clauses = []) => ({
    where: (...clause) => makeQuery(path, [...clauses, clause]),
    orderBy: (...clause) => makeQuery(path, [...clauses, ['orderBy', ...clause]]),
    onSnapshot: (onNext, onError) => {
        const entry = { path, clauses, onNext, onError, active: true }
        listeners.push(entry)
        return () => {
            entry.active = false
        }
    },
})

const snapshot = docs => ({
    forEach: fn => docs.forEach(([id, data]) => fn({ id, data: () => data })),
})

// A fixed clock (jest modern fake timers mock Date too): every case is deterministic.
const today = '2026-11-23'
const at = (clock, day = today) => moment(`${day}T${clock}`).valueOf()
const meetingDoc = (id, start, end, day = today) => [
    id,
    {
        name: id,
        calendarData: {
            start: { dateTime: moment(`${day}T${start}:00`).format() },
            end: { dateTime: moment(`${day}T${end}:00`).format() },
        },
    },
]

let state
let latest
function Probe({ enabled = true }) {
    latest = useMeetingTimeToday({ enabled })
    return null
}

let mountedTrees = []
const mount = props => {
    let tree
    act(() => {
        tree = renderer.create(<Probe {...props} />)
    })
    mountedTrees.push(tree)
    return tree
}

const answerSettings = data => act(() => settingsListener.onNext({ exists: data !== null, data: () => data }))

const taskListeners = () => listeners.filter(entry => entry.active)

describe('useMeetingTimeToday (AT-3136)', () => {
    afterEach(() => {
        mountedTrees.forEach(tree => act(() => tree.unmount()))
        mountedTrees = []
        jest.useRealTimers()
    })

    beforeEach(() => {
        // Before the working day by default: the remaining window is the whole day.
        jest.useFakeTimers({ now: at('08:00:00') })
        mockPageVisibleSubscribers.clear()
        listeners = []
        settingsListener = null
        latest = undefined
        resetCalendarSyncStatuses()
        state = {
            loggedUser: {
                uid: 'u1',
                isAnonymous: false,
                projectIds: ['p1', 'p2', 'archived', 'guide'],
                archivedProjectIds: ['archived'],
                templateProjectIds: [],
                guideProjectIds: ['guide'],
                apisConnected: { p1: { calendar: true } },
            },
            currentUser: { uid: 'u1' },
        }
        useSelector.mockImplementation(selector => selector(state))
        getDb.mockReturnValue({
            doc: path => ({
                onSnapshot: (onNext, onError) => {
                    settingsListener = { path, onNext, onError }
                    return jest.fn()
                },
            }),
            collection: path => makeQuery(path),
        })
        getTasksCompletedTodayQuery.mockImplementation((projectId, userId, readerId, startOfToday) =>
            makeQuery(`items/${projectId}/tasks`, [['done-today', userId, readerId, startOfToday]])
        )
    })

    it('reads the meeting link working hours and counts open and done-today meetings of active projects', () => {
        mount()
        expect(settingsListener.path).toBe('users/u1/bookingSettings/default')
        expect(latest).toEqual({ status: 'loading' })

        answerSettings({ workingHoursStart: '09:00', workingHoursEnd: '18:00' })
        // p1 and p2 (active), not the archived or guide project; open + done-today per project.
        expect(taskListeners().map(entry => entry.path)).toEqual([
            'items/p1/tasks',
            'items/p1/tasks',
            'items/p2/tasks',
            'items/p2/tasks',
        ])
        // Same clause order as the board's open-tasks query, so Firestore can share the target.
        expect(taskListeners()[0].clauses.map(clause => clause[0])).toEqual([
            'inDone',
            'currentReviewerId',
            'readerIds',
            'dueDate',
        ])
        expect(latest.status).toBe('calendarLoading')

        const [p1Open, p1Done, p2Open, p2Done] = taskListeners()
        act(() => {
            p1Open.onNext(snapshot([meetingDoc('standup', '09:30', '10:00'), ['plain-task', { name: 'x' }]]))
            p1Done.onNext(snapshot([meetingDoc('ticked-off', '08:30', '09:15')]))
            p2Open.onNext(snapshot([meetingDoc('routed', '09:45', '10:30')]))
        })
        expect(latest.status).toBe('calendarLoading')

        act(() => p2Done.onNext(snapshot([])))
        // 09:00–09:15 (clipped) + 09:30–10:30 (union) = 75 min of a 540 min window.
        expect(latest).toMatchObject({ status: 'ready', meetingMinutes: 75, freeMinutes: 465, meetingCount: 3 })
    })

    it('shows the working time only, without listening to tasks, when no calendar is connected', () => {
        state.loggedUser.apisConnected = { p1: { gmail: true } }
        mount()
        answerSettings(null)
        expect(taskListeners()).toHaveLength(0)
        expect(latest).toMatchObject({ status: 'noCalendar', workingHours: { isDefault: true }, windowMinutes: 480 })
    })

    it('reports unavailable calendar data when a meeting listener fails', () => {
        mount()
        answerSettings(null)
        act(() => taskListeners()[0].onError(new Error('permission-denied')))
        expect(latest.status).toBe('calendarUnavailable')
    })

    it('passes the calendar sync state through', () => {
        mount()
        answerSettings(null)
        act(() => taskListeners().forEach(entry => entry.onNext(snapshot([]))))
        expect(latest.syncStatus).toBe('unknown')
        act(() => setCalendarSyncStatus('p1', 'syncing'))
        expect(latest.syncStatus).toBe('syncing')
        act(() => setCalendarSyncStatus('p1', 'failed'))
        expect(latest.syncStatus).toBe('failed')
    })

    it('stays off for the assistant profile board and when disabled', () => {
        state.currentUser = { uid: 'assistant-1' }
        mount()
        expect(latest).toBeNull()
        expect(settingsListener).toBeNull()

        state.currentUser = { uid: 'u1' }
        mount({ enabled: false })
        expect(latest).toBeNull()
        expect(settingsListener).toBeNull()
    })

    it('stops its listeners on unmount', () => {
        const tree = mount()
        answerSettings(null)
        expect(taskListeners().length).toBeGreaterThan(0)
        act(() => tree.unmount())
        expect(taskListeners()).toHaveLength(0)
    })

    // AT-3136, user correction 2026-11-23: time to work counts down live from now.
    describe('live remaining time to work', () => {
        const answerAll = docs => act(() => taskListeners().forEach(entry => entry.onNext(snapshot(docs))))
        const ready = () => {
            mount()
            answerSettings({ workingHoursStart: '09:00', workingHoursEnd: '18:00' })
        }
        const advance = ms => act(() => jest.advanceTimersByTime(ms))

        it('counts down every minute without a calendar sync, a snapshot or a navigation', () => {
            jest.setSystemTime(at('09:57:00'))
            ready()
            answerAll([meetingDoc('call', '10:00', '11:00')])
            const listenersBefore = listeners.length
            // 18:00 − 09:57 = 483 min, minus the 60 min meeting ahead.
            expect(latest).toMatchObject({ status: 'ready', meetingMinutes: 60, freeMinutes: 423 })

            advance(60 * 1000 + 250) // first tick just after 09:58
            expect(Math.round(latest.freeMinutes)).toBe(422)
            advance(60 * 1000) // 09:59
            expect(Math.round(latest.freeMinutes)).toBe(421)
            // During the meeting the free time stays put; after it, it counts down again.
            advance(30 * 60 * 1000) // 10:29
            expect(Math.round(latest.freeMinutes)).toBe(420)
            advance(35 * 60 * 1000) // 11:04
            expect(Math.round(latest.freeMinutes)).toBe(416)
            // The whole-day meeting total does not change as the meeting passes.
            expect(latest.meetingMinutes).toBe(60)
            // No listener was re-opened for any of this.
            expect(listeners.length).toBe(listenersBefore)
        })

        it('reaches 0 at the end of the working hours and says the working day is over', () => {
            jest.setSystemTime(at('17:58:30'))
            ready()
            answerAll([])
            expect(latest).toMatchObject({ freeMinutes: 1.5, workdayPhase: 'during' })
            advance(2 * 60 * 1000)
            expect(latest).toMatchObject({ freeMinutes: 0, workdayPhase: 'after', meetingMinutes: 0 })
        })

        it('refreshes at once when the page is visible again, even if the timers were frozen', () => {
            jest.setSystemTime(at('10:00:00'))
            ready()
            answerAll([])
            expect(latest.freeMinutes).toBe(480)
            expect(mockPageVisibleSubscribers.size).toBe(1)
            // The tab slept for two hours: the clock moved, no timer ran.
            jest.setSystemTime(at('12:00:00'))
            act(() => mockPageVisibleSubscribers.forEach(callback => callback({ hiddenMs: 2 * 60 * 60 * 1000 })))
            expect(latest.freeMinutes).toBe(360)
        })

        it('clears its timer and its page-visible subscription on unmount', () => {
            const tree = mount()
            expect(jest.getTimerCount()).toBe(1)
            expect(mockPageVisibleSubscribers.size).toBe(1)
            act(() => tree.unmount())
            expect(jest.getTimerCount()).toBe(0)
            expect(mockPageVisibleSubscribers.size).toBe(0)
        })

        it("never shows yesterday's meetings after midnight: it waits for the new day's listeners", () => {
            jest.setSystemTime(at('23:59:30'))
            ready()
            answerAll([meetingDoc('late-review', '16:00', '17:00')])
            expect(latest).toMatchObject({ status: 'ready', meetingMinutes: 60, workdayPhase: 'after' })
            const oldListeners = taskListeners()

            advance(31 * 1000) // 00:00:00.25 on the next day
            expect(latest.status).toBe('calendarLoading')
            expect(latest.meetingMinutes).toBeUndefined()
            oldListeners.forEach(entry => expect(entry.active).toBe(false))
            // Re-opened for the new day (the done-today query gets the new start of day).
            const nextDay = '2026-11-24'
            const doneListener = taskListeners().find(entry => entry.clauses[0][0] === 'done-today')
            expect(doneListener.clauses[0][3]).toBe(at('00:00:00', nextDay))

            answerAll([meetingDoc('late-review', '16:00', '17:00'), meetingDoc('standup', '09:30', '10:00', nextDay)])
            // Only the new day's meeting counts; the whole new day is still ahead.
            expect(latest).toMatchObject({
                status: 'ready',
                meetingMinutes: 30,
                freeMinutes: 510,
                workdayPhase: 'before',
            })
        })
    })
})
