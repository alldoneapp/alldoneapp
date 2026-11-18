'use strict'

const { GMAIL_DIRECTION_SCOPE_OUTGOING } = require('./gmailLabelingConfig')

// users/{uid}.unreadEmailSettings: for newsletters and ads, whether they show in the chat list's
// unread view ('show', the default) or are archived in the mailbox and stored already read
// ('archive'). The app writes it (components/ChatsView/UnreadTriage/unreadEmailSettings.js mirrors
// these values; functions cannot import app code) and the Gmail labeling sync reads it.
const UNREAD_EMAIL_SETTING_SHOW = 'show'
const UNREAD_EMAIL_SETTING_ARCHIVE = 'archive'
const UNREAD_EMAIL_SETTING_KINDS = ['newsletter', 'ads']

/**
 * Which kind an email counts as for the setting and for its tag. The label wins over the
 * classifier's emailKind because the user configured it: the built-in Ads label (always present in
 * the default mode) and a custom "newsletter" label. In the default mode every other label is a
 * project, which says nothing about the kind, so emailKind decides.
 */
function resolveUnreadEmailKind({ labelKey = '', emailKind = '' } = {}) {
    const key = typeof labelKey === 'string' ? labelKey.trim().toLowerCase() : ''
    if (key === 'ads') return 'ads'
    if (key === 'newsletter') return 'newsletter'
    return typeof emailKind === 'string' && emailKind ? emailKind : null
}

function getUnreadEmailSetting(userData = {}, kind = '') {
    return userData?.unreadEmailSettings?.[kind] === UNREAD_EMAIL_SETTING_ARCHIVE
        ? UNREAD_EMAIL_SETTING_ARCHIVE
        : UNREAD_EMAIL_SETTING_SHOW
}

/**
 * Whether the labeling sync archives this email and stores its comment as read. Only incoming,
 * informational mail without a reply owed: an actionable email becomes a task and an email that
 * needs a reply goes to Messages, whatever its kind - the setting is about clutter, not about
 * swallowing work.
 */
function shouldArchiveForUnreadSettings({
    userData,
    labelKey = '',
    emailKind = '',
    direction = '',
    followUpType = 'informational',
    needsReply = false,
} = {}) {
    if (direction === GMAIL_DIRECTION_SCOPE_OUTGOING) return false
    if (followUpType === 'actionable' || needsReply === true) return false
    const kind = resolveUnreadEmailKind({ labelKey, emailKind })
    if (!UNREAD_EMAIL_SETTING_KINDS.includes(kind)) return false
    return getUnreadEmailSetting(userData, kind) === UNREAD_EMAIL_SETTING_ARCHIVE
}

/**
 * The ads choice, merged on 2026-11-18 from the per-connection "Auto-archive Ads" (gmailLabeling
 * config `adsAutoArchive`) into users/{uid}.unreadEmailSettings.ads. The user's own value wins; a
 * user who never chose one keeps what their connection had, until the first sync copies it over.
 */
function resolveAdsUnreadSetting(userData = {}, config = {}) {
    const explicit = userData?.unreadEmailSettings?.ads
    if (explicit === UNREAD_EMAIL_SETTING_ARCHIVE || explicit === UNREAD_EMAIL_SETTING_SHOW) return explicit
    return config?.adsAutoArchive === true ? UNREAD_EMAIL_SETTING_ARCHIVE : UNREAD_EMAIL_SETTING_SHOW
}

/**
 * Copies a connection's old "Auto-archive Ads" onto the user, once, and returns the user data this
 * run should use. A failed write still applies the old choice for this run; the next run retries.
 */
async function migrateAdsAutoArchiveSetting({ db, userId, userData = {}, config = {} }) {
    const explicit = userData?.unreadEmailSettings?.ads
    if (config?.adsAutoArchive !== true || typeof explicit === 'string') return userData
    try {
        await db.collection('users').doc(userId).update({ 'unreadEmailSettings.ads': UNREAD_EMAIL_SETTING_ARCHIVE })
    } catch (error) {
        console.warn('[gmailLabeling] Could not copy Auto-archive Ads to the user setting', {
            userId,
            error: error.message,
        })
    }
    return {
        ...userData,
        unreadEmailSettings: { ...(userData.unreadEmailSettings || {}), ads: UNREAD_EMAIL_SETTING_ARCHIVE },
    }
}

module.exports = {
    UNREAD_EMAIL_SETTING_ARCHIVE,
    UNREAD_EMAIL_SETTING_KINDS,
    UNREAD_EMAIL_SETTING_SHOW,
    getUnreadEmailSetting,
    migrateAdsAutoArchiveSetting,
    resolveAdsUnreadSetting,
    resolveUnreadEmailKind,
    shouldArchiveForUnreadSettings,
}
