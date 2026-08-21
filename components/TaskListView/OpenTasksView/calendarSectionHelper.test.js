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
            'https://calendar.google.com/calendar/u/?authuser=karsten@alldone.app'
        )
    })

    it('links a Microsoft calendar to the event link, or to Outlook when it has none', () => {
        expect(getCalendarProviderUrl({ provider: 'microsoft', link: 'https://outlook.office.com/x' })).toBe(
            'https://outlook.office.com/x'
        )
        expect(getCalendarProviderUrl({ provider: 'microsoft' })).toBe('https://outlook.office.com/calendar/')
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
