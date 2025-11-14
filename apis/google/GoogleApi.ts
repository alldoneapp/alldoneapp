import { apiKey, client_id, discoveryDocs, gmailScope, scope } from './apisConfig'
import { deleteCacheAndRefresh } from '../../utils/Observers'
import scriptLoader from '../scriptLoader'

const scriptSrcGoogle = 'https://accounts.google.com/gsi/client'

class GoogleApi {
    sign: boolean = false
    gapi: any = null
    tokenClient: any = null
    gmailTokenClient: any = null
    onLoadCallback: any = null
    calendar: string = 'primary'
    userProfile: any = null
    authCallback: any = null
    gmailAuthCallback: any = null

    constructor() {
        try {
            this.updateSigninStatus = this.updateSigninStatus.bind(this)
            this.initClient = this.initClient.bind(this)
            this.handleSignOutClick = this.handleSignOutClick.bind(this)
            this.handleAuthClick = this.handleAuthClick.bind(this)
            this.handleGmailAuthClick = this.handleGmailAuthClick.bind(this)
            this.checkAccessGranted = this.checkAccessGranted.bind(this)
            this.checkGmailAccessGranted = this.checkGmailAccessGranted.bind(this)
            this.createEvent = this.createEvent.bind(this)
            this.listUpcomingEvents = this.listUpcomingEvents.bind(this)
            this.listEvents = this.listEvents.bind(this)
            this.listGmail = this.listGmail.bind(this)
            this.createEventFromNow = this.createEventFromNow.bind(this)
            this.listenSign = this.listenSign.bind(this)
            this.onLoad = this.onLoad.bind(this)
            this.setCalendar = this.setCalendar.bind(this)
            this.updateEvent = this.updateEvent.bind(this)
            this.deleteEvent = this.deleteEvent.bind(this)
            this.getEvent = this.getEvent.bind(this)
            this.getBasicUserProfile = this.getBasicUserProfile.bind(this)
            this.fetchUserProfile = this.fetchUserProfile.bind(this)

            // Defer loading to avoid blocking app initialization
            setTimeout(() => {
                this.handleClientLoad()
            }, 2000)
        } catch (e) {
            console.log(e)
        }
    }

    /**
     * Update connection status.
     * @param {boolean} isSignedIn
     */
    private updateSigninStatus(isSignedIn: boolean): void {
        this.sign = isSignedIn
    }

    /**
     * Check if user has granted calendar scope
     */
    public checkAccessGranted(): boolean {
        if (!this.gapi?.client) return false
        const token = this.gapi.client.getToken()
        if (!token) return false

        // Check if the token has the required scope
        return token.scope && token.scope.includes(scope)
    }

    /**
     * Check if user has granted Gmail scope
     */
    public checkGmailAccessGranted(): boolean {
        if (!this.gapi?.client) return false
        const token = this.gapi.client.getToken()
        if (!token) return false

        // Check if the token has the required scope
        return token.scope && token.scope.includes(gmailScope)
    }

    /**
     * Initialize gapi client without auth2
     */
    private initClient(): void {
        this.gapi = window['gapi']
        this.gapi.client
            .init({
                apiKey: apiKey,
                discoveryDocs: discoveryDocs,
            })
            .then(() => {
                // Initialize token clients for different scopes
                if (window['google']?.accounts?.oauth2) {
                    this.tokenClient = window['google'].accounts.oauth2.initTokenClient({
                        client_id: client_id,
                        scope: scope,
                        callback: (response: any) => {
                            if (response.error) {
                                console.error('Calendar auth error:', response.error)
                                return
                            }
                            this.updateSigninStatus(true)
                            this.fetchUserProfile()
                            if (this.authCallback) {
                                this.authCallback()
                                this.authCallback = null
                            }
                        },
                    })

                    this.gmailTokenClient = window['google'].accounts.oauth2.initTokenClient({
                        client_id: client_id,
                        scope: gmailScope,
                        callback: (response: any) => {
                            if (response.error) {
                                console.error('Gmail auth error:', response.error)
                                return
                            }
                            this.updateSigninStatus(true)
                            this.fetchUserProfile()
                            if (this.gmailAuthCallback) {
                                this.gmailAuthCallback()
                                this.gmailAuthCallback = null
                            }
                        },
                    })
                }

                if (this.onLoadCallback) {
                    this.onLoadCallback()
                }
            })
            .catch((e: any) => {
                console.log(e)
            })
    }

