'use strict'

/**
 * Binds `generateBotDailyTopicCommentSecondGen` to the signed-in caller (security audit 2026-11).
 *
 * The callable used to take the run's identity (`userId`), the topic (`objectId`), the
 * notification recipients and two date labels straight from the request, and then started a
 * tool-enabled assistant run as that user, with the date labels copied verbatim into a system
 * message. Any signed-in account could therefore run another user's assistant, with its tools,
 * as that user.
 *
 * The only legitimate caller (`createBotDailyTopic` in `utils/assistantHelper.js`) asks for the
 * logged-in user's own daily recap in their own `BotChat<YYYYMMDD><uid>` topic of their default
 * project, right after creating that topic. Everything here is derived from that:
 * - the user is `request.auth.uid`, never `data.userId`;
 * - the topic must be the caller's own daily topic, for a date near today, in the caller's default
 *   project (read from the user document), and readable by the caller;
 * - the date labels that reach the prompt are formatted here from numbers, never copied;
 * - notifications only go to current members of that project.
 */

const { HttpsError } = require('firebase-functions/v2/https')
const { assertObjectAccess } = require('../shared/privacyAccess')

const DAY_MS = 24 * 60 * 60 * 1000
// A local day is at most 25h (DST); allow a little slack for the client's clock.
const MAX_RANGE_MS = 26 * 60 * 60 * 1000
// Topic dates are the client's local date; accept yesterday/today/tomorrow in UTC terms.
const MAX_TOPIC_DATE_SKEW_DAYS = 2
const MAX_LANGUAGE_LENGTH = 64

function parseTopicDate(yyyymmdd) {
    const year = Number(yyyymmdd.slice(0, 4))
    const month = Number(yyyymmdd.slice(4, 6))
    const day = Number(yyyymmdd.slice(6, 8))
    const time = Date.UTC(year, month - 1, day)
    const date = new Date(time)
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
    return time
}

function formatLabel(timestamp, options) {
    return new Date(timestamp).toLocaleDateString('en-us', { timeZone: 'UTC', ...options })
}

async function resolveDailyTopicRequest(db, request, { now = Date.now() } = {}) {
    const uid = request?.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required')

    const data = request.data || {}
    const { startDate, endDate } = data
    if (!Number.isFinite(startDate) || !Number.isFinite(endDate) || startDate > endDate) {
        throw new HttpsError('invalid-argument', 'startDate and endDate must be timestamps')
    }
    if (endDate - startDate > MAX_RANGE_MS) {
        throw new HttpsError('invalid-argument', 'The summary covers at most one day')
    }

    // The topic is always the caller's own daily recap: BotChat<YYYYMMDD><uid>.
    const objectId = typeof data.objectId === 'string' ? data.objectId : ''
    const match = /^BotChat(\d{8})(.+)$/.exec(objectId)
    if (!match || match[2] !== uid) {
        throw new HttpsError('permission-denied', 'Only your own daily topic can be generated')
    }
    const topicDate = parseTopicDate(match[1])
    if (topicDate === null || Math.abs(topicDate - now) > MAX_TOPIC_DATE_SKEW_DAYS * DAY_MS) {
        throw new HttpsError('invalid-argument', 'The daily topic is not for today')
    }

    const userDoc = await db.doc(`users/${uid}`).get()
    const defaultProjectId = userDoc.exists ? userDoc.data()?.defaultProjectId : null
    if (typeof defaultProjectId !== 'string' || !defaultProjectId) {
        throw new HttpsError('failed-precondition', 'No default project')
    }

    try {
        await assertObjectAccess(db, uid, defaultProjectId, 'topics', objectId)
    } catch (error) {
        throw new HttpsError('permission-denied', 'No access to this daily topic')
    }

    const projectDoc = await db.doc(`projects/${defaultProjectId}`).get()
    const memberIds = new Set(
        projectDoc.exists && Array.isArray(projectDoc.data()?.userIds) ? projectDoc.data().userIds : []
    )
    const requestedRecipients = Array.isArray(data.userIdsToNotify) ? data.userIdsToNotify : []
    const userIdsToNotify = [...new Set(requestedRecipients.filter(id => typeof id === 'string' && memberIds.has(id)))]

    // The summarised day is startDate..endDate in the user's local time, so its midpoint is local
    // noon, which falls on the same calendar date in UTC for every offset between -12h and +12h.
    const lastSessionDate = formatLabel(startDate + (endDate - startDate) / 2, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    })
    const todayDate = formatLabel(topicDate, { month: 'long', day: 'numeric' })

    return {
        userId: uid,
        defaultProjectId,
        objectId,
        startDate,
        endDate,
        todayDate,
        lastSessionDate,
        userIdsToNotify,
        language: typeof data.language === 'string' ? data.language.trim().slice(0, MAX_LANGUAGE_LENGTH) : '',
        // Resolved by getAssistantForChat inside the caller's own default project (or the global
        // catalog), never in a project named by the request.
        assistantId: typeof data.assistantId === 'string' ? data.assistantId.trim() : '',
    }
}

module.exports = { resolveDailyTopicRequest }
