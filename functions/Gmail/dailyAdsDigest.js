'use strict'

// Ads in the unread list (AT-3101, decided with the product owner 2026-11-18).
//
// The built-in Ads label has no post-label prompt, so until now an advertising email produced no
// chat comment and never reached Chats > Unread, whatever the user's ads setting said. Every
// incoming ad that no prompt handles now becomes one line in a private "Daily ads <date>" topic in
// the user's default project:
//
// - written without a model ("Email from <name> (<email>): <subject>"): no Gold per ad, and the
//   promotional text never reaches a model that holds tools;
// - private to the mailbox owner (the "Daily emails" digests are project-wide; somebody's ads are
//   not project content), with a deterministic chat id per user and day, so two members' topics
//   with the same title never mix and a rerun never creates a second topic;
// - unread when users/{uid}.unreadEmailSettings.ads is 'show' (the default), stored read when it is
//   'archive' - the same rule as newsletters (`suppressUnread`, add_chat_comment).

const { createHash } = require('crypto')

const { STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')
const { GMAIL_DIRECTION_SCOPE_OUTGOING } = require('./gmailLabelingConfig')
const { parseEmailHeaderAddresses } = require('./gmailMessageParser')
const { resolveUnreadEmailKind } = require('./unreadEmailSettings')

const DAILY_ADS_TOPIC_TITLE_PREFIX = 'Daily ads'
const DAILY_ADS_CHAT_ID_PREFIX = 'DailyAds_'
const DAILY_ADS_SUBJECT_MAX_LENGTH = 200

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : ''
}

/**
 * Whether this email gets a "Daily ads" line: an incoming email that counts as ads (the built-in Ads
 * label, or the classifier's emailKind when the label says nothing about the kind) and that no
 * post-label prompt handles. A label with its own prompt keeps doing what its prompt says.
 */
function shouldWriteDailyAdsLine({ labelKey = '', emailKind = '', direction = '', hasPrompt = false } = {}) {
    if (hasPrompt) return false
    if (direction === GMAIL_DIRECTION_SCOPE_OUTGOING) return false
    return resolveUnreadEmailKind({ labelKey, emailKind }) === 'ads'
}

function buildDailyAdsTopicTitle(formattedDate = '') {
    const date = normalizeString(formattedDate)
    return date ? `${DAILY_ADS_TOPIC_TITLE_PREFIX} ${date}` : DAILY_ADS_TOPIC_TITLE_PREFIX
}

// One topic per user and day. The day key is the formatted date in the user's own format and time
// zone, the same string the title shows.
function getDailyAdsChatId(userId = '', formattedDate = '') {
    const hash = createHash('sha1').update(`${normalizeString(userId)}:${normalizeString(formattedDate)}`)
    return `${DAILY_ADS_CHAT_ID_PREFIX}${hash.digest('hex').slice(0, 24)}`
}

/**
 * The line, in the digest format the unread list already reads ("Email from X (x@y): summary"),
 * with the subject as the summary.
 */
function buildDailyAdsLineText(normalizedMessage = {}) {
    const sender = parseEmailHeaderAddresses(normalizedMessage?.from)[0] || null
    const email = normalizeString(sender?.email).slice(0, 320)
    const name = normalizeString(sender?.displayName).slice(0, 200) || email || 'Unknown sender'
    const rawSubject = normalizeString(normalizedMessage?.subject).replace(/\s+/g, ' ')
    const subject =
        rawSubject.length > DAILY_ADS_SUBJECT_MAX_LENGTH
            ? `${rawSubject.slice(0, DAILY_ADS_SUBJECT_MAX_LENGTH - 3).trimEnd()}...`
            : rawSubject || '(no subject)'
    return `Email from ${name}${email && email !== name ? ` (${email})` : ''}: ${subject}`
}

function buildDailyAdsChatData({ chatId, title, userId, assistantId, now }) {
    return {
        id: chatId,
        title,
        type: 'topics',
        // Someone's advertising mail is personal, never project content (and never a wiki source).
        isPublicFor: [userId],
        assistantId: assistantId || null,
        creatorId: userId,
        created: now,
        lastEditionDate: now,
        lastEditorId: userId,
        usersFollowing: [userId],
        members: [userId],
        hasStar: '#ffffff',
        stickyData: { days: 0, stickyEndDate: 0 },
        // amount 0: add_chat_comment increments it for every line, the first one included.
        commentsData: {
            amount: 0,
            lastComment: '',
            lastCommentOwnerId: assistantId || userId,
            lastCommentType: STAYWARD_COMMENT,
        },
        isAssistantEnabled: true,
        dailyAdsDigest: true,
    }
}

/** Creates the day's topic once; a concurrent create by another sync run is fine. */
async function ensureDailyAdsTopic({ database, projectId, chatId, title, userId, assistantId }) {
    const chatRef = database.doc(`chatObjects/${projectId}/chats/${chatId}`)
    const existing = await chatRef.get()
    if (existing.exists) return { chatId, created: false }
    try {
        await chatRef.create(buildDailyAdsChatData({ chatId, title, userId, assistantId, now: Date.now() }))
    } catch (error) {
        // 6 = ALREADY_EXISTS: another run created it between the read and the create.
        if (error?.code !== 6 && !/already exists/i.test(error?.message || '')) throw error
        return { chatId, created: false }
    }
    return { chatId, created: true }
}

/**
 * Writes the ad's line. `gmailContext` is the post-label context (buildPostLabelGmailContext), so the
 * comment carries the same gmailData as any digest line: Archive and Unsubscribe actions, the Ads
 * tag, the read sync's archivedByLabeling, and suppressUnread for the 'archive' setting.
 */
async function writeDailyAdsLine({
    database,
    projectId,
    userId,
    assistantId,
    formattedDate,
    normalizedMessage,
    gmailContext,
    addChatComment,
}) {
    const chatId = getDailyAdsChatId(userId, formattedDate)
    const title = buildDailyAdsTopicTitle(formattedDate)
    await ensureDailyAdsTopic({ database, projectId, chatId, title, userId, assistantId })
    const result = await addChatComment({
        projectId,
        chatId,
        comment: buildDailyAdsLineText(normalizedMessage),
        assistantId,
        userId,
        // An informational line (an unfollowed unread entry), even for an ad the classifier called
        // actionable: an ad never becomes a task.
        gmailContext: { ...gmailContext, followUpType: 'informational' },
    })
    return {
        projectId,
        chatId,
        chatTitle: title,
        commentId: result?.commentId || '',
        skippedDuplicate: result?.skippedDuplicate === true,
    }
}

module.exports = {
    DAILY_ADS_CHAT_ID_PREFIX,
    DAILY_ADS_TOPIC_TITLE_PREFIX,
    buildDailyAdsChatData,
    buildDailyAdsLineText,
    buildDailyAdsTopicTitle,
    ensureDailyAdsTopic,
    getDailyAdsChatId,
    shouldWriteDailyAdsLine,
    writeDailyAdsLine,
}
