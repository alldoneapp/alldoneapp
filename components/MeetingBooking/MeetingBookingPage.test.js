import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment-timezone'
import * as Localization from '../../utils/WebShims/Localization'

import MeetingBookingPage, { BookingAgentHint, BookingHumanHint } from './MeetingBookingPage'
import { BOOKING_LANGUAGE_STORAGE_KEY } from './bookingLanguage'
import { setLanguage, translate } from '../../i18n/TranslationService'
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

describe('MeetingBookingPage agent API (AT-3161)', () => {
    beforeEach(() => {
        jest.spyOn(console, 'info').mockImplementation(() => {})
        delete window.alldone
        getPublicBookingPage.mockReturnValue(new Promise(() => {}))
    })

    afterEach(() => {
        delete window.alldone
        jest.restoreAllMocks()
    })

    test("offers the page's booking tools to agents, without sign-in, and removes them on unmount", async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
        })

        expect(window.alldone.state).toBe('public_booking')
        expect(window.alldone.docs).toBe('/meet/karsten-wysk/llms.txt')

        await act(async () => tree.unmount())
        expect('alldone' in window).toBe(false)
    })

    test("leaves a signed-in user's own tools alone when the page opens inside the app", async () => {
        const ownApi = { state: 'ready' }
        Object.defineProperty(window, 'alldone', { value: ownApi, configurable: true, enumerable: true })

        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
        })

        expect(window.alldone).toBe(ownApi)
        await act(async () => tree.unmount())
        expect(window.alldone).toBe(ownApi)
    })
})

