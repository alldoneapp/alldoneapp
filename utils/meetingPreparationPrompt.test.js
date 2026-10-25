import { buildMeetingPreparationPrompt } from './meetingPreparationPrompt'
import { setLanguage, translate } from '../i18n/TranslationService'

const meeting = {
    id: 'event-instance-1',
    name: 'Review',
    description: 'Discuss the launch'.repeat(2000),
    userIds: ['assignee-is-not-an-attendee'],
    calendarData: {
        provider: 'microsoft',
        email: 'work@example.com',
        originalProjectId: 'calendar-source-project',
        recurringEventId: 'series-1',
        start: { dateTime: '2026-10-05T10:00:00+02:00', timeZone: 'Europe/Berlin' },
        end: { dateTime: '2026-10-05T11:00:00+02:00' },
        link: 'https://outlook.office.com/event/1',
        attendees: Array.from({ length: 2000 }, () => ({ displayName: 'Jane', email: 'jane@example.com' })),
    },
}
const build = task => buildMeetingPreparationPrompt({ projectId: 'project-1', task })
beforeEach(() => setLanguage('en'))

it('keeps the visible request short regardless of description and participant payload size', () => {
    const prompt = build(meeting)
    expect(prompt.length).toBeLessThan(650)
    expect(prompt).not.toMatch(/[{}]/)
    expect(prompt).not.toContain('JSON')
    expect(prompt).not.toContain('Discuss the launch')
    expect(prompt).not.toContain('jane@example.com')
    expect(prompt).not.toContain('assignee-is-not-an-attendee')
    expect(prompt).toContain('short briefing')
    expect(prompt).toContain('all participants on the web and in existing notes')
    expect(prompt).toContain('source links')
    expect(prompt).toContain('only this occurrence')
    expect(prompt).toContain('accessible calendars and notes')
    expect(prompt).toContain('without inventing details')
})

it('includes minimal occurrence, provider, account and routed-connection hints', () => {
    const prompt = build(meeting)
    for (const value of [
        'event-instance-1',
        'Outlook',
        'work@example.com',
        'calendar-source-project',
        '2026-10-05T10:00:00+02:00',
        '2026-10-05T11:00:00+02:00',
        'Europe/Berlin',
    ]) {
        expect(prompt).toContain(value)
    }
    expect(prompt).not.toContain('series-1')
    expect(prompt).not.toContain('https://outlook.office.com')
})

it('preserves all-day dates and uses the provider event ID when different from the task ID', () => {
    const prompt = build({
        id: 'task-2',
        calendarData: {
            eventId: 'provider-event-2',
            calendarId: 'calendar-2',
            originalProjectId: 'project-1',
            start: { date: '2026-10-06' },
            end: { date: '2026-10-07' },
        },
    })
    expect(prompt).toContain('Google Calendar')
    expect(prompt).toContain('provider-event-2')
    expect(prompt).toContain('calendar-2')
    expect(prompt).toContain('2026-10-06 – 2026-10-07')
    expect(prompt).not.toContain('Calendar connection:')
})

it('supports sparse events and rejects requests without a saved calendar-task destination', () => {
    expect(build({ id: 'sparse', calendarData: {} })).toContain('Google Calendar · sparse')
    expect(build({ id: 'task', calendarData: { id: 'calendar-event' } })).toContain('calendar-event')
    expect(build()).toBe('')
    expect(build({ id: 'ordinary' })).toBe('')
    expect(build({ calendarData: {} })).toBe('')
    expect(buildMeetingPreparationPrompt({ projectId: '', task: meeting })).toBe('')
})

it.each([
    ['de', 'Suche im Kalender', 'Meeting vorbereiten', 'Meetings vorbereiten'],
    ['es', 'Busca en el calendario', 'Preparar reunión', 'Preparar reuniones'],
    ['en', 'Search the calendar', 'Prepare meeting', 'Prepare meetings'],
])('localizes the compact prompt and singular/plural menu labels in %s', (language, beginning, single, plural) => {
    setLanguage(language)
    expect(translate('Prepare meeting')).toBe(single)
    expect(translate('Prepare meetings')).toBe(plural)
    const prompt = build(meeting)
    expect(prompt).toContain(beginning)
    expect(prompt).not.toMatch(/\[missing|%\{|JSON/)
    expect(prompt.length).toBeLessThan(700)
})
