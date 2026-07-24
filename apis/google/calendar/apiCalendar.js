import { client_id } from '../apisConfig'
import scriptLoader from '../../scriptLoader'
import ProfileInit from '../profileInit'

const scriptSrcGoogle = 'https://accounts.google.com/gsi/client'

const config = {
    client_id,
    scope: 'https://www.googleapis.com/auth/calendar.events',
}

class ApiCalendar {
    tokenClient = null
    calendar = 'primary'

    constructor(config) {
        this.config = config
        this.handleClientLoad()
    }

    handleClientLoad() {
        const self = this
        scriptLoader.loadScript(scriptSrcGoogle).then(() => {
            self.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: self.config.client_id,
                scope: self.config.scope,
            })
        })
    }

    requestConsent(callback) {
        if (ProfileInit.checkAccessGranted()) {
            callback()
        } else {
            this.tokenClient.callback = callback
            this.tokenClient.requestAccessToken({ prompt: 'consent' })
        }
    }

    checkAccessGranted() {
        return ProfileInit.checkAccessGranted()
    }

    createEvent(event, calendarId) {
        if (gapi) {
            return gapi.client.calendar.events.insert({
                calendarId: calendarId,
                resource: event,
                conferenceDataVersion: 1,
            })
        } else {
            console.log('Error: this.gapi not loaded')
            return false
        }
    }

    createEventFromNow(baseEvent) {
        const { time, conferenceData, reminders, summary, description } = baseEvent
        const calendarId = this.calendar
        const timeZone = 'UTC'

        const event = {
            summary,
            description: description ? description : '',
            conferenceData,
            reminders,
            start: {
                dateTime: new Date().toISOString(),
                timeZone: timeZone,
            },
            end: {
                dateTime: new Date(new Date().getTime() + time * 60000),
                timeZone: timeZone,
            },
        }

        return this.createEvent(event, calendarId)
    }

    deleteEvent(eventId) {
        if (gapi) {
            return gapi.client.calendar.events.delete({
                calendarId: this.calendar,
                eventId: eventId,
            })
        } else {
            console.log('Error: gapi is not loaded use onLoad before please.')
            return null
        }
    }

    listTodayEvents(maxResults) {
        const calendarId = this.calendar
        const date = new Date()
        const tomorrow = new Date()
        tomorrow.setDate(date.getDate() + 1)
        tomorrow.setHours(0)
        tomorrow.setMinutes(0)
        tomorrow.setSeconds(0)
        date.setHours(0)
        date.setMinutes(0)
        date.setSeconds(0)

        if (gapi) {
            return gapi.client.calendar.events.list({
                calendarId: calendarId,
                timeMin: date.toISOString(),
                timeMax: tomorrow.toISOString(),
                showDeleted: false,
                singleEvents: true,
                maxResults: maxResults,
                orderBy: 'startTime',
            })
        } else {
            console.log('Error: this.gapi not loaded')
            return false
        }
    }
}

let apiCalendar
try {
    apiCalendar = new ApiCalendar(config)
} catch (e) {
    console.log(e)
}
export default apiCalendar
