import {
    getCalendarConnectedProjectIds,
    getCalendarProviderUrl,
    getCalendarSectionTitle,
    isMicrosoftCalendar,
} from './calendarSectionHelper'
import { orderCalendarTasksLast } from '../../../utils/CalendarTaskOrder'

jest.mock('../../../i18n/TranslationService', () => ({
    translate: key => key,
}))

// AT-2377 - the section header used to hardcode the English literal "Google Calendar" even for a
// Microsoft account, and each of the two sections carried its own copy of the provider handling.
describe('calendar section header', () => {
    it('names the provider the events actually came from', () => {
        expect(getCalendarSectionTitle({ provider: 'microsoft' })).toBe('Outlook Calendar')
        expect(getCalendarSectionTitle({ provider: 'google' })).toBe('Google Calendar')
    })

    it('falls back to Google when the provider is missing', () => {
        expect(getCalendarSectionTitle(undefined)).toBe('Google Calendar')
        expect(getCalendarSectionTitle({})).toBe('Google Calendar')
        expect(isMicrosoftCalendar(undefined)).toBe(false)
    })

    it('links a Google calendar to the account the events belong to', () => {
        expect(getCalendarProviderUrl({ email: 'karsten@alldone.app' })).toBe(
            'https://calendar.google.com/calendar/r?authuser=karsten%40alldone.app'
        )
    })

    // AT-2437 - the whole bug. `/u/` is an account INDEX and must be followed by a number, so
    // `/calendar/u/?authuser=…` is not a route at all and a signed-in click got Google's 404. This
    // suite asserted that exact string before, which is how it shipped - so pin the shape of the
    // path, not just today's spelling.
    it('never builds a Google URL with an indexless account path', () => {
        const urls = [
            getCalendarProviderUrl({ email: 'karsten@alldone.app' }),
            getCalendarProviderUrl({ provider: 'google', email: 'karsten@alldone.app' }),
            getCalendarProviderUrl({}),
            getCalendarProviderUrl(undefined),
        ]

        urls.forEach(url => {
            expect(url).not.toContain('/calendar/u/?')
            expect(url).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/r(\?|$)/)
            // An `/u/N` in the path would outrank `authuser` and silently open the wrong account.
            expect(url).not.toMatch(/\/u\//)
        })
    })

    it('encodes the account so a plus-addressed calendar still resolves', () => {
        expect(getCalendarProviderUrl({ email: 'karsten+work@alldone.app' })).toBe(
            'https://calendar.google.com/calendar/r?authuser=karsten%2Bwork%40alldone.app'
        )
    })

    it('opens plain Google Calendar when the events carry no account', () => {
        expect(getCalendarProviderUrl({})).toBe('https://calendar.google.com/calendar/r')
        expect(getCalendarProviderUrl(undefined)).toBe('https://calendar.google.com/calendar/r')
        expect(getCalendarProviderUrl({ email: '' })).toBe('https://calendar.google.com/calendar/r')
    })

    // A header labelled "Outlook Calendar" used to open `calendarData.link` - the FIRST MEETING's
    // own event page, since `microsoftCalendarProvider` maps `htmlLink: event.webLink`. Both
    // providers now open the calendar itself.
    it('links a Microsoft calendar to Outlook, never to a single event', () => {
        expect(getCalendarProviderUrl({ provider: 'microsoft', link: 'https://outlook.office.com/x' })).toBe(
            'https://outlook.office.com/calendar/'
        )
        expect(getCalendarProviderUrl({ provider: 'microsoft' })).toBe('https://outlook.office.com/calendar/')
        expect(getCalendarProviderUrl({ provider: 'microsoft', email: 'karsten@alldone.app' })).toBe(
            'https://outlook.office.com/calendar/'
        )
    })
})

// The re-sync in the section header must hit the project holding the CALENDAR CONNECTION, which is
// not necessarily the project the task was routed into.
describe('resolving which projects a manual re-sync must hit', () => {
    const apisConnected = {
        'project-with-calendar': { calendar: true, calendarEmail: 'karsten@alldone.app' },
        'project-without-calendar': { calendar: false },
    }

    it('prefers the project the event was originally synced from', () => {
        const tasks = [{ calendarData: { originalProjectId: 'project-with-calendar' } }]

        expect(getCalendarConnectedProjectIds(tasks, apisConnected, 'project-routed-into')).toEqual([
            'project-with-calendar',
        ])
    })

    it('falls back to the project whose connected calendar address matches the event', () => {
        const tasks = [{ calendarData: { email: 'karsten@alldone.app' } }]

        expect(getCalendarConnectedProjectIds(tasks, apisConnected, 'project-routed-into')).toEqual([
            'project-with-calendar',
        ])
    })

    it('deduplicates projects across many events', () => {
        const tasks = [
            { calendarData: { originalProjectId: 'project-with-calendar' } },
            { calendarData: { email: 'karsten@alldone.app' } },
            { calendarData: { originalProjectId: 'project-with-calendar' } },
        ]

        expect(getCalendarConnectedProjectIds(tasks, apisConnected, null)).toEqual(['project-with-calendar'])
    })

    it('offers no re-sync target when nothing resolvable is actually connected', () => {
        const tasks = [{ calendarData: { email: 'someone-else@example.com' } }]

        expect(getCalendarConnectedProjectIds(tasks, apisConnected, 'project-without-calendar')).toEqual([])
        expect(getCalendarConnectedProjectIds([], apisConnected, 'project-without-calendar')).toEqual([])
    })

    it('ignores tasks that carry no calendar payload', () => {
        expect(getCalendarConnectedProjectIds([{}, { calendarData: null }], apisConnected, null)).toEqual([])
    })
})

// The section renders meetings in clock order. It leans on the AT-2351 rule rather than a local
// sort so this section, My Day and the focus-task pick cannot disagree about which meeting is next.
describe('ordering inside the calendar section', () => {
    const task = (id, start) => ({ id, calendarData: { start } })

    it('orders an all-purpose calendar list by event start, all-day first', () => {
        const allDay = task('all-day', { date: '2026-08-21' })
        const nineAm = task('09:00', { dateTime: '2026-08-21T09:00:00+02:00' })
        const noon = task('12:00', { dateTime: '2026-08-21T12:00:00+02:00' })

        const ordered = orderCalendarTasksLast([noon, nineAm, allDay])

        expect(ordered.map(item => item.id)).toEqual(['all-day', '09:00', '12:00'])
    })

    it('keeps a meeting with an unusable start at the end instead of dropping it', () => {
        const broken = task('broken', undefined)
        const nineAm = task('09:00', { dateTime: '2026-08-21T09:00:00+02:00' })

        expect(orderCalendarTasksLast([broken, nineAm]).map(item => item.id)).toEqual(['09:00', 'broken'])
    })
})
