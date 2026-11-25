import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import MeetingTimeToday, {
    AFTER_WORK_NARROW_MAX_WIDTH,
    MEETING_TIME_DENSITY_COMPACT,
    MEETING_TIME_DENSITY_FULL,
    MEETING_TIME_DENSITY_MINIMAL,
    getMeetingTimeDensity,
} from './MeetingTimeToday'
import NavigationService from '../../../../utils/NavigationService'
import SettingsHelper from '../../../SettingsView/SettingsHelper'
import { DV_TAB_SETTINGS_INTEGRATIONS, DV_TAB_SETTINGS_MEETING_TIME } from '../../../../utils/TabNavigationConstants'

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

// Icon glyphs (private use area of the icon font) are left out: only the words the line shows.
const isIconGlyph = text => /^[\uE000-\uF8FF]*$/.test(text)

const textOf = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => [].concat(node.props.children).join(''))
        .filter(text => !isIconGlyph(text))
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

const render = (view, density) => {
    let tree
    act(() => {
        tree = renderer.create(<MeetingTimeToday view={view} density={density} />)
    })
    return tree
}

// 14:05 local time today (the hook passes the remaining window's start).
const at = (hours, minutes) => {
    const date = new Date()
    date.setHours(hours, minutes, 0, 0)
    return date.getTime()
}

const READY = {
    status: 'ready',
    workingHours: SAVED_HOURS,
    meetingMinutes: 450,
    freeMinutes: 90,
    windowMinutes: 540,
    remainingFromMs: at(14, 5),
    workdayPhase: 'during',
    syncStatus: 'synced',
}

const SUMMARY = 'meetingTime summary {"meetings":"7h 30m","free":"1h 30m","from":"14:05","until":"18:00"}'