    /**
     * Initialize Google API client and GIS
     */
    private handleClientLoad(): void {
        this.gapi = window['gapi']

        // Check if gapi is already loaded
        if (window['gapi']) {
            window['gapi'].load('client', () => {
                // Load GIS client
                scriptLoader
                    .loadScript(scriptSrcGoogle)
                    .then(() => {
                        this.initClient()
                    })
                    .catch(error => {
                        console.error('Error loading GIS client:', error)
                    })
            })
            return
        }

        // Use scriptLoader for better error handling
        scriptLoader
            .loadScript('https://apis.google.com/js/api.js')
            .then(() => {
                if (window['gapi']) {
                    window['gapi'].load('client', () => {
                        // Load GIS client
                        scriptLoader
                            .loadScript(scriptSrcGoogle)
                            .then(() => {
                                this.initClient()
                            })
                            .catch(error => {
                                console.error('Error loading GIS client:', error)
                            })
                    })
                }
            })
            .catch(error => {
                console.error('Error loading Google API script:', error)
                console.error('Google Calendar and Gmail integrations will not be available')
            })
    }

    /**
     * Fetch user profile information from Google OAuth2 API
     */
    private async fetchUserProfile(): Promise<void> {
        try {
            const token = this.gapi?.client?.getToken()
            if (!token?.access_token) return

            const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: {
                    Authorization: `Bearer ${token.access_token}`,
                },
            })

