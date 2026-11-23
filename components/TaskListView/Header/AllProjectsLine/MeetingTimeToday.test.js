import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import MeetingTimeToday from './MeetingTimeToday'
import NavigationService from '../../../../utils/NavigationService'
import { DV_TAB_PROJECT_PROPERTIES, DV_TAB_SETTINGS_CUSTOMIZATIONS } from '../../../../utils/TabNavigationConstants'

jest.mock('react-redux', () => ({ useSelector: jest.fn(), useDispatch: jest.fn() }))
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
}))
jest.mock('../../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../../redux/actions', () => ({
    navigateToSettings: jest.fn(options => ({ type: 'navigateToSettings', options })),
    setSelectedNavItem: jest.fn(item => ({ type: 'setSelectedNavItem', item })),
}))

const SAVED_HOURS = { start: '09:00', end: '18:00', isDefault: false }
const DEFAULT_HOURS = { start: '09:00', end: '17:00', isDefault: true }

const textOf = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => [].concat(node.props.children).join(''))
        .join('|')

const render = view => {
    let tree
    act(() => {
        tree = renderer.create(<MeetingTimeToday view={view} />)
    })
    return tree
}

describe('MeetingTimeToday (AT-3136)', () => {
    let dispatch
    let mobile

    beforeEach(() => {
        dispatch = jest.fn()
        mobile = false
        useDispatch.mockReturnValue(dispatch)
        useSelector.mockImplementation(selector =>
            selector({
                smallScreenNavigation: mobile,
                loggedUser: { defaultProjectId: 'p-default', projectIds: ['p-other', 'p-default'] },
                loggedUserProjectsMap: { 'p-default': { index: 4 }, 'p-other': { index: 1 } },
            })
        )
        NavigationService.navigate.mockClear()
    })

    it('renders nothing while the working hours are still loading', () => {
        expect(render({ status: 'loading' }).toJSON()).toBeNull()
        expect(render(null).toJSON()).toBeNull()
    })

    it('shows meeting time and calendar-free time with the saved working hours', () => {
        const tree = render({
            status: 'ready',
            workingHours: SAVED_HOURS,
            meetingMinutes: 150,
            freeMinutes: 390,
            windowMinutes: 540,
            syncStatus: 'synced',
        })
        const text = textOf(tree)
        expect(text).toContain('9–18')
        expect(text).toContain('meetingTime meetings 2h 30m')
        expect(text).toContain('meetingTime calendar free 6h 30m')
        expect(text).not.toContain('meetingTime sync failed')
        expect(tree.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel).toContain(
            'meetingTime summary'
        )
    })

    it('labels the assumed default working hours as default and links to their settings', () => {
        const tree = render({
            status: 'ready',
            workingHours: DEFAULT_HOURS,
            meetingMinutes: 0,
            freeMinutes: 480,
            windowMinutes: 480,
            syncStatus: 'synced',
        })
        expect(textOf(tree)).toContain('meetingTime default hours {"range":"9–17"}')

        act(() => tree.root.findByProps({ testID: 'meeting-time-hours' }).props.onPress())
        expect(dispatch).toHaveBeenCalledWith({
            type: 'navigateToSettings',
            options: { selectedNavItem: DV_TAB_SETTINGS_CUSTOMIZATIONS },
        })
        expect(NavigationService.navigate).toHaveBeenCalledWith('SettingsView')
    })

    it('without a calendar shows only the working time and a connect link, never 0h meetings', () => {
        const tree = render({ status: 'noCalendar', workingHours: DEFAULT_HOURS, windowMinutes: 480 })
        const text = textOf(tree)
        expect(text).toContain('meetingTime working time 8h')
        expect(text).toContain('meetingTime connect calendar')
        expect(text).not.toContain('meetingTime meetings')
        expect(text).not.toContain('meetingTime calendar free')

        act(() => tree.root.findByProps({ testID: 'meeting-time-connect' }).props.onPress())
        expect(dispatch).toHaveBeenCalledWith({ type: 'setSelectedNavItem', item: DV_TAB_PROJECT_PROPERTIES })
        expect(NavigationService.navigate).toHaveBeenCalledWith('ProjectDetailedView', { projectIndex: 4 })
    })

    it('shows placeholders, not numbers, while the meetings load', () => {
        const text = textOf(render({ status: 'calendarLoading', workingHours: SAVED_HOURS, windowMinutes: 540 }))
        expect(text).toContain('meetingTime meetings …')
        expect(text).toContain('meetingTime calendar free …')
        expect(text).not.toMatch(/\dh/)
    })

    it('says so when calendar data could not be loaded', () => {
        const text = textOf(render({ status: 'calendarUnavailable', workingHours: SAVED_HOURS, windowMinutes: 540 }))
        expect(text).toContain('meetingTime calendar unavailable')
        expect(text).not.toContain('meetingTime calendar free')
    })

    it('flags figures from a failed calendar sync', () => {
        const tree = render({
            status: 'ready',
            workingHours: SAVED_HOURS,
            meetingMinutes: 60,
            freeMinutes: 480,
            windowMinutes: 540,
            syncStatus: 'failed',
        })
        expect(tree.root.findAllByProps({ testID: 'meeting-time-failed' }).length).toBeGreaterThan(0)
        expect(tree.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel).toContain(
            'meetingTime sync failed hint'
        )
    })

    it('uses two short lines on mobile and keeps the default range visible', () => {
        mobile = true
        const text = textOf(
            render({
                status: 'ready',
                workingHours: DEFAULT_HOURS,
                meetingMinutes: 30,
                freeMinutes: 450,
                windowMinutes: 480,
                syncStatus: 'synced',
            })
        )
        expect(text).toBe('meetingTime meetings 30m|meetingTime calendar free 7h 30m (9–17)')
    })
})
