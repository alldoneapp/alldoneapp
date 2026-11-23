import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'
import { useSelector } from 'react-redux'

import MeetingTimeToday from './MeetingTimeToday'
import NavigationService from '../../../../utils/NavigationService'
import SettingsHelper from '../../../SettingsView/SettingsHelper'
import { DV_TAB_SETTINGS_CUSTOMIZATIONS, DV_TAB_SETTINGS_INTEGRATIONS } from '../../../../utils/TabNavigationConstants'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
}))
jest.mock('../../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../SettingsView/SettingsHelper', () => ({
    __esModule: true,
    default: { processURLSettingsTab: jest.fn() },
}))

const SAVED_HOURS = { start: '09:00', end: '18:00', isDefault: false }
const DEFAULT_HOURS = { start: '09:00', end: '17:00', isDefault: true }

const textOf = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => [].concat(node.props.children).join(''))
        .join('|')

const textIn = (tree, testID) => {
    const nodes = tree.root.findAll(node => node.props.testID === testID && typeof node.type !== 'string')
    if (!nodes.length) return null
    return nodes[0]
        .findAllByType(Text)
        .map(node => [].concat(node.props.children).join(''))
        .join('|')
}

const flatStyle = node => Object.assign({}, ...[].concat(node.props.style).flat(Infinity).filter(Boolean))

const render = view => {
    let tree
    act(() => {
        tree = renderer.create(<MeetingTimeToday view={view} />)
    })
    return tree
}

describe('MeetingTimeToday (AT-3136)', () => {
    let mobile

    beforeEach(() => {
        mobile = false
        useSelector.mockImplementation(selector => selector({ smallScreenNavigation: mobile }))
        SettingsHelper.processURLSettingsTab.mockClear()
    })

    it('renders nothing while the working hours are still loading', () => {
        expect(render({ status: 'loading' }).toJSON()).toBeNull()
        expect(render(null).toJSON()).toBeNull()
    })

    it('shows the time to work as the one large figure, meetings and hours as small secondary text', () => {
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
        expect(text).not.toContain('meetingTime sync failed')

        // AT-3136 follow-up: "6h 30m Time to work" is the primary figure ...
        expect(textIn(tree, 'meeting-time-primary')).toBe('6h 30m|meetingTime time to work')
        // ... the working hours and the meeting time are the secondary text.
        expect(textIn(tree, 'meeting-time-secondary')).toBe('9–18| · |meetingTime meetings 2h 30m')

        const value = tree.root.findByProps({ testID: 'meeting-time-primary-value' })
        const valueSize = flatStyle(value).fontSize
        const secondarySizes = tree.root
            .findByProps({ testID: 'meeting-time-secondary' })
            .findAllByType(Text)
            .map(node => flatStyle(node).fontSize)
        expect(secondarySizes.length).toBeGreaterThan(0)
        secondarySizes.forEach(size => expect(size).toBeLessThan(valueSize))
        const label = tree.root.findByProps({ testID: 'meeting-time-primary' }).findAllByType(Text)[1]
        expect(flatStyle(label).fontSize).toBeLessThan(valueSize)

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

        // Settings > Customizations, where the meeting link working hours are edited.
        act(() => tree.root.findByProps({ testID: 'meeting-time-hours' }).props.onPress())
        expect(SettingsHelper.processURLSettingsTab).toHaveBeenCalledWith(
            NavigationService,
            DV_TAB_SETTINGS_CUSTOMIZATIONS
        )
    })

    it('without a calendar shows only the working time and a connect link, never 0h meetings', () => {
        const tree = render({ status: 'noCalendar', workingHours: DEFAULT_HOURS, windowMinutes: 480 })
        const text = textOf(tree)
        expect(text).toContain('meetingTime working time 8h')
        expect(text).toContain('meetingTime connect calendar')
        expect(text).not.toContain('meetingTime meetings')
        expect(text).not.toContain('meetingTime time to work')
        // Unknown free time is never the large figure.
        expect(textIn(tree, 'meeting-time-primary')).toBeNull()

        // Calendars are connected in Settings > Integrations; the project properties have no
        // calendar section any more.
        act(() => tree.root.findByProps({ testID: 'meeting-time-connect' }).props.onPress())
        expect(SettingsHelper.processURLSettingsTab).toHaveBeenCalledWith(
            NavigationService,
            DV_TAB_SETTINGS_INTEGRATIONS
        )
    })

    it('shows placeholders, not numbers, while the meetings load', () => {
        const tree = render({ status: 'calendarLoading', workingHours: SAVED_HOURS, windowMinutes: 540 })
        const text = textOf(tree)
        expect(text).toContain('meetingTime meetings …')
        expect(textIn(tree, 'meeting-time-primary')).toBe('…|meetingTime time to work')
        expect(text).not.toMatch(/\dh/)
    })

    it('says so when calendar data could not be loaded', () => {
        const text = textOf(render({ status: 'calendarUnavailable', workingHours: SAVED_HOURS, windowMinutes: 540 }))
        expect(text).toContain('meetingTime calendar unavailable')
        expect(text).not.toContain('meetingTime time to work')
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
        // The warning is secondary; the figure itself stays the large one.
        expect(textIn(tree, 'meeting-time-secondary')).toContain('meetingTime sync failed')
        expect(textIn(tree, 'meeting-time-primary')).toBe('8h|meetingTime time to work')
        expect(tree.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel).toContain(
            'meetingTime sync failed hint'
        )
    })

    it('dims the large figure while the calendar is still syncing', () => {
        const tree = render({
            status: 'ready',
            workingHours: SAVED_HOURS,
            meetingMinutes: 60,
            freeMinutes: 480,
            windowMinutes: 540,
            syncStatus: 'syncing',
        })
        expect(flatStyle(tree.root.findByProps({ testID: 'meeting-time-primary' }))).toEqual(
            expect.objectContaining({ opacity: 0.6 })
        )
    })

    it('on mobile shows the same hierarchy, allowed to wrap, with the default range (AT-3136)', () => {
        mobile = true
        const tree = render({
            status: 'ready',
            workingHours: DEFAULT_HOURS,
            meetingMinutes: 30,
            freeMinutes: 450,
            windowMinutes: 480,
            syncStatus: 'synced',
        })
        expect(textOf(tree)).toBe(
            'meetingTime default hours {"range":"9–17"}| · |meetingTime meetings 30m|7h 30m|meetingTime time to work'
        )
        const style = [].concat(tree.root.findByProps({ testID: 'meeting-time-today' }).props.style)
        expect(style).toContainEqual(expect.objectContaining({ flexWrap: 'wrap-reverse' }))
    })
})
