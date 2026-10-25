import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment-timezone'
import * as Localization from '../../utils/WebShims/Localization'

import MeetingBookingPage from './MeetingBookingPage'
import { BOOKING_LANGUAGE_STORAGE_KEY } from './bookingLanguage'
import { setLanguage } from '../../i18n/TranslationService'
import {
    bookPublicMeeting,
    getPublicBookingPage,
    getPublicBookingSlots,
} from '../../utils/backends/Booking/bookingFirestore'

jest.mock('../../utils/WebShims/Localization', () => ({
    locale: 'en',
}))

jest.mock('../UIControls/Button', () => {
    const React = require('react')
    const { Text, TouchableOpacity } = require('react-native')
    return props => (
        <TouchableOpacity testID={props.testID} onPress={props.onPress} disabled={props.disabled}>
            <Text>{props.processing ? props.processingTitle : props.title}</Text>
        </TouchableOpacity>
    )
})

jest.mock('../../utils/backends/Booking/bookingFirestore', () => ({
    bookPublicMeeting: jest.fn(),
    getPublicBookingPage: jest.fn(),
    getPublicBookingSlots: jest.fn(),
}))

const navigation = {
    getParam: key => (key === 'slug' ? 'karsten-wysk' : ''),
}

const page = {
    slug: 'karsten-wysk',
    profile: { displayName: 'Karsten Wysk', photoURL: '' },
    settings: {
        durationMinutes: 30,
        slotIntervalMinutes: 30,
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        includeWeekends: false,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        timeZone: 'Europe/Berlin',
    },
}

const flushPromises = () => new Promise(resolve => setImmediate(resolve))