describe('MeetingTimeToday (AT-3136)', () => {
    beforeEach(() => {
        SettingsHelper.processURLSettingsTab.mockClear()
    })

    it('renders nothing while the working hours are still loading', () => {
        expect(render({ status: 'loading' }).toJSON()).toBeNull()
        expect(render(null).toJSON()).toBeNull()
    })

    it('shows the large time to work with "Time to work" / "7h 30m meetings" stacked to its right', () => {
        const tree = render(READY)
        // Nothing before the figure: it is the first text, the two small lines follow it.
        expect(textOf(tree)).toBe('1h 30m|meetingTime time to work|meetingTime meetings duration {"duration":"7h 30m"}')
        expect(textIn(tree, 'meeting-time-first-line')).toBe('meetingTime time to work')
        expect(textIn(tree, 'meeting-time-second-line')).toBe('meetingTime meetings duration {"duration":"7h 30m"}')
        // The working hours are no longer in the line ...
        expect(textOf(tree)).not.toContain('9–18')

        const lines = tree.root.findByProps({ testID: 'meeting-time-secondary' })
        expect(flatStyle(lines)).toEqual(expect.objectContaining({ flexDirection: 'column' }))
        const valueSize = flatStyle(tree.root.findByProps({ testID: 'meeting-time-primary-value' })).fontSize
        const lineSizes = lines.findAllByType(Text).map(node => flatStyle(node).fontSize)
        expect(lineSizes).toHaveLength(2)
        lineSizes.forEach(size => expect(size).toBeLessThan(valueSize))

        // ... but stay in the tooltip / accessibility label with the full explanation.
        const label = tree.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel
        expect(label).toContain('meetingTime working hours {"range":"9–18"}')
        expect(label).toContain(SUMMARY)
    })

    it('explains that time to work is what is left from now until the end of the working hours', () => {
        const label = view => render(view).root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel
        // Before the working day the remaining window starts at the working-hours start.
        expect(label({ ...READY, workdayPhase: 'before', remainingFromMs: at(9, 0), freeMinutes: 90 })).toContain(
            '"from":"9:00","until":"18:00"'
        )
        // Views without the live fields (older callers) fall back to the working-hours start.
        const { remainingFromMs, workdayPhase, ...legacy } = READY
        expect(label(legacy)).toContain('"from":"9:00","until":"18:00"')
    })

    // AT-3157: "Feierabend" instead of "0h" once the working hours are over.
    describe('after the working hours (AT-3157)', () => {
        const AFTER = { ...READY, freeMinutes: 0, workdayPhase: 'after', remainingFromMs: at(18, 0) }

        it('shows "Feierabend" instead of 0h, without the "Time to work" label, keeping the meeting total', () => {
            const tree = render(AFTER)
            expect(textOf(tree)).toBe('meetingTime after work|meetingTime meetings duration {"duration":"7h 30m"}')
            expect(textIn(tree, 'meeting-time-primary-value')).toBe('meetingTime after work')
            expect(textIn(tree, 'meeting-time-first-line')).toBeNull()
            expect(textOf(tree)).not.toContain('0h')
            // Full form: the label is the large one-line text, like a figure.
            const value = tree.root.findByProps({ testID: 'meeting-time-primary-value' })
            expect(flatStyle(value).fontSize).toBe(20)
            expect(value.props.numberOfLines).toBe(1)
            const label = tree.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel
            expect(label).toContain('meetingTime summary after hours {"meetings":"7h 30m"}')
            expect(label).not.toContain('meetingTime summary {')
        })

        it('keeps 0h when meetings fill the rest of the working day, which is not after work', () => {
            const tree = render({ ...READY, freeMinutes: 0, workdayPhase: 'during', remainingFromMs: at(14, 5) })
            expect(textOf(tree)).toBe('0h|meetingTime time to work|meetingTime meetings duration {"duration":"7h 30m"}')
            expect(textOf(tree)).not.toContain('meetingTime after work')
        })

        it('changes nothing before the working day or for views without the live phase', () => {
            const before = { ...READY, workdayPhase: 'before', remainingFromMs: at(9, 0), freeMinutes: 90 }
            expect(textOf(render(before))).toBe(textOf(render(READY)))
            const { workdayPhase, ...legacy } = AFTER
            expect(textOf(render(legacy))).toBe(
                '0h|meetingTime time to work|meetingTime meetings duration {"duration":"7h 30m"}'
            )
        })

        it('sets the label smaller and lets it wrap in the compact and minimal forms', () => {
            const compact = render(AFTER, MEETING_TIME_DENSITY_COMPACT)
            expect(textOf(compact)).toBe('meetingTime after work|7h 30m|meetingTime meetings')
            const minimal = render(AFTER, MEETING_TIME_DENSITY_MINIMAL)
            expect(textOf(minimal)).toBe('meetingTime after work')
            ;[compact, minimal].forEach(tree => {
                const value = tree.root.findByProps({ testID: 'meeting-time-primary-value' })
                expect(flatStyle(value)).toEqual(
                    expect.objectContaining({ fontSize: 14, maxWidth: AFTER_WORK_NARROW_MAX_WIDTH })
                )
                expect(value.props.numberOfLines).toBe(2)
            })
            // The meeting time stays in the tooltip of the minimal form.
            expect(minimal.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel).toContain(
                'meetingTime summary after hours {"meetings":"7h 30m"}'
            )
        })

        it('shows the label at once while the meetings load, undimmed, with "… meetings"', () => {
            const tree = render({ status: 'calendarLoading', workingHours: SAVED_HOURS, workdayPhase: 'after' })
            expect(textOf(tree)).toBe('meetingTime after work|meetingTime meetings duration {"duration":"…"}')
            expect(flatStyle(tree.root.findByProps({ testID: 'meeting-time-primary-value' })).opacity).toBeUndefined()
            expect(flatStyle(tree.root.findByProps({ testID: 'meeting-time-second-line' }))).toEqual(
                expect.objectContaining({ opacity: 0.6 })
            )
        })

        it('keeps the sync warning beside the meetings line', () => {
            const tree = render({ ...AFTER, syncStatus: 'failed' })
            expect(tree.root.findAllByProps({ testID: 'meeting-time-failed' }).length).toBeGreaterThan(0)
            const minimal = render({ ...AFTER, syncStatus: 'failed' }, MEETING_TIME_DENSITY_MINIMAL)
            expect(minimal.root.findAllByProps({ testID: 'meeting-time-failed' }).length).toBeGreaterThan(0)
        })

        it('keeps the calendar hints without a calendar or calendar data (no label there)', () => {
            const noCalendar = { status: 'noCalendar', workingHours: DEFAULT_HOURS, workdayPhase: 'after' }
            expect(textOf(render(noCalendar))).toBe('meetingTime time to work|meetingTime connect calendar')
            const unavailable = { status: 'calendarUnavailable', workingHours: SAVED_HOURS, workdayPhase: 'after' }
            expect(textOf(render(unavailable))).toBe('meetingTime time to work|meetingTime calendar unavailable')
        })
    })

    it('says in the tooltip when solo work blocks counted as time to work, without changing the line', () => {
        const label = view => render(view).root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel
        expect(label({ ...READY, workBlockCount: 2 })).toContain('meetingTime work blocks hint {"count":2}')
        expect(label({ ...READY, workBlockCount: 0 })).not.toContain('meetingTime work blocks hint')
        expect(label(READY)).not.toContain('meetingTime work blocks hint')
        expect(textOf(render({ ...READY, workBlockCount: 2 }))).toBe(textOf(render(READY)))
    })

    it('opens the meeting time statistics from the display, and names assumed default hours in the tooltip', () => {
        const tree = render({ ...READY, workingHours: DEFAULT_HOURS, meetingMinutes: 0, freeMinutes: 480 })
        expect(tree.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel).toContain(
            'meetingTime default working hours {"range":"9–17"}'
        )
        // AT-3145: Settings > Meeting time (the statistics), which link on to the working hours.
        act(() => tree.root.findByProps({ testID: 'meeting-time-today' }).props.onPress())
        expect(SettingsHelper.processURLSettingsTab).toHaveBeenCalledWith(
            NavigationService,
            DV_TAB_SETTINGS_MEETING_TIME
        )
    })

    it('without a calendar shows no figure, only a connect link, never 0h meetings', () => {
        const tree = render({ status: 'noCalendar', workingHours: DEFAULT_HOURS, windowMinutes: 480 })
        expect(textOf(tree)).toBe('meetingTime time to work|meetingTime connect calendar')
        expect(tree.root.findAllByProps({ testID: 'meeting-time-primary-value' })).toHaveLength(0)
        expect(tree.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel).toContain(
            'meetingTime no calendar hint'
        )

        // Calendars are connected in Settings > Integrations; the project properties have no
        // calendar section any more.
        act(() => tree.root.findByProps({ testID: 'meeting-time-today' }).props.onPress())
        expect(SettingsHelper.processURLSettingsTab).toHaveBeenCalledWith(
            NavigationService,
            DV_TAB_SETTINGS_INTEGRATIONS
        )
    })

    it('keeps the connect link in the narrow forms, as an icon in the minimal one', () => {
        const view = { status: 'noCalendar', workingHours: DEFAULT_HOURS, windowMinutes: 480 }
        expect(textOf(render(view, MEETING_TIME_DENSITY_COMPACT))).toBe('meetingTime connect calendar')
        const minimal = render(view, MEETING_TIME_DENSITY_MINIMAL)
        expect(textOf(minimal)).toBe('')
        expect(minimal.root.findAllByProps({ testID: 'meeting-time-connect-icon' }).length).toBeGreaterThan(0)
        const display = minimal.root.findByProps({ testID: 'meeting-time-today' })
        expect(display.props.accessibilityLabel).toContain('meetingTime no calendar hint')
        act(() => display.props.onPress())
        expect(SettingsHelper.processURLSettingsTab).toHaveBeenCalledWith(
            NavigationService,
            DV_TAB_SETTINGS_INTEGRATIONS
        )
    })

    it('shows placeholders, not numbers, while the meetings load', () => {
        const tree = render({ status: 'calendarLoading', workingHours: SAVED_HOURS, windowMinutes: 540 })
        expect(textOf(tree)).toBe('…|meetingTime time to work|meetingTime meetings duration {"duration":"…"}')
        expect(textOf(tree)).not.toMatch(/\dh/)
        expect(flatStyle(tree.root.findByProps({ testID: 'meeting-time-primary-value' }))).toEqual(
            expect.objectContaining({ opacity: 0.6 })
        )
        expect(tree.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel).toContain(
            'meetingTime loading hint'
        )
    })

    it('says so when calendar data could not be loaded, without a figure', () => {
        const tree = render({ status: 'calendarUnavailable', workingHours: SAVED_HOURS, windowMinutes: 540 })
        expect(textOf(tree)).toBe('meetingTime time to work|meetingTime calendar unavailable')
        expect(tree.root.findAllByProps({ testID: 'meeting-time-primary-value' })).toHaveLength(0)
        expect(textOf(render({ status: 'calendarUnavailable', workingHours: SAVED_HOURS }, 'compact'))).toBe(
            'meetingTime calendar unavailable'
        )
        const minimal = render({ status: 'calendarUnavailable', workingHours: SAVED_HOURS }, 'minimal')
        expect(textOf(minimal)).toBe('')
        expect(minimal.root.findAllByProps({ testID: 'meeting-time-unavailable-icon' }).length).toBeGreaterThan(0)
        expect(minimal.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel).toContain(
            'meetingTime unavailable hint'
        )
    })

    it('flags figures from a failed calendar sync with an icon, explained in the tooltip', () => {
        const view = { ...READY, syncStatus: 'failed' }
        const tree = render(view)
        expect(tree.root.findAllByProps({ testID: 'meeting-time-failed' }).length).toBeGreaterThan(0)
        // Only the icon, no extra text in the line; the figure stays the large one.
        expect(textOf(tree)).toBe('1h 30m|meetingTime time to work|meetingTime meetings duration {"duration":"7h 30m"}')
        expect(tree.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel).toContain(
            'meetingTime sync failed hint'
        )
        // The minimal form keeps the warning beside the figure.
        const minimal = render(view, MEETING_TIME_DENSITY_MINIMAL)
        expect(textOf(minimal)).toBe('1h 30m')
        expect(minimal.root.findAllByProps({ testID: 'meeting-time-failed' }).length).toBeGreaterThan(0)
    })

    it('dims the large figure while the calendar is still syncing', () => {
        const tree = render({ ...READY, syncStatus: 'syncing' })
        expect(flatStyle(tree.root.findByProps({ testID: 'meeting-time-primary-value' }))).toEqual(
            expect.objectContaining({ opacity: 0.6 })
        )
        expect(tree.root.findAllByProps({ testID: 'meeting-time-failed' })).toHaveLength(0)
    })

    it('drops the "Time to work" label in the compact form and keeps only the figure in the minimal one', () => {
        expect(textOf(render(READY, MEETING_TIME_DENSITY_COMPACT))).toBe('1h 30m|7h 30m|meetingTime meetings')
        const minimal = render(READY, MEETING_TIME_DENSITY_MINIMAL)
        expect(textOf(minimal)).toBe('1h 30m')
        // The meeting time is still in the tooltip / accessibility label.
        expect(minimal.root.findByProps({ testID: 'meeting-time-today' }).props.accessibilityLabel).toContain(SUMMARY)
    })
})

