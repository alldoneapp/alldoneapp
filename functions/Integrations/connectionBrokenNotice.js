'use strict'

const admin = require('firebase-admin')

const { ACTIVE_USER_WINDOW_MS, getTimestampMillis } = require('../Assistant/assistantHeartbeatSchedule')
const { CONNECTION_SERVICE_CALENDAR, listCalendarConnections, listEmailConnections } = require('./providerConnections')

/**
 * Tells a user, in the app, that one of their connected accounts stopped working.
 *
 * Until AT-2491 nothing did. The server has always recorded the breakage on the user
 * document, but the only surface that read it was Settings > Integrations — a tab nobody
 * opens unless they already suspect something. A production Gmail connection was dead for
 * four days before anyone noticed, with every label sweep and email-line summary failing
 * silently the whole time.
 *
 * Shape follows the heartbeat "out of gold" notice (functions/Assistant/assistantHeartbeat.js):
 * an assistant-authored message in the user's daily topic, plus the chat-notification doc
 * that produces the unread badge. No new collection, no rules change, no client change.
 *
 * Deliberately a sweep rather than a hook on the three places that flip the flag:
 *   - it is ONE code path instead of three (Google, Microsoft, the email-line summary),
 *   - it cannot make an OAuth refresh fail because posting a chat message failed, and
 *   - it covers accounts that were ALREADY broken when this shipped, which a write-path
 *     hook by definition cannot. That was the reported case.
 */

// Per-connection marker on the user document: `connectionBrokenNoticeAt.<connectionId>`.
const NOTICE_FIELD = 'connectionBrokenNoticeAt'

// Cap the work one run will do, so a pathological account cannot run the schedule long.
const MAX_USERS_PER_RUN = 200
const MAX_NOTICES_PER_USER = 5

function isUserRecentlyActive(userData = {}, now = Date.now()) {
    return getTimestampMillis(userData.lastLogin) >= now - ACTIVE_USER_WINDOW_MS
}

/**
 * Which broken connections still owe this user a message.
 *
 * Notified once per breakage, not once per connection forever: a connection that was
 * reconnected and then broke AGAIN has an `authInvalidAt` newer than its marker and is
 * reported again. Connections flagged before `authInvalidAt` existed report 0, which is
 * older than any marker, so they are told exactly once — which is the correct answer for a
 * breakage whose date we never recorded.
 */
function findConnectionsNeedingNotice(userData = {}) {
    const markers = userData[NOTICE_FIELD] || {}
    const connections = [...listEmailConnections(userData), ...listCalendarConnections(userData)]

    return connections
        .filter(connection => connection.authInvalid === true)
        .filter(connection => {
            const notifiedAt = getTimestampMillis(markers[connection.connectionId])
            if (!notifiedAt) return true
            const brokenAt = getTimestampMillis(connection.authInvalidAt)
            return brokenAt > notifiedAt
        })
        .slice(0, MAX_NOTICES_PER_USER)
}

function buildNoticeText(connection, baseUrl) {
    const isCalendar = connection.service === CONNECTION_SERVICE_CALENDAR
    const account = connection.emailAddress || (isCalendar ? 'your calendar account' : 'your email account')
    const consequence = isCalendar
        ? 'Events are no longer being synced into your projects.'
        : 'Emails are no longer being read, labeled or turned into tasks.'

    return (
        `⚠️ The connection to ${account} stopped working and needs to be authorized again. ` +
        `${consequence} Reconnect it here: ${baseUrl}/settings/integrations`
    )
}

// One deterministic id per breakage, so a crash between posting and stamping the marker
// cannot produce a second copy of the same message on the next run.
function buildNoticeCommentId(connection) {
    const brokenAt = getTimestampMillis(connection.authInvalidAt) || 0
    return `conn-broken-${connection.connectionId}-${brokenAt}`
}