            if (response.ok) {
                this.userProfile = await response.json()
            }
        } catch (error) {
            console.error('Error fetching user profile:', error)
        }
    }

    /**
     * Sign in Google user account for calendar access
     */
    public async handleAuthClick(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.tokenClient) {
                console.log('Error: Token client not loaded')
                deleteCacheAndRefresh()
                reject('Token client not loaded')
                return
            }

            this.authCallback = resolve

            // Check if already has access
            if (this.checkAccessGranted()) {
                this.fetchUserProfile().then(() => resolve())
            } else {
                // Request access with consent prompt
                this.tokenClient.requestAccessToken({ prompt: 'consent' })
            }
        })
    }

    /**
     * Sign in Google user account for Gmail access
     */
    public async handleGmailAuthClick(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.gmailTokenClient) {
                console.log('Error: Gmail token client not loaded')
                deleteCacheAndRefresh()
                reject('Gmail token client not loaded')
                return
            }

            this.gmailAuthCallback = resolve

            // Check if already has access
            if (this.checkGmailAccessGranted()) {
                this.fetchUserProfile().then(() => resolve())
            } else {
                // Request access with consent prompt
                this.gmailTokenClient.requestAccessToken({ prompt: 'consent' })
            }
        })
    }

    /**
     * Set the default calendar
     * @param {string} newCalendar
     */
    public setCalendar(newCalendar: string): void {
        this.calendar = newCalendar
    }

    /**
     * Execute the callback function when sign status changes
     * Note: With GIS, we need to manually track state
     * @param callback
     */
    public listenSign(callback: any): void {
        // Store callback for manual invocation after auth changes
        // This is a compatibility shim for the old gapi.auth2.isSignedIn.listen
        console.warn('listenSign: Manual state tracking required with GIS')
        // You may need to call callback manually after successful auth
    }

    /**
     * Execute the callback function when gapi is loaded
     * @param callback
     */
    public onLoad(callback: any): void {
        if (this.gapi) {
            callback()
        } else {
            this.onLoadCallback = callback
        }
    }

    /**
     * Sign out user google account
     */
    public handleSignOutClick(): void {
        const token = this.gapi?.client?.getToken()
        if (token) {
            window['google'].accounts.oauth2.revoke(token.access_token, () => {
                console.log('User signed out.')
                this.gapi.client.setToken(null)
                this.userProfile = null
                this.updateSigninStatus(false)
            })
        } else {
            console.log('No token to revoke')
        }
    }

    /**
     * List all events in the calendar
     * @param {number} maxResults to see
     * @param {string} calendarId to see by default use the calendar attribute
     * @returns {any}
     */
    public listUpcomingEvents(maxResults: number, calendarId: string = this.calendar): any {
        if (this.gapi) {
            return this.gapi.client.calendar.events.list({
                calendarId: calendarId,
                timeMin: new Date().toISOString(),
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

    /**
     * List only today events in the calendar
     * @param {number} maxResults to see
     * @param {string} calendarId to see by default use the calendar attribute
     * @returns {any}
     */
    public listTodayEvents(maxResults: number, calendarId: string = this.calendar): any {
        const date = new Date()
        const tomorrow = new Date()
        tomorrow.setDate(date.getDate() + 1)
        tomorrow.setHours(0)
        tomorrow.setMinutes(0)
        tomorrow.setSeconds(0)
        date.setHours(0)
        date.setMinutes(0)
        date.setSeconds(0)

        if (this.gapi?.client?.calendar?.events) {
            return this.gapi.client.calendar.events.list({
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

    /**
     * List all events in the calendar queried by custom query options
     * See all available options here https://developers.google.com/calendar/v3/reference/events/list
     * @param {object} queryOptions to see
     * @param {string} calendarId to see by default use the calendar attribute
     * @returns {any}
     */
    public listEvents(queryOptions: object, calendarId: string = this.calendar): any {
        if (this.gapi) {
            return this.gapi.client.calendar.events.list({
                calendarId,
                ...queryOptions,
            })
        } else {
            console.log('Error: this.gapi not loaded')
            return false
        }
    }

    public async listGmail(): Promise<object> {
        if (this.gapi) {
            try {
                const res = await this.gapi.client.gmail.users.labels.get({
                    userId: 'me',
                    id: 'INBOX',
                })
                return res.result
            } catch (e) {
                console.error(e)
            }
        } else {
            console.log('Error: this.gapi not loaded')
        }
    }

    /**
     * Create an event from the current time for a certain period
     * @param {number} time in minutes for the event
     * @param {string} summary of the event
     * @param {string} description of the event
     * @param {string} calendarId
     * @param {object} conferenceData
     * @param {object} reminders
     * @param {array} attendees
     * @param {string} timeZone The time zone in which the time is specified. (Formatted as an IANA Time Zone Database name, e.g. "Europe/Zurich".)
     * @returns {any}
     */
    public createEventFromNow(
        { time, conferenceData, reminders, summary, attendees, description = '' }: any,
        calendarId: string = this.calendar,
        timeZone: string = 'UTC'
    ): any {
        const event = {
            summary,
            description,
            conferenceData,
            reminders,
            // attendees,
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

    /**
     * Create Calendar event
     * @param {string} calendarId for the event.
     * @param {object} event with start and end dateTime
     * @returns {any}
     */
    public createEvent(event: object, calendarId: string = this.calendar): any {
        if (this.gapi) {
            return this.gapi.client.calendar.events.insert({
                calendarId: calendarId,
                resource: event,
                // sendNotifications: true, // if true the attendees will also receive an email notification for your event
                conferenceDataVersion: 1, // To allow creation and modification of conference details
            })
        } else {
            console.log('Error: this.gapi not loaded')
            return false
        }
    }

    /**
     * Delete an event in the calendar.
     * @param {string} eventId of the event to delete.
     * @param {string} calendarId where the event is.
     * @returns {any} Promise resolved when the event is deleted.
     */
    deleteEvent(eventId: string, calendarId: string = this.calendar): any {
        if (this.gapi) {
            return this.gapi.client.calendar.events.delete({
                calendarId: calendarId,
                eventId: eventId,
            })
        } else {
            console.log('Error: gapi is not loaded use onLoad before please.')
            return null
        }
    }

    /**
     * Get the user's basic profile information
     * Returns a compatibility object similar to gapi.auth2 getBasicProfile
     */
    getBasicUserProfile(): any {
        if (!this.userProfile) {
            // Try to fetch if not already loaded
            this.fetchUserProfile()
            return null
        }

        // Return compatibility object that matches old gapi.auth2.getBasicProfile() interface
        return {
            getEmail: () => this.userProfile.email,
            getId: () => this.userProfile.sub,
            getName: () => this.userProfile.name,
            getImageUrl: () => this.userProfile.picture,
        }
    }

    /**
     * Update Calendar event
     * @param {string} calendarId for the event.
     * @param {string} eventId of the event.
     * @param {object} event with details to update, e.g. summary
     * @returns {any}
     */
    updateEvent(event: object, eventId: string, calendarId: string = this.calendar): any {
        if (this.gapi) {
            return this.gapi.client.calendar.events.patch({
                calendarId: calendarId,
                eventId: eventId,
                resource: event,
            })
        } else {
            console.log('Error: gapi is not loaded use onLoad before please.')
            return null
        }
    }

    /**
     * Get Calendar event
     * @param {string} calendarId for the event.
     * @param {string} eventId specifies individual event
     * @returns {any}
     */
    getEvent(eventId: string, calendarId: string = this.calendar): any {
        if (this.gapi) {
            return this.gapi.client.calendar.events.get({
                calendarId: calendarId,
                eventId: eventId,
            })
        } else {
            console.log('Error: gapi is not loaded use onLoad before please.')
            return null
        }
    }
}

let googleApi
try {
    googleApi = new GoogleApi()
} catch (e) {
    console.log(e)
}
export default googleApi
