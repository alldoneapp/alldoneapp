import { translate } from '../../../i18n/TranslationService'

// AT-2377 - shared by the two "Calendar" task-list sections (the open-tasks board and the goal
// detailed view). Both used to carry their own copy of this provider handling, and both hardcoded
// the English literal "Google Calendar" even for a Microsoft account.

const MICROSOFT_PROVIDER = 'microsoft'
const OUTLOOK_CALENDAR_URL = 'https://outlook.office.com/calendar/'
const GOOGLE_CALENDAR_URL = 'https://calendar.google.com/calendar/r'

export const isMicrosoftCalendar = calendarData => calendarData?.provider === MICROSOFT_PROVIDER

export const getCalendarSectionTitle = calendarData =>
    isMicrosoftCalendar(calendarData) ? translate('Outlook Calendar') : translate('Google Calendar')

/**
 * Where the section header sends you: the CALENDAR of the account these meetings came from.
 *
 * AT-2437 - `https://calendar.google.com/calendar/u/?authuser=<email>` 404s. The `/u/` segment of a
 * Google URL is an ACCOUNT INDEX and must be followed by a number (`/u/0/r`); an empty one is not a
 * route, so a signed-in click lands on Google's generic "The requested URL /calendar/u/ was not
 * found on this server". Signed OUT it silently redirects to the marketing page, which is why the
 * link looks fine to anything that probes it without a session and why this shipped unnoticed.
 *
 * `/calendar/r` is the canonical entry point and carries no index, so `authuser` is left to decide
 * which account to open and Google redirects to that account's own `/u/N/r`. Pinning `/u/0/`
 * ourselves would be the opposite trap: the path index outranks `authuser`, so a user whose work
 * calendar is account 1 would be dropped into account 0's calendar - a wrong calendar rather than a
 * 404, which is worse because nothing tells you it happened.
 *
 * The email is a query VALUE, so it has to be encoded: a `+` in an address (`karsten+work@…`) is
 * otherwise decoded as a space and the account is not found.
 *
 * The Microsoft branch used to open `calendarData.link`, which is the first meeting's own event
 * page (`microsoftCalendarProvider` maps `htmlLink: event.webLink`) - a header labelled "Outlook
 * Calendar" opening one meeting. Both providers now open the calendar itself. Outlook has no
 * account-selection parameter we rely on anywhere else; `getEmailAccountWebUrl` in
 * `emailLineHelper.js` is the same plain constant for the mail side.
 */
export const getCalendarProviderUrl = calendarData => {
    if (isMicrosoftCalendar(calendarData)) return OUTLOOK_CALENDAR_URL

    const email = calendarData?.email
    return email ? `${GOOGLE_CALENDAR_URL}?authuser=${encodeURIComponent(email)}` : GOOGLE_CALENDAR_URL
}

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
