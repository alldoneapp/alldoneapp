import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment-timezone'
import * as Localization from 'expo-localization'

import MeetingBookingPage from './MeetingBookingPage'
import { BOOKING_LANGUAGE_STORAGE_KEY } from './bookingLanguage'
import { setLanguage } from '../../i18n/TranslationService'
import {
    bookPublicMeeting,
    getPublicBookingPage,
    getPublicBookingSlots,
} from '../../utils/backends/Booking/bookingFirestore'

jest.mock('expo-localization', () => ({
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

        const firstDay = moment().tz('Europe/Berlin').startOf('day')
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
