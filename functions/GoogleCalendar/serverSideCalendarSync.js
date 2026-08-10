'use strict'
const { google } = require('googleapis')
const admin = require('firebase-admin')
const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const { getMicrosoftGraphClient } = require('../MicrosoftGraph/graphClient')
const {
    addCalendarEvents,
    filterEvents,
    removeCalendarTasks,
    getRoutedCalendarEventIds,
} = require('../GoogleCalendarTasks/calendarTasks')
const { routeCalendarEventsToProjects } = require('./calendarProjectRouting')
const moment = require('moment-timezone')

function graphEventToGoogleEvent(event = {}) {
    return {
        id: event.id || '',
        summary: event.subject || '',
        description: event.bodyPreview || event.body?.content || '',
        htmlLink: event.webLink || '',
        status: event.isCancelled ? 'cancelled' : 'confirmed',
        start: event.start?.dateTime
            ? {
                  dateTime: event.start.dateTime,
                  timeZone: event.start.timeZone || 'UTC',
              }
            : {},
        end: event.end?.dateTime
            ? {
                  dateTime: event.end.dateTime,
                  timeZone: event.end.timeZone || 'UTC',
              }
            : {},
        attendees: Array.isArray(event.attendees)
            ? event.attendees.map(attendee => ({
                  email: attendee?.emailAddress?.address || '',
                  displayName: attendee?.emailAddress?.name || '',
                  responseStatus: attendee?.status?.response || '',
                  optional: attendee?.type === 'optional',
              }))
            : [],
        organizer: event.organizer?.emailAddress
            ? {
                  email: event.organizer.emailAddress.address || '',
                  displayName: event.organizer.emailAddress.name || '',
              }
            : null,
        provider: 'microsoft',
    }
}

/**
 * Server-side calendar sync function
 * Fetches calendar events from Google Calendar API and processes them
 *
 * @param {string} userId - The user ID
 * @param {string} projectId - The project ID to sync calendar for
 * @param {number} daysAhead - Number of days ahead to fetch events (default: 30)
 * @returns {Promise<object>} - Sync result with event counts
 */
