'use strict'
const { google } = require('googleapis')
const admin = require('firebase-admin')
const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const { addCalendarEvents, removeCalendarTasks } = require('../GoogleCalendarTasks/calendarTasks')
const moment = require('moment')

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
        const isCalendarConnected = userData.apisConnected?.[projectId]?.calendar

        if (!isCalendarConnected) {
            throw new Error('Calendar not connected for this project')
        }

        // Get user timezone offset (in minutes)
        const timezoneOffset =
            (typeof userData?.timezone !== 'undefined' ? userData.timezone : null) ??
            (typeof userData?.timezoneOffset !== 'undefined' ? userData.timezoneOffset : null) ??
            (typeof userData?.timezoneMinutes !== 'undefined' ? userData.timezoneMinutes : null) ??
            0

        // Get fresh access token (automatically refreshes if needed)
        const accessToken = await getAccessToken(userId, projectId, 'calendar')

        // Create authenticated OAuth2 client
        const oauth2Client = getOAuth2Client()
        oauth2Client.setCredentials({
            access_token: accessToken,
        })

        // Create calendar API instance
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

        // Calculate time range for events using user's timezone
        const nowUtc = moment.utc()
        const nowUserTz = nowUtc.clone().add(timezoneOffset, 'minutes')
        const startOfTodayUserTz = nowUserTz.clone().startOf('day')
        const timeMin = startOfTodayUserTz.clone().subtract(timezoneOffset, 'minutes').toDate()

        // End date: Start of tomorrow in user's timezone (sync only TODAY's events)
        const endDateUserTz = startOfTodayUserTz.clone().add(1, 'day')
        const timeMax = endDateUserTz.clone().subtract(timezoneOffset, 'minutes').toDate()

        const fetchStartTime = Date.now()

        // Fetch calendar events
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            showDeleted: false,
            singleEvents: true,
            maxResults: 100, // Reasonable limit for today's events (was 2500 for 30 days)
            orderBy: 'startTime',
        })

        const fetchDuration = Date.now() - fetchStartTime
        const events = response.data.items || []
        console.log(`[serverSideCalendarSync] Fetched ${events.length} events in ${fetchDuration}ms`)

        // Get user email from stored token data
        // 1. Try service-specific token (new format)
        let tokenDoc = await admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(`googleAuth_${projectId}_calendar`)
            .get()

        // 2. Fallback to legacy project token
        if (!tokenDoc.exists) {
            tokenDoc = await admin
                .firestore()
                .collection('users')
                .doc(userId)
                .collection('private')
                .doc(`googleAuth_${projectId}`)
                .get()
        }

        // 3. Fallback to global token
        if (!tokenDoc.exists) {
            tokenDoc = await admin
                .firestore()
                .collection('users')
                .doc(userId)
                .collection('private')
                .doc('googleAuth')
                .get()
        }

        if (!tokenDoc.exists) {
            throw new Error('No Google OAuth token found for user')
        }

        const userEmail = tokenDoc.exists ? tokenDoc.data().email : null
        if (!userEmail) {
            throw new Error('User email not found in stored auth data')
        }

        // Process events - add/update calendar tasks
        await addCalendarEvents(events, projectId, userId, userEmail)

        // Remove old/declined calendar tasks
        const simplifiedEvents = events.map(event => {
            const userAttendee = event.attendees?.find(item => item.email === userEmail)
            const userResponseStatus = userAttendee?.responseStatus
            return {
                id: event.id,
                responseStatus: userResponseStatus,
            }
        })

        const todayFormatted = moment().format('DDMMYYYY')
        await removeCalendarTasks(userId, projectId, todayFormatted, simplifiedEvents, false, userEmail)

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
        }
    } catch (error) {
        console.error('[serverSideCalendarSync] ❌ Sync failed:', error.message)
        throw error
    }
}

module.exports = {
    syncCalendarEvents,
}
