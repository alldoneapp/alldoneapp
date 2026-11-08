'use strict'

/**
 * Binds `createApiEmailTasksSecondGen` to the signed-in caller (security audit 2026-11).
 *
 * The callable writes the "Emails in inbox" task of `items/{projectId}/tasks` with the Admin SDK.
 * It used to take the user, the project, the mailbox address, the count and the provider from the
 * request, so any signed-in account could create or overwrite the inbox task of any user in any
 * project.
 *
 * Its one caller (`checkIfGmailIsConnected` in `utils/backends/firestore.js`) reports the logged-in
 * user's own Gmail count for a project they belong to. The task is now always the caller's own, in a
 * project the caller is a member of and has a mailbox connected for; the address must be one of the
 * addresses stored for that connection; the count must be a non-negative integer. Microsoft has its
 * own server-side callable (`syncMicrosoftUnreadEmailSecondGen`), so the provider is always Google.
 */

const { HttpsError } = require('firebase-functions/v2/https')
const { assertProjectAccess } = require('../shared/privacyAccess')

const MAX_UNREAD_MAILS = 10000000

function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

async function resolveApiEmailTaskRequest(db, request) {
    const uid = request?.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required')

    const data = request.data || {}
    const projectId = typeof data.projectId === 'string' ? data.projectId.trim() : ''
    if (!projectId) throw new HttpsError('invalid-argument', 'projectId is required')

    let userData
    try {
        userData = await assertProjectAccess(db, uid, projectId)
    } catch (error) {
        throw new HttpsError('permission-denied', 'No access to project')
    }

    const connection = userData.apisConnected?.[projectId] || {}
    if (!connection.gmail && !connection.email) {
        throw new HttpsError('failed-precondition', 'Email is not connected for this project')
    }
    if (connection.emailProvider === 'microsoft') {
        throw new HttpsError('failed-precondition', 'Use the Microsoft sync for this project')
    }

    const storedAddresses = [connection.emailAddress, connection.gmailEmail, userData.email].filter(
        address => typeof address === 'string' && address.trim()
    )
    const requested = normalizeEmail(data.email)
    const email = storedAddresses.find(address => normalizeEmail(address) === requested) || storedAddresses[0] || null

    const unreadMails = data.unreadMails
    if (!Number.isInteger(unreadMails) || unreadMails < 0 || unreadMails > MAX_UNREAD_MAILS) {
        throw new HttpsError('invalid-argument', 'unreadMails must be a non-negative integer')
    }

    const date = Number.isFinite(data.date) ? data.date : Date.now()
    const timezone =
        typeof data.timezone === 'number' && Number.isFinite(data.timezone)
            ? data.timezone
            : typeof data.timezone === 'string'
              ? data.timezone.slice(0, 64)
              : undefined

    return { uid, projectId, date, unreadMails, email, timezone, provider: 'google' }
}

module.exports = { resolveApiEmailTaskRequest }
