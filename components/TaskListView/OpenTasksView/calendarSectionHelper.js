import { translate } from '../../../i18n/TranslationService'

// AT-2377 - shared by the two "Calendar" task-list sections (the open-tasks board and the goal
// detailed view). Both used to carry their own copy of this provider handling, and both hardcoded
// the English literal "Google Calendar" even for a Microsoft account.

const MICROSOFT_PROVIDER = 'microsoft'
const DEFAULT_OUTLOOK_CALENDAR_URL = 'https://outlook.office.com/calendar/'
const GOOGLE_CALENDAR_URL = 'https://calendar.google.com/calendar/u/?'

export const isMicrosoftCalendar = calendarData => calendarData?.provider === MICROSOFT_PROVIDER

export const getCalendarSectionTitle = calendarData =>
    isMicrosoftCalendar(calendarData) ? translate('Outlook Calendar') : translate('Google Calendar')

export const getCalendarProviderUrl = calendarData =>
    isMicrosoftCalendar(calendarData)
        ? calendarData.link || DEFAULT_OUTLOOK_CALENDAR_URL
        : `${GOOGLE_CALENDAR_URL}authuser=${calendarData?.email || ''}`

/**
 * Which projects a manual re-sync has to hit for the meetings shown in this section.
 *
 * A calendar task can be routed into a project that is not the one holding the calendar
 * connection, so the sync target is resolved from the event itself: its `originalProjectId`
 * first, then the project whose connected calendar address matches the event's, and only then
 * the project we are rendering in.
 */
export const getCalendarConnectedProjectIds = (tasks, apisConnected, fallbackProjectId) => {
    const projectIds = new Set()

    tasks.forEach(task => {
        const { calendarData } = task || {}
        if (!calendarData) return

        if (calendarData.originalProjectId) {
            projectIds.add(calendarData.originalProjectId)
            return
        }

        const calendarEmail = calendarData.email
        if (!apisConnected || !calendarEmail) return

        const match = Object.entries(apisConnected).find(
            ([, apis]) => apis?.calendar && apis.calendarEmail === calendarEmail
        )
        if (match) projectIds.add(match[0])
    })

    if (projectIds.size === 0 && fallbackProjectId) projectIds.add(fallbackProjectId)

    return Array.from(projectIds).filter(projectId => apisConnected?.[projectId]?.calendar)
}
