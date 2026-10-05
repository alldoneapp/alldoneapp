import { buildMeetingPreparationPrompt } from './meetingPreparationPrompt'
import { setLanguage, translate } from '../i18n/TranslationService'

const meeting = {
    id: 'event-instance-1',
    name: 'Review',
    description: 'Discuss the launch',
    userIds: ['assignee-is-not-an-attendee'],
    calendarData: {
        provider: 'microsoft',
        email: 'work@example.com',
        originalProjectId: 'calendar-source-project',
        recurringEventId: 'series-1',
        start: { dateTime: '2026-10-05T10:00:00+02:00', timeZone: 'Europe/Berlin' },
        end: { dateTime: '2026-10-05T11:00:00+02:00' },
        link: 'https://outlook.office.com/event/1',
        attendees: [{ displayName: 'Jane', email: 'jane@example.com' }],
    },
}
const build = (tasks, specificTask = false) =>
    buildMeetingPreparationPrompt({ projectId: 'project-1', projectName: 'Product', tasks, specificTask })
const context = prompt => JSON.parse(prompt.slice(prompt.indexOf('{')))

beforeEach(() => setLanguage('en'))

it('identifies an exact event occurrence with its task ID, account, source and times', () => {
    const prompt = build([meeting], true)
    expect(prompt).toContain('this specific calendar task')
    expect(prompt).toContain('Research all participants both on the web and by searching existing notes')
    expect(context(prompt)).toMatchObject({
        projectId: 'project-1',
        projectName: 'Product',
        meetingCount: 1,
        meetings: [
            {
                taskId: meeting.id,
                eventId: meeting.id,
                recurringEventId: 'series-1',
                provider: 'microsoft',
                accountEmail: 'work@example.com',
                sourceProjectId: 'calendar-source-project',
                start: meeting.calendarData.start,
                description: meeting.description,
                participants: meeting.calendarData.attendees,
            },
        ],
    })
    expect(prompt).not.toContain('assignee-is-not-an-attendee')
})

it('limits a section request to its supplied calendar tasks without duplicating tasks or widening to a series', () => {
    const second = {
        ...meeting,
        id: 'event-2',
        calendarData: {
            eventId: 'provider-event-2',
            calendarId: 'calendar-2',
            start: { date: '2026-10-06' },
            end: { date: '2026-10-07' },
        },
    }
    const prompt = build([meeting, second, meeting, { id: 'ordinary-task' }])
    expect(context(prompt).meetingCount).toBe(2)
    expect(context(prompt).meetings[1]).toMatchObject({
        eventId: 'provider-event-2',
        calendarId: 'calendar-2',
        start: { date: '2026-10-06' },
        end: { date: '2026-10-07' },
    })
    expect(prompt).toContain('currently displayed for this project')
    expect(prompt).toContain('do not assume access to all calendars')
    expect(prompt).toContain('or recurring occurrences')
    expect(prompt).toContain('explain the limitation')
})

it('handles sparse events without inventing details', () => {
    expect(context(build([{ id: 'sparse', calendarData: {} }])).meetings).toEqual([
        { projectId: 'project-1', taskId: 'sparse', eventId: 'sparse', provider: 'google' },
    ])
    expect(build([])).toBe('')
    expect(build([{ id: 'not-calendar' }])).toBe('')
})

it.each([
    ['de', 'Suche im Kalender', 'Meetings vorbereiten'],
    ['es', 'Busca en el calendario', 'Preparar reuniones'],
    ['en', 'Search the calendar', 'Prepare meetings'],
])('localizes the prompt and menu label in %s', (language, beginning, label) => {
    setLanguage(language)
    expect(translate('Prepare meetings')).toBe(label)
    expect(build([meeting], true)).toContain(beginning)
    expect(build([meeting], true)).not.toContain('[missing')
})
