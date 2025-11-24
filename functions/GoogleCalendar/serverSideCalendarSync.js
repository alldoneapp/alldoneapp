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
    console.log('╔═══════════════════════════════════════════════════════════╗')
    console.log('║        SERVER-SIDE CALENDAR SYNC STARTED                 ║')
    console.log('╚═══════════════════════════════════════════════════════════╝')
    console.log('[serverSideCalendarSync] User ID:', userId)
    console.log('[serverSideCalendarSync] Project ID:', projectId)
    console.log('[serverSideCalendarSync] Days ahead:', daysAhead)
    console.log('[serverSideCalendarSync] Timestamp:', new Date().toISOString())

    try {
        // Verify user has calendar connected for this project
        console.log('[serverSideCalendarSync] 📋 Verifying user and calendar connection...')
        const userDoc = await admin.firestore().collection('users').doc(userId).get()
        if (!userDoc.exists) {
            throw new Error('User not found')
        }

        const userData = userDoc.data()
        const isCalendarConnected = userData.apisConnected?.[projectId]?.calendar
        console.log('[serverSideCalendarSync] Calendar connected:', isCalendarConnected)
        console.log('[serverSideCalendarSync] User APIs connected:', JSON.stringify(userData.apisConnected, null, 2))

        if (!isCalendarConnected) {
            throw new Error('Calendar not connected for this project')
        }

        // Get user timezone offset (in minutes)
        const timezoneOffset =
            (typeof userData?.timezone !== 'undefined' ? userData.timezone : null) ??
            (typeof userData?.timezoneOffset !== 'undefined' ? userData.timezoneOffset : null) ??
            (typeof userData?.timezoneMinutes !== 'undefined' ? userData.timezoneMinutes : null) ??
            0

        console.log('[serverSideCalendarSync] 🌍 User timezone offset (minutes):', timezoneOffset)

        // Get fresh access token (automatically refreshes if needed)
        console.log('[serverSideCalendarSync] 🔑 Getting access token...')
        const accessToken = await getAccessToken(userId, projectId, 'calendar')
        console.log('[serverSideCalendarSync] ✅ Access token obtained:', accessToken.substring(0, 20) + '...')

        // Create authenticated OAuth2 client
        const oauth2Client = getOAuth2Client()
        oauth2Client.setCredentials({
            access_token: accessToken,
        })
        console.log('[serverSideCalendarSync] ✅ OAuth2 client configured')

        // Create calendar API instance
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
        console.log('[serverSideCalendarSync] ✅ Calendar API instance created')

        // Calculate time range for events using user's timezone
        // Get current UTC time
        const nowUtc = moment.utc()
        console.log('[serverSideCalendarSync] Current UTC time:', nowUtc.toISOString())

        // Convert to user's timezone by adding their offset
        const nowUserTz = nowUtc.clone().add(timezoneOffset, 'minutes')
        console.log('[serverSideCalendarSync] Current user time:', nowUserTz.format('YYYY-MM-DD HH:mm:ss'))

        // Start of today in user's timezone
        const startOfTodayUserTz = nowUserTz.clone().startOf('day')
        console.log(
            '[serverSideCalendarSync] Start of today (user TZ):',
            startOfTodayUserTz.format('YYYY-MM-DD HH:mm:ss')
        )

        // Convert back to UTC for Google Calendar API
        const timeMin = startOfTodayUserTz.clone().subtract(timezoneOffset, 'minutes').toDate()

        // End date: Start of tomorrow in user's timezone
        // This matches the old behavior: sync only TODAY's events (00:00 today to 00:00 tomorrow)
        const endDateUserTz = startOfTodayUserTz.clone().add(1, 'day')
        console.log('[serverSideCalendarSync] End date (user TZ):', endDateUserTz.format('YYYY-MM-DD HH:mm:ss'))
        console.log('[serverSideCalendarSync] Note: Syncing only TODAY (not', daysAhead, 'days ahead)')

        // Convert back to UTC for Google Calendar API
        const timeMax = endDateUserTz.clone().subtract(timezoneOffset, 'minutes').toDate()

        console.log('[serverSideCalendarSync] 📅 Fetching events from Google Calendar API...')
        console.log('[serverSideCalendarSync] Time range (UTC):', {
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            daysAhead,
            timezoneOffset: timezoneOffset + ' minutes',
        })
        console.log('[serverSideCalendarSync] Time range (User TZ):', {
            timeMin: startOfTodayUserTz.format('YYYY-MM-DD HH:mm:ss'),
            timeMax: endDateUserTz.format('YYYY-MM-DD HH:mm:ss'),
        })

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
        console.log(`[serverSideCalendarSync] ✅ Fetched ${events.length} events from Google Calendar`)
        console.log(`[serverSideCalendarSync] Fetch duration: ${fetchDuration}ms`)

        // Log first few events for debugging
        if (events.length > 0) {
            console.log('[serverSideCalendarSync] Sample events (first 3):')
            events.slice(0, 3).forEach((event, idx) => {
                console.log(`[serverSideCalendarSync]   Event ${idx + 1}:`, {
                    id: event.id,
                    summary: event.summary,
                    start: event.start,
                    end: event.end,
                    status: event.status,
                })
            })
        }

        // Get user email from stored token data
        console.log('[serverSideCalendarSync] 📧 Getting user email...')
        console.log('[serverSideCalendarSync] 🔍 Looking up token for userId:', userId, 'projectId:', projectId)

        // 1. Try service-specific token (new format)
        console.log(
            '[serverSideCalendarSync] 🔍 Attempting to fetch service-specific token: googleAuth_' +
                projectId +
                '_calendar'
        )
        let tokenDoc = await admin
            .firestore()
            .collection('users')
            .doc(userId)
            .collection('private')
            .doc(`googleAuth_${projectId}_calendar`)
            .get()

        let tokenSource = null
        if (tokenDoc.exists) {
            tokenSource = 'service-specific (googleAuth_' + projectId + '_calendar)'
            console.log('[serverSideCalendarSync] ✅ Found service-specific token')
        }

        // 2. Fallback to legacy project token
        if (!tokenDoc.exists) {
            console.log(
                '[serverSideCalendarSync] ⚠️ Service-specific token not found, trying legacy project token: googleAuth_' +
                    projectId
            )
            tokenDoc = await admin
                .firestore()
                .collection('users')
                .doc(userId)
                .collection('private')
                .doc(`googleAuth_${projectId}`)
                .get()

            if (tokenDoc.exists) {
                tokenSource = 'legacy project (googleAuth_' + projectId + ')'
                console.log('[serverSideCalendarSync] ✅ Found legacy project token')
            }
        }

        // 3. Fallback to global token
        if (!tokenDoc.exists) {
            console.log('[serverSideCalendarSync] ⚠️ Legacy project token not found, trying global token: googleAuth')
            tokenDoc = await admin
                .firestore()
                .collection('users')
                .doc(userId)
                .collection('private')
                .doc('googleAuth')
                .get()

            if (tokenDoc.exists) {
                tokenSource = 'global (googleAuth)'
                console.log('[serverSideCalendarSync] ✅ Found global token')
            }
        }

        if (!tokenDoc.exists) {
            console.log('[serverSideCalendarSync] ❌ No token found in any location')
            throw new Error('No Google OAuth token found for user')
        }

        console.log('[serverSideCalendarSync] 🎯 Using token from:', tokenSource)

        const userEmail = tokenDoc.exists ? tokenDoc.data().email : null
        if (!userEmail) {
            throw new Error('User email not found in stored auth data')
        }
        console.log('[serverSideCalendarSync] User email:', userEmail)

        // Process events - add/update calendar tasks
        console.log('[serverSideCalendarSync] 🔄 Processing events - adding/updating tasks...')
        const addStartTime = Date.now()

        await addCalendarEvents(events, projectId, userId, userEmail)

        const addDuration = Date.now() - addStartTime
        console.log(`[serverSideCalendarSync] ✅ Add/update tasks completed in ${addDuration}ms`)

        // Remove old/declined calendar tasks
        console.log('[serverSideCalendarSync] 🧹 Removing old/declined tasks...')
        const simplifiedEvents = events.map(event => {
            const userAttendee = event.attendees?.find(item => item.email === userEmail)
            const userResponseStatus = userAttendee?.responseStatus
            return {
                id: event.id,
                responseStatus: userResponseStatus,
            }
        })

        const todayFormatted = moment().format('DDMMYYYY')
        console.log('[serverSideCalendarSync] Today formatted:', todayFormatted)
        console.log('[serverSideCalendarSync] Simplified events count:', simplifiedEvents.length)

        const removeStartTime = Date.now()

        await removeCalendarTasks(userId, projectId, todayFormatted, simplifiedEvents, false)

        const removeDuration = Date.now() - removeStartTime
        console.log(`[serverSideCalendarSync] ✅ Remove tasks completed in ${removeDuration}ms`)

        const totalDuration = Date.now() - fetchStartTime
        console.log('╔═══════════════════════════════════════════════════════════╗')
        console.log('║        SERVER-SIDE CALENDAR SYNC COMPLETED               ║')
        console.log('╚═══════════════════════════════════════════════════════════╝')
        console.log('[serverSideCalendarSync] ✅ SYNC SUCCESSFUL')
        console.log('[serverSideCalendarSync] Events fetched:', events.length)
        console.log('[serverSideCalendarSync] User email:', userEmail)
        console.log('[serverSideCalendarSync] Project ID:', projectId)
        console.log('[serverSideCalendarSync] Total duration:', totalDuration, 'ms')
        console.log('[serverSideCalendarSync] Breakdown:', {
            fetch: fetchDuration + 'ms',
            add: addDuration + 'ms',
            remove: removeDuration + 'ms',
        })

        return {
            success: true,
            eventsFetched: events.length,
            userEmail,
            projectId,
            duration: totalDuration,
        }
    } catch (error) {
        console.error('╔═══════════════════════════════════════════════════════════╗')
        console.error('║        SERVER-SIDE CALENDAR SYNC FAILED                  ║')
        console.error('╚═══════════════════════════════════════════════════════════╝')
        console.error('[serverSideCalendarSync] ❌ ERROR:', error.message)
        console.error('[serverSideCalendarSync] Error stack:', error.stack)
        throw error
    }
}

module.exports = {
    syncCalendarEvents,
}