describe('MeetingBookingPage', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        window.localStorage.clear()
        Localization.locale = 'en-US'
        setLanguage('en')
        getPublicBookingPage.mockResolvedValue({ success: true, page })
        getPublicBookingSlots.mockResolvedValue({ success: true, timeZone: 'Europe/Berlin', options: [] })
        bookPublicMeeting.mockResolvedValue({
            success: true,
            bookingId: 'booking-1',
            start: '2026-06-18T09:00:00+02:00',
            end: '2026-06-18T09:30:00+02:00',
        })
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('renders the loading state before the page request resolves', () => {
        const tree = renderer.create(<MeetingBookingPage navigation={navigation} />)

        expect(tree.root.findAllByProps({ testID: 'booking-loading-skeleton' }).length).toBeGreaterThan(0)
    })

    test('renders an empty slots state', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        expect(tree.root.findAllByProps({ children: 'No times are available on this day.' }).length).toBeGreaterThan(0)
    })

    test('uses a supported browser language on the first visit', async () => {
        Localization.locale = 'de-DE'
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        expect(tree.root.findAllByProps({ children: 'Termin mit Karsten Wysk buchen' }).length).toBeGreaterThan(0)
        expect(tree.root.findByProps({ testID: 'booking-language-de' }).props.accessibilityState.selected).toBe(true)
    })

    test('falls back to English for an unsupported browser language', async () => {
        Localization.locale = 'fr-FR'
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        expect(tree.root.findAllByProps({ children: 'Book a meeting with Karsten Wysk' }).length).toBeGreaterThan(0)
        expect(tree.root.findByProps({ testID: 'booking-language-en' }).props.accessibilityState.selected).toBe(true)
    })

    test('prefers a persisted choice over the browser language', async () => {
        Localization.locale = 'de-DE'
        window.localStorage.setItem(BOOKING_LANGUAGE_STORAGE_KEY, 'es')
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        expect(tree.root.findAllByProps({ children: 'Reservar una reunión con Karsten Wysk' }).length).toBeGreaterThan(
            0
        )
        expect(tree.root.findByProps({ testID: 'booking-language-es' }).props.accessibilityState.selected).toBe(true)
    })

    test('reactively switches copy and persists a manual choice', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'booking-language-de' }).props.onPress()
        })

        expect(tree.root.findAllByProps({ children: 'Termin mit Karsten Wysk buchen' }).length).toBeGreaterThan(0)
        expect(tree.root.findAllByProps({ children: 'Tag auswählen' }).length).toBeGreaterThan(0)
        expect(document.title).toBe('Karsten Wysk - Termin buchen')
        expect(window.localStorage.getItem(BOOKING_LANGUAGE_STORAGE_KEY)).toBe('de')
    })

    test('formats booking dates with the selected language', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        // Tomorrow, not today: this fixture page has no allowSameDayBooking, so the day
        // strip starts at the first bookable day (AT-2271).
        const firstDay = moment().tz('Europe/Berlin').add(1, 'days').startOf('day')
        const firstDayButton = tree.root.findByProps({ testID: `booking-day-${firstDay.format('YYYY-MM-DD')}` })

        await act(async () => {
            tree.root.findByProps({ testID: 'booking-language-es' }).props.onPress()
        })

        const dateLabels = firstDayButton.findAllByType(require('react-native').Text).map(node => node.props.children)
        expect(dateLabels).toContain(firstDay.clone().locale('es').format('ddd'))
        expect(dateLabels).toContain(firstDay.clone().locale('es').format('MMM'))
    })

    test('can request availability for a day 30 days in the future', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        const futureDay = moment().tz('Europe/Berlin').add(30, 'days').startOf('day')
        await act(async () => {
            tree.root.findByProps({ testID: `booking-day-${futureDay.format('YYYY-MM-DD')}` }).props.onPress()
            await flushPromises()
        })

        expect(getPublicBookingSlots).toHaveBeenLastCalledWith(
            expect.objectContaining({
                start: futureDay.clone().startOf('day').format(),
                end: futureDay.clone().endOf('day').format(),
            })
        )
    })

    test('hides excluded weekends and preselects the next visible weekday', async () => {
        const now = moment.tz('2026-08-14T12:00:00', 'Europe/Berlin') // Friday
        const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now.valueOf())
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        const saturday = now.clone().add(1, 'day').startOf('day')
        const sunday = now.clone().add(2, 'days').startOf('day')
        const monday = now.clone().add(3, 'days').startOf('day')
        expect(tree.root.findAllByProps({ testID: `booking-day-${saturday.format('YYYY-MM-DD')}` })).toHaveLength(0)
        expect(tree.root.findAllByProps({ testID: `booking-day-${sunday.format('YYYY-MM-DD')}` })).toHaveLength(0)
        expect(
            tree.root.findAllByProps({ testID: `booking-day-${monday.format('YYYY-MM-DD')}` }).length
        ).toBeGreaterThan(0)
        expect(getPublicBookingSlots).toHaveBeenLastCalledWith(
            expect.objectContaining({
                start: monday.format(),
                end: monday.clone().endOf('day').format(),
            })
        )

        dateNowSpy.mockRestore()
    })

    test('keeps weekend days visible and selectable when the host includes them', async () => {
        const now = moment.tz('2026-08-14T12:00:00', 'Europe/Berlin') // Friday
        const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now.valueOf())
        getPublicBookingPage.mockResolvedValue({
            success: true,
            page: { ...page, settings: { ...page.settings, includeWeekends: true } },
        })
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        const saturday = now.clone().add(1, 'day').startOf('day')
        expect(
            tree.root.findAllByProps({ testID: `booking-day-${saturday.format('YYYY-MM-DD')}` }).length
        ).toBeGreaterThan(0)
        expect(getPublicBookingSlots).toHaveBeenLastCalledWith(
            expect.objectContaining({
                start: saturday.format(),
                end: saturday.clone().endOf('day').format(),
            })
        )

        dateNowSpy.mockRestore()
    })

    describe('same-day booking (AT-2271)', () => {
        const dayTestId = day => `booking-day-${day.format('YYYY-MM-DD')}`
        const today = () => moment().tz('Europe/Berlin').startOf('day')
        const tomorrow = () => moment().tz('Europe/Berlin').add(1, 'days').startOf('day')
        const firstVisibleDay = () => {
            const day = tomorrow()
            while (day.day() === 0 || day.day() === 6) day.add(1, 'day')
            return day
        }

        const render = async () => {
            let tree
            await act(async () => {
                tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
                await flushPromises()
                await flushPromises()
            })
            return tree
        }

        test('does not offer today when the setting is absent (existing booking links)', async () => {
            const tree = await render()

            expect(tree.root.findAllByProps({ testID: dayTestId(today()) })).toHaveLength(0)
            expect(tree.root.findAllByProps({ testID: dayTestId(firstVisibleDay()) }).length).toBeGreaterThan(0)
        })

        test('does not offer today when the host explicitly disabled it', async () => {
            getPublicBookingPage.mockResolvedValue({
                success: true,
                page: { ...page, settings: { ...page.settings, allowSameDayBooking: false } },
            })
            const tree = await render()

            expect(tree.root.findAllByProps({ testID: dayTestId(today()) })).toHaveLength(0)
        })

        test('preselects the first visible day, so the first availability request skips today and weekends', async () => {
            await render()
            const initialDay = firstVisibleDay()

            expect(getPublicBookingSlots).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    start: initialDay.format(),
                    end: initialDay.clone().endOf('day').format(),
                })
            )
        })

        test('offers today and preselects it when the host allows same-day booking', async () => {
            getPublicBookingPage.mockResolvedValue({
                success: true,
                page: {
                    ...page,
                    settings: { ...page.settings, allowSameDayBooking: true, includeWeekends: true },
                },
            })
            const tree = await render()

            expect(tree.root.findAllByProps({ testID: dayTestId(today()) }).length).toBeGreaterThan(0)
            // Today starts from "now" rather than midnight so past slots aren't offered.
            expect(getPublicBookingSlots).toHaveBeenLastCalledWith(
                expect.objectContaining({ end: today().clone().endOf('day').format() })
            )
        })

        test('keeps the full calendar-month horizon when today and weekends are excluded', async () => {
            const tree = await render()
            const firstDay = tomorrow()
            const lastDay = moment().tz('Europe/Berlin').add(31, 'days').startOf('day')

            for (const day of [firstDay, lastDay]) {
                const matchingDays = tree.root.findAllByProps({ testID: dayTestId(day) })
                if (day.day() === 0 || day.day() === 6) expect(matchingDays).toHaveLength(0)
                else expect(matchingDays.length).toBeGreaterThan(0)
            }

            const beyondHorizon = lastDay.clone().add(1, 'day')
            expect(tree.root.findAllByProps({ testID: dayTestId(beyondHorizon) })).toHaveLength(0)
        })
    })

    test('books a selected slot after visitor details are entered', async () => {
        const slot = { start: '2026-06-18T09:00:00+02:00', end: '2026-06-18T09:30:00+02:00' }
        getPublicBookingSlots.mockResolvedValue({ success: true, timeZone: 'Europe/Berlin', options: [slot] })
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        await act(async () => {
            tree.root.findByProps({ testID: `booking-slot-${slot.start}` }).props.onPress()
            tree.root.findByProps({ testID: 'booking-name-input' }).props.onChangeText('Visitor')
            tree.root.findByProps({ testID: 'booking-email-input' }).props.onChangeText('visitor@example.com')
            await flushPromises()
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'booking-confirm-button' }).props.onPress()
            await flushPromises()
        })

        expect(bookPublicMeeting).toHaveBeenCalledWith(
            expect.objectContaining({
                slug: 'karsten-wysk',
                start: slot.start,
                end: slot.end,
                timeZone: 'Europe/Berlin',
                visitorName: 'Visitor',
                visitorEmail: 'visitor@example.com',
            })
        )
        expect(tree.root.findAllByProps({ children: 'Meeting booked' }).length).toBeGreaterThan(0)
    })

    test('shows slot times in the visitor timezone while querying in the host timezone', async () => {
        const guessSpy = jest.spyOn(moment.tz, 'guess').mockReturnValue('America/New_York')
        const slot = { start: '2026-06-18T09:00:00+02:00', end: '2026-06-18T09:30:00+02:00' }
        getPublicBookingSlots.mockResolvedValue({ success: true, timeZone: 'Europe/Berlin', options: [slot] })
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        // 09:00 in Berlin is 03:00 in New York (the visitor's zone).
        expect(tree.root.findAllByProps({ children: '03:00' }).length).toBeGreaterThan(0)
        // Availability is still requested in the host's timezone so working hours are correct.
        expect(getPublicBookingSlots).toHaveBeenCalledWith(expect.objectContaining({ timeZone: 'Europe/Berlin' }))
        // A timezone selector is offered.
        expect(tree.root.findAllByProps({ testID: 'booking-timezone-select' }).length).toBeGreaterThan(0)

        guessSpy.mockRestore()
    })

    test('lets the visitor pick any timezone for the displayed times', async () => {
        const guessSpy = jest.spyOn(moment.tz, 'guess').mockReturnValue('America/New_York')
        const slot = { start: '2026-06-18T09:00:00+02:00', end: '2026-06-18T09:30:00+02:00' }
        getPublicBookingSlots.mockResolvedValue({ success: true, timeZone: 'Europe/Berlin', options: [slot] })
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'booking-timezone-select' }).props.onPress()
            await flushPromises()
        })
        await act(async () => {
            tree.root.findByProps({ testID: 'booking-timezone-search' }).props.onChangeText('Tokyo')
            await flushPromises()
        })
        await act(async () => {
            tree.root.findByProps({ testID: 'booking-timezone-option-Asia/Tokyo' }).props.onPress()
            await flushPromises()
        })

        // 09:00 in Berlin is 16:00 in Tokyo.
        expect(tree.root.findAllByProps({ children: '16:00' }).length).toBeGreaterThan(0)
        // Picking a display timezone does not change the host timezone used for availability.
        expect(getPublicBookingSlots).toHaveBeenCalledWith(expect.objectContaining({ timeZone: 'Europe/Berlin' }))

        guessSpy.mockRestore()
    })
})
