import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { useSelector } from 'react-redux'

import useMeetingTimeToday from './useMeetingTimeToday'
import { getDb } from '../../../../utils/backends/firestore'
import { getTasksCompletedTodayQuery } from '../../../../utils/backends/Tasks/myDayDoneTasks'
import { resetCalendarSyncStatuses, setCalendarSyncStatus } from '../../../../utils/calendarSyncStatus'

jest.mock('react-redux', () => ({ useSelector: jest.fn(), shallowEqual: jest.fn((a, b) => a === b) }))
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

const today = moment().format('YYYY-MM-DD')
const meetingDoc = (id, start, end) => [
    id,
    {
        name: id,
        calendarData: {
            start: { dateTime: moment(`${today}T${start}:00`).format() },
            end: { dateTime: moment(`${today}T${end}:00`).format() },
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
    })

    beforeEach(() => {
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
})