async function syncCalendarEvents(userId, projectId, daysAhead = 30) {
    console.log('[serverSideCalendarSync] Starting sync - User:', userId, 'Project:', projectId)

    try {
        // Verify user has calendar connected for this project
        const userDoc = await admin.firestore().collection('users').doc(userId).get()
        if (!userDoc.exists) {
            throw new Error('User not found')
        }

        const userData = userDoc.data()
        const connection = userData.apisConnected?.[projectId] || {}
        const isCalendarConnected = connection.calendar
        const calendarProvider = connection.calendarProvider || 'google'

        if (!isCalendarConnected) {
            throw new Error('Calendar not connected for this project')
        }

        // Get user timezone (string or offset)
        const timezone =
            (typeof userData?.timezone !== 'undefined' ? userData.timezone : null) ??
            (typeof userData?.timezoneOffset !== 'undefined' ? userData.timezoneOffset : null) ??
            (typeof userData?.timezoneMinutes !== 'undefined' ? userData.timezoneMinutes : null) ??
            0

        // Calculate timezone offset in minutes
        let timezoneOffset = 0
        if (typeof timezone === 'string') {
            // It's an IANA timezone string (e.g., "Europe/Berlin")
            timezoneOffset = moment.tz(timezone).utcOffset()
        } else if (typeof timezone === 'number') {
            // It's already an offset. If small number, treat as hours (e.g. 1 -> 60)
            // Range checks for valid hour offsets (typically -12 to +14)
            if (Math.abs(timezone) <= 16) {
                timezoneOffset = timezone * 60
            } else {
                timezoneOffset = timezone
            }
        }

        console.log(
            `[serverSideCalendarSync] Timezone: ${timezone}, Offset: ${timezoneOffset}, User: ${userId}, Project: ${projectId}`
        )

        // Calculate time range for events using user's timezone
        // Calculate time range for events using user's timezone
        let startOfTodayUserTz
        try {
            if (typeof timezone === 'string') {
                startOfTodayUserTz = moment.tz(timezone).startOf('day')
            } else {
                // Numeric offset or default 0
                startOfTodayUserTz = moment().utcOffset(timezoneOffset).startOf('day')
            }
        } catch (e) {
            console.error(`[serverSideCalendarSync] Error parsing timezone '${timezone}':`, e)
            // Fallback to UTC if timezone parsing fails
            startOfTodayUserTz = moment.utc().startOf('day')
        }

        const timeMin = startOfTodayUserTz.toDate()
        const timeMax = startOfTodayUserTz.clone().endOf('day').toDate()

        console.log(
            `[serverSideCalendarSync] Fetch Window - Min: ${timeMin.toISOString()}, Max: ${timeMax.toISOString()}`
        )

        const fetchStartTime = Date.now()

        let events = []
        let userEmail = connection.calendarEmail || null

        if (calendarProvider === 'microsoft') {
            const graph = await getMicrosoftGraphClient(userId, projectId, 'calendar')
            const query = new URLSearchParams({
                startDateTime: timeMin.toISOString(),
                endDateTime: timeMax.toISOString(),
                $top: '100',
                $orderby: 'start/dateTime',
                $select:
                    'id,subject,bodyPreview,body,location,isCancelled,webLink,start,end,attendees,organizer,onlineMeeting,seriesMasterId',
            })
            const response = await graph.request(`/me/calendarView?${query.toString()}`, {
                headers: { Prefer: 'outlook.body-content-type="text",outlook.timezone="UTC"' },
            })
            events = (response?.value || []).map(graphEventToGoogleEvent)
        } else {
            // Get fresh access token (automatically refreshes if needed)
            const accessToken = await getAccessToken(userId, projectId, 'calendar')

            // Create authenticated OAuth2 client
            const oauth2Client = getOAuth2Client()
            oauth2Client.setCredentials({
                access_token: accessToken,
            })

            // Create calendar API instance
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

            const response = await calendar.events.list({
                calendarId: 'primary',
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                showDeleted: false,
                singleEvents: true,
                maxResults: 100, // Reasonable limit for today's events (was 2500 for 30 days)
                orderBy: 'startTime',
            })
            events = response.data.items || []
        }

        const fetchDuration = Date.now() - fetchStartTime
        console.log(`[serverSideCalendarSync] Fetched ${events.length} events in ${fetchDuration}ms`)
        events.forEach(e => {
            console.log(
                `[serverSideCalendarSync] Event: ${e.summary} | Start: ${e.start.dateTime || e.start.date} | Status: ${
                    e.status
                }`
            )
        })

        if (!userEmail && calendarProvider === 'google') {
            // Get user email from stored token data
            let tokenDoc = await admin
                .firestore()
                .collection('users')
                .doc(userId)
                .collection('private')
                .doc(`googleAuth_${projectId}_calendar`)
                .get()

            if (!tokenDoc.exists) {
                tokenDoc = await admin
                    .firestore()
                    .collection('users')
                    .doc(userId)
                    .collection('private')
                    .doc(`googleAuth_${projectId}`)
                    .get()
            }

            if (!tokenDoc.exists) {
                tokenDoc = await admin
                    .firestore()
                    .collection('users')
                    .doc(userId)
                    .collection('private')
                    .doc('googleAuth')
                    .get()
            }

            if (!tokenDoc.exists) throw new Error('No Google OAuth token found for user')
            userEmail = tokenDoc.data().email
        }
        if (!userEmail) {
            throw new Error('User email not found in stored auth data')
        }

        const filteredEvents = filterEvents(events, userEmail)
        // Events already routed in a previous sync keep their stored project decision, so we
        // skip re-classifying them. This prevents re-charging routing gold every sync and the
        // non-deterministic re-routing that re-stamps the routing chat's "last edited" date
        // (most visible on full-day events, which carry no attendee/domain signal).
        const alreadyRoutedEventIds = await getRoutedCalendarEventIds(
            userId,
            filteredEvents.map(event => event.id).filter(Boolean)
        )
        const routingDecisionsByEventId = await routeCalendarEventsToProjects({
            userId,
            syncProjectId: projectId,
            userData,
            events: filteredEvents,
            calendarEmail: userEmail,
            alreadyRoutedEventIds,
        })

        // Process events - add/update calendar tasks
        await addCalendarEvents(events, projectId, userId, userEmail, timezoneOffset, routingDecisionsByEventId)

        // Remove old/declined calendar tasks
        const simplifiedEvents = events.map(event => {
            const userAttendee = event.attendees?.find(item => item.email === userEmail)
            const userResponseStatus = userAttendee?.responseStatus
            return {
                id: event.id,
                responseStatus: userResponseStatus,
            }
        })

        const todayFormatted = startOfTodayUserTz.format('DDMMYYYY')
        console.log(`[serverSideCalendarSync] todayFormatted: ${todayFormatted}`)
        await removeCalendarTasks(userId, projectId, todayFormatted, simplifiedEvents, false, userEmail, timezoneOffset)

        const totalDuration = Date.now() - fetchStartTime
        console.log(
            `[serverSideCalendarSync] ✅ Sync completed: ${events.length} events, ${totalDuration}ms, ${userEmail}`
        )

        return {
            success: true,
            eventsFetched: events.length,
            userEmail,
            projectId,
            duration: totalDuration,
            routedEvents: Object.values(routingDecisionsByEventId).filter(decision => decision?.matched).length,
        }
    } catch (error) {
        console.error('[serverSideCalendarSync] ❌ Sync failed:', error.message)
        throw error
    }
}

module.exports = {
    syncCalendarEvents,
}