describe('getMeetingTimeDensity (AT-3136)', () => {
    it('is always the full form on desktop', () => {
        expect(getMeetingTimeDensity(false, 0)).toBe(MEETING_TIME_DENSITY_FULL)
        expect(getMeetingTimeDensity(false, 200)).toBe(MEETING_TIME_DENSITY_FULL)
    })

    it('fits the form to the measured width of the line on mobile sizes', () => {
        // Before the first layout: the smallest form, so the first frame never overlaps.
        expect(getMeetingTimeDensity(true, 0)).toBe(MEETING_TIME_DENSITY_MINIMAL)
        expect(getMeetingTimeDensity(true, 288)).toBe(MEETING_TIME_DENSITY_MINIMAL) // 320px screen
        expect(getMeetingTimeDensity(true, 328)).toBe(MEETING_TIME_DENSITY_MINIMAL) // 360px
        expect(getMeetingTimeDensity(true, 358)).toBe(MEETING_TIME_DENSITY_COMPACT) // 390px
        expect(getMeetingTimeDensity(true, 398)).toBe(MEETING_TIME_DENSITY_COMPACT) // 430px
        expect(getMeetingTimeDensity(true, 568)).toBe(MEETING_TIME_DENSITY_FULL) // 600px
    })

    it('needs more room when the sync warning icon is shown too', () => {
        expect(getMeetingTimeDensity(true, 358, true)).toBe(MEETING_TIME_DENSITY_MINIMAL)
        expect(getMeetingTimeDensity(true, 398, true)).toBe(MEETING_TIME_DENSITY_COMPACT)
        expect(getMeetingTimeDensity(true, 450, true)).toBe(MEETING_TIME_DENSITY_COMPACT)
    })

    it('after work: never the full form on mobile, and a little more room for the compact one (AT-3157)', () => {
        expect(getMeetingTimeDensity(false, 0, false, true)).toBe(MEETING_TIME_DENSITY_FULL)
        expect(getMeetingTimeDensity(true, 0, false, true)).toBe(MEETING_TIME_DENSITY_MINIMAL)
        expect(getMeetingTimeDensity(true, 568, false, true)).toBe(MEETING_TIME_DENSITY_COMPACT) // 600px
        expect(getMeetingTimeDensity(true, 358, false, true)).toBe(MEETING_TIME_DENSITY_COMPACT) // 390px
        expect(getMeetingTimeDensity(true, 350, false, true)).toBe(MEETING_TIME_DENSITY_MINIMAL)
        expect(getMeetingTimeDensity(true, 350, false, false)).toBe(MEETING_TIME_DENSITY_COMPACT)
        expect(getMeetingTimeDensity(true, 328, false, true)).toBe(MEETING_TIME_DENSITY_MINIMAL) // 360px
    })
})
