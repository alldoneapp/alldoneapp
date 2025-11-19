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
    console.log(`[serverSideCalendarSync] Starting sync for user ${userId}, project ${projectId}`)

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

        // Get fresh access token (automatically refreshes if needed)
        console.log('[serverSideCalendarSync] Getting access token...')
        const accessToken = await getAccessToken(userId)

        // Create authenticated OAuth2 client
        const oauth2Client = getOAuth2Client()
        oauth2Client.setCredentials({
            access_token: accessToken,
        })

        // Create calendar API instance
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

        // Calculate time range for events
        const now = new Date()
        const timeMin = new Date()
        timeMin.setHours(0, 0, 0, 0)

        const timeMax = new Date()
        timeMax.setDate(timeMax.getDate() + daysAhead)
        timeMax.setHours(0, 0, 0, 0)

        console.log('[serverSideCalendarSync] Fetching events from Google Calendar API...', {
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            daysAhead,
        })

        // Fetch calendar events
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            showDeleted: false,
            singleEvents: true,
            maxResults: 2500, // Increased from 30 to fetch more events over longer period
            orderBy: 'startTime',
        })

        const events = response.data.items || []
        console.log(`[serverSideCalendarSync] Fetched ${events.length} events from Google Calendar`)

        // Get user email from stored token data
        const tokenDoc = await admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc('googleAuth')
            .get()

        const userEmail = tokenDoc.exists ? tokenDoc.data().email : null
        if (!userEmail) {
            throw new Error('User email not found in stored auth data')
        }

        // Process events - add/update calendar tasks
        console.log('[serverSideCalendarSync] Processing events...')

        // Add/update calendar events as tasks
        await addCalendarEvents(events, projectId, userId, userEmail)

        // Remove old/declined calendar tasks
        // Prepare simplified events array for removal check (just id and responseStatus)
        const simplifiedEvents = events.map(event => {
            const userAttendee = event.attendees?.find(item => item.email === userEmail)
            const userResponseStatus = userAttendee?.responseStatus
            return {
                id: event.id,
                responseStatus: userResponseStatus,
            }
        })

        const todayFormatted = moment().format('DDMMYYYY')
        await removeCalendarTasks(userId, todayFormatted, simplifiedEvents, false)

        console.log('[serverSideCalendarSync] Sync completed successfully', {
            eventsFetched: events.length,
            userEmail,
            projectId,
        })

        return {
            success: true,
            eventsFetched: events.length,
            userEmail,
            projectId,
        }
    } catch (error) {
        console.error('[serverSideCalendarSync] Error syncing calendar:', error)
        throw error
    }
}

module.exports = {
    syncCalendarEvents,
}