async function notifyUserBrokenConnections({
    userId,
    userData = {},
    now = Date.now(),
    db = admin.firestore(),
    // Injected so the sweep is testable without the chat/topic transports.
    getOrCreateWhatsAppDailyTopic = require('../WhatsApp/whatsAppDailyTopic').getOrCreateWhatsAppDailyTopic,
    storeAssistantMessageInTopicOnce = require('../WhatsApp/whatsAppDailyTopic').storeAssistantMessageInTopicOnce,
    getBaseUrl = require('../Utils/HelperFunctionsCloud').getBaseUrl,
} = {}) {
    const pending = findConnectionsNeedingNotice(userData)
    if (pending.length === 0) return { notified: 0, skipped: 0 }

    const projectId = userData.defaultProjectId
    const assistantId = userData.assistantId
    // Without a home project and an assistant to speak as there is nowhere to post. The
    // marker is NOT written in that case, so the user is told as soon as they have one.
    if (!projectId || !assistantId) return { notified: 0, skipped: pending.length, reason: 'no_topic_target' }

    const baseUrl = getBaseUrl()
    // The daily topic, despite the WhatsApp-flavoured helper name, is this codebase's
    // general "the assistant delivers something to you" thread — `whatsAppResultMirror`
    // already posts recurring-task and VM results into it, and it drives the MyDay
    // AssistantLine. The alternative (`getOrCreateHeartbeatTopic`) is the closer precedent
    // in spirit but is not exported, and reaching into assistantHeartbeat.js for it would
    // couple this to the whole heartbeat module.
    const { chatId } = await getOrCreateWhatsAppDailyTopic(userId, projectId, assistantId, userData, now)

    let notified = 0
    let skipped = 0
    const markerUpdate = {}

    for (const connection of pending) {
        try {
            const commentId = buildNoticeCommentId(connection)
            await storeAssistantMessageInTopicOnce({
                projectId,
                chatId,
                assistantId,
                responseText: buildNoticeText(connection, baseUrl),
                commentId,
                userId,
                updateAssistantLine: true,
                extraCommentFields: {
                    isSystemNotice: true,
                    connectionId: connection.connectionId,
                    connectionService: connection.service,
                },
            })

            // The unread badge in the chat list is a separate document; the topic write
            // alone leaves the message sitting unread-looking-read.
            await db
                .doc(`chatNotifications/${projectId}/${userId}/${commentId}`)
                .set({
                    chatId,
                    chatType: 'topics',
                    followed: true,
                    date: now,
                    creatorId: assistantId,
                    creatorType: 'assistant',
                })
                .catch(error => {
                    console.warn('[connectionBrokenNotice] Failed to write chat notification', {
                        userId,
                        error: error?.message || String(error),
                    })
                })

            markerUpdate[`${NOTICE_FIELD}.${connection.connectionId}`] = now
            notified++
        } catch (error) {
            // A failure here must not stop the other broken connections being reported, and
            // must not stamp a marker — an unsent notice has to be retried next run.
            skipped++
            console.error('[connectionBrokenNotice] Failed to post notice', {
                userId,
                connectionId: connection.connectionId,
                error: error?.message || String(error),
            })
        }
    }

    if (Object.keys(markerUpdate).length > 0) {
        await db
            .doc(`users/${userId}`)
            .update(markerUpdate)
            .catch(error => {
                console.error('[connectionBrokenNotice] Failed to record notice markers', {
                    userId,
                    error: error?.message || String(error),
                })
            })
    }

    return { notified, skipped }
}

/**
 * Hourly sweep over recently active users. The active-user definition is imported from the
 * heartbeat schedule rather than re-declared, so the two cannot drift; on production that
 * query returns roughly a dozen users, so this costs a handful of reads per run.
 */
async function sweepBrokenConnectionNotices({
    now = Date.now(),
    db = admin.firestore(),
    limit = MAX_USERS_PER_RUN,
    notifyUser = notifyUserBrokenConnections,
} = {}) {
    const snapshot = await db
        .collection('users')
        .where('lastLogin', '>=', now - ACTIVE_USER_WINDOW_MS)
        .limit(limit)
        .get()

    let notifiedUsers = 0
    let notifiedConnections = 0

    for (const doc of snapshot.docs) {
        const userData = doc.data() || {}
        try {
            // The query filtered on `lastLogin`, but a stored Timestamp sorts apart from a
            // stored number in Firestore, so re-check with the heartbeat coercion.
            if (!isUserRecentlyActive(userData, now)) continue

            const result = await notifyUser({ userId: doc.id, userData, now, db })
            if (result.notified > 0) {
                notifiedUsers++
                notifiedConnections += result.notified
            }
        } catch (error) {
            console.error('[connectionBrokenNotice] Failed to process user', {
                userId: doc.id,
                error: error?.message || String(error),
            })
        }
    }

    console.log('[connectionBrokenNotice] Completed run', {
        activeUsers: snapshot.docs.length,
        notifiedUsers,
        notifiedConnections,
    })

    return { activeUsers: snapshot.docs.length, notifiedUsers, notifiedConnections }
}

module.exports = {
    notifyUserBrokenConnections,
    sweepBrokenConnectionNotices,
    NOTICE_FIELD,
    __private__: {
        findConnectionsNeedingNotice,
        buildNoticeText,
        buildNoticeCommentId,
        isUserRecentlyActive,
    },
}