describe('MeetingBookingPage agent info box (AT-3161)', () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    let writeText

    const setClipboard = value =>
        Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true })

    const renderPage = async (nav = navigation) => {
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={nav} />)
            await flushPromises()
            await flushPromises()
        })
        return tree
    }

    const infoBox = tree => tree.root.findByProps({ testID: 'booking-agent-hint' })
    const promptNode = tree => tree.root.findByProps({ testID: 'booking-agent-prompt' })
    const promptText = tree => promptNode(tree).props.children
    const copyButton = tree => tree.root.findByProps({ testID: 'booking-agent-prompt-copy' })
    const copyStatus = tree => tree.root.findByProps({ testID: 'booking-agent-prompt-copy-status' }).props.children
    // Everything inside the box that reacts to a press: only the copy button may.
    const pressables = tree => infoBox(tree).findAll(node => typeof node.props.onPress === 'function')

    beforeEach(() => {
        jest.clearAllMocks()
        jest.spyOn(console, 'info').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        window.localStorage.clear()
        Localization.locale = 'en-US'
        setLanguage('en')
        getPublicBookingPage.mockResolvedValue({ success: true, page })
        getPublicBookingSlots.mockResolvedValue({ success: true, timeZone: 'Europe/Berlin', options: [] })
        writeText = jest.fn(() => Promise.resolve())
        setClipboard({ writeText })
        document.execCommand = jest.fn(() => false)
    })

    afterEach(() => {
        jest.useRealTimers()
        if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
        else delete navigator.clipboard
        delete document.execCommand
        delete window.alldone
        jest.restoreAllMocks()
    })

    test('is an always visible, neutrally labelled note whose only action is "Copy prompt"', async () => {
        const tree = await renderPage()

        const box = infoBox(tree)
        expect(box.props.role).toBe('note')
        const title = tree.root.findByProps({ testID: 'booking-agent-info-title' })
        expect(title.props.children).toBe('For AI agents')
        expect(box.props['aria-labelledby']).toBe(title.props.nativeID)
        // Visible without any interaction: no expander, no chevron, no "book" wording in the label.
        expect(tree.root.findAllByProps({ testID: 'booking-agent-hint-toggle' })).toHaveLength(0)
        expect(tree.root.findAllByProps({ testID: 'booking-agent-hint-panel' })).toHaveLength(0)
        expect(box.findAll(node => node.props['aria-expanded'] !== undefined)).toHaveLength(0)
        expect(box.findAll(node => ['▸', '▾'].includes(node.props.children))).toHaveLength(0)
        expect(title.props.children).not.toMatch(/book/i)
        expect(promptText(tree)).toContain('/meet/karsten-wysk')

        const actions = pressables(tree).filter(node => node.props.testID)
        expect([...new Set(actions.map(node => node.props.testID))]).toEqual(['booking-agent-prompt-copy'])
        expect(copyButton(tree).props.title).toBe('Copy prompt')
        expect(copyButton(tree).props.role).toBe('button')
        // A quiet secondary button: it copies text, it is not the booking call to action.
        expect(copyButton(tree).props.type).toBe('secondary')

        // Says who can use it, without advertising browser clicks or promising every chatbot works.
        const description = tree.root.findByProps({ children: translate('Booking agent info description') }).props
            .children
        expect(description).toContain('connected to Alldone')
        expect(description).not.toMatch(/chatbot/i)
        expect(description).not.toMatch(/browser/i)
    })

    test('a "For humans" note sits right under it and says the page itself books, with no action', async () => {
        const tree = await renderPage()

        const agentHint = tree.root.findByType(BookingAgentHint)
        const siblings = agentHint.parent.children
        // Compare types, not instances: a failing instance comparison makes Jest print the whole tree.
        expect(siblings[siblings.indexOf(agentHint) + 1]?.type).toBe(BookingHumanHint)

        const note = tree.root.findByProps({ testID: 'booking-human-hint' })
        expect(note.props.role).toBe('note')
        const title = tree.root.findByProps({ testID: 'booking-human-info-title' })
        expect(title.props.children).toBe('For humans')
        expect(note.props['aria-labelledby']).toBe(title.props.nativeID)
        expect(tree.root.findByProps({ testID: 'booking-human-info-description' }).props.children).toBe(
            'You can also pick and book your meeting right here on this page.'
        )
        expect(note.findAll(node => typeof node.props.onPress === 'function')).toHaveLength(0)
    })

    test('the prompt sends the agent to the booking tools, not the browser, and asks before booking', async () => {
        const tree = await renderPage()

        const prompt = promptText(tree)
        expect(prompt).toContain(`${window.location.origin}/meet/karsten-wysk`)
        expect(window.location.origin).not.toContain('my.alldone.app')
        expect(prompt).not.toContain('my.alldone.app')
        expect(prompt).toContain('get_public_booking_page, find_public_booking_times and book_public_meeting')
        expect(prompt).toContain('not the browser')
        expect(prompt).toContain('Propose one slot with date, time and time zone')
        expect(prompt).toContain('book only after I confirm that slot')
        expect(prompt).toContain('tell me to connect Alldone or refresh its tools')
        expect(prompt).toMatch(new RegExp(`MCP server: ${window.location.origin}/api/booking/mcp/karsten-wysk$`))
        expect(promptNode(tree).props.selectable).toBe(true)
    })

    test("uses the host's canonical slug, not the address as typed", async () => {
        const typedNavigation = { getParam: key => (key === 'slug' ? 'Karsten-Wysk' : '') }
        const tree = await renderPage(typedNavigation)

        expect(promptText(tree)).toContain(`${window.location.origin}/meet/karsten-wysk\n`)
        expect(promptText(tree)).toContain(`${window.location.origin}/api/booking/mcp/karsten-wysk`)
    })

    test('follows the page language (DE and ES)', async () => {
        Localization.locale = 'de-DE'
        let tree = await renderPage()

        expect(tree.root.findByProps({ testID: 'booking-agent-info-title' }).props.children).toBe('Für KI-Agenten')
        expect(promptText(tree)).toContain(`Buche einen Termin: ${window.location.origin}/meet/karsten-wysk\n`)
        expect(promptText(tree)).toContain('buche erst, wenn ich genau diesen bestätige')
        expect(promptText(tree)).toContain('nicht den Browser')
        expect(copyButton(tree).props.title).toBe('Prompt kopieren')
        expect(tree.root.findByProps({ testID: 'booking-human-info-title' }).props.children).toBe('Für Menschen')
        expect(tree.root.findByProps({ testID: 'booking-human-info-description' }).props.children).toBe(
            'Du kannst deinen Termin auch direkt hier auf der Webseite auswählen und buchen.'
        )
        await act(async () => tree.unmount())

        Localization.locale = 'es-ES'
        window.localStorage.clear()
        tree = await renderPage()
        expect(tree.root.findByProps({ testID: 'booking-agent-info-title' }).props.children).toBe('Para agentes de IA')
        expect(promptText(tree)).toContain(`Reserva una cita: ${window.location.origin}/meet/karsten-wysk\n`)
        expect(promptText(tree)).toContain('no el navegador')
        expect(copyButton(tree).props.title).toBe('Copiar prompt')
        expect(tree.root.findByProps({ testID: 'booking-human-info-title' }).props.children).toBe('Para personas')
        expect(tree.root.findByProps({ testID: 'booking-human-info-description' }).props.children).toBe(
            'También puedes elegir y reservar tu cita directamente aquí, en esta página.'
        )
    })

    test('switching the language on the page switches the box', async () => {
        const tree = await renderPage()
        await act(async () => {
            tree.root.findByProps({ testID: 'booking-language-de' }).props.onPress()
        })
        expect(tree.root.findByProps({ testID: 'booking-agent-info-title' }).props.children).toBe('Für KI-Agenten')
        expect(copyButton(tree).props.title).toBe('Prompt kopieren')
        expect(tree.root.findByProps({ testID: 'booking-human-info-title' }).props.children).toBe('Für Menschen')
    })

    test('copies the whole prompt and shows "Copied" for a moment', async () => {
        const tree = await renderPage()
        jest.useFakeTimers()

        // The box shows a short preview; the copy carries the full text.
        expect(promptNode(tree).props.numberOfLines).toBe(3)
        await act(async () => {
            await copyButton(tree).props.onPress()
        })

        expect(writeText).toHaveBeenCalledWith(promptText(tree))
        expect(writeText.mock.calls[0][0]).toContain('/api/booking/mcp/karsten-wysk')
        expect(copyButton(tree).props.title).toBe('Copied')
        expect(copyButton(tree).props.icon).toBe('check')
        expect(copyStatus(tree)).toBe('Prompt copied')
        expect(tree.root.findByProps({ testID: 'booking-agent-prompt-copy-status' }).props['aria-live']).toBe('polite')

        act(() => {
            jest.advanceTimersByTime(2000)
        })
        expect(copyButton(tree).props.title).toBe('Copy prompt')
        expect(copyStatus(tree)).toBe('')
    })

    test('falls back to the old copy command where the Clipboard API is missing', async () => {
        setClipboard(undefined)
        document.execCommand = jest.fn(() => true)
        const tree = await renderPage()

        await act(async () => {
            await copyButton(tree).props.onPress()
        })

        expect(document.execCommand).toHaveBeenCalledWith('copy')
        expect(copyButton(tree).props.title).toBe('Copied')
    })

    test('says so when copying fails and then shows the whole prompt for copying by hand', async () => {
        writeText.mockImplementation(() => Promise.reject(new Error('NotAllowedError')))
        const tree = await renderPage()

        await act(async () => {
            await copyButton(tree).props.onPress()
        })

        expect(document.execCommand).toHaveBeenCalledWith('copy')
        expect(copyButton(tree).props.title).toBe('Copy prompt')
        expect(copyStatus(tree)).toBe('Could not copy. Select the text above and copy it manually.')
        expect(promptNode(tree).props.numberOfLines).toBeUndefined()
    })

    test('the booking flow still renders below it', async () => {
        const tree = await renderPage()

        expect(tree.root.findAllByProps({ testID: 'booking-timezone-select' }).length).toBeGreaterThan(0)
        expect(tree.root.findAllByProps({ testID: 'booking-confirm-button' }).length).toBeGreaterThan(0)
        expect(window.alldone.state).toBe('public_booking')
    })

    test('is not shown on an unavailable page', async () => {
        getPublicBookingPage.mockRejectedValue(new Error('Booking page not found'))
        const tree = await renderPage()

        expect(tree.root.findAllByProps({ testID: 'booking-agent-hint' })).toHaveLength(0)
        expect(tree.root.findAllByProps({ testID: 'booking-human-hint' })).toHaveLength(0)
    })
})
