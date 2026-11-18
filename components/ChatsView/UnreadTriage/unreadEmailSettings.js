// users/{uid}.unreadEmailSettings: for newsletters and ads, whether they show in the unread list
// ('show', the default) or the Gmail labeling sync archives them and stores their comment as read
// ('archive'). Mirrors functions/Gmail/unreadEmailSettings.js, which reads it; the values must stay
// the same on both sides.

export const UNREAD_EMAIL_SETTING_SHOW = 'show'
export const UNREAD_EMAIL_SETTING_ARCHIVE = 'archive'
export const UNREAD_EMAIL_SETTING_KINDS = ['newsletter', 'ads']

export const normalizeUnreadEmailSettings = value => {
    const settings = {}
    UNREAD_EMAIL_SETTING_KINDS.forEach(kind => {
        settings[kind] =
            value && value[kind] === UNREAD_EMAIL_SETTING_ARCHIVE
                ? UNREAD_EMAIL_SETTING_ARCHIVE
                : UNREAD_EMAIL_SETTING_SHOW
    })
    return settings
}

export const isUnreadEmailKindArchived = (settings, kind) =>
    normalizeUnreadEmailSettings(settings)[kind] === UNREAD_EMAIL_SETTING_ARCHIVE

// One ads switch since 2026-11-18: the Gmail labeling settings and the unread list both show
// users/{uid}.unreadEmailSettings.ads. A user who never chose still sees the connection's old
// "Auto-archive Ads" (`adsAutoArchive`) until the sync copies it over - the server applies the same
// rule (functions/Gmail/unreadEmailSettings.js `resolveAdsUnreadSetting`).
export const isAdsArchived = (settings, legacyAdsAutoArchive = false) => {
    const explicit = settings?.ads
    if (explicit === UNREAD_EMAIL_SETTING_ARCHIVE) return true
    if (explicit === UNREAD_EMAIL_SETTING_SHOW) return false
    return legacyAdsAutoArchive === true
}

// Lazy so a test that renders the list does not pull the Firebase client in.
export const setUnreadEmailSetting = (userId, kind, value) => {
    if (!userId || !UNREAD_EMAIL_SETTING_KINDS.includes(kind)) return Promise.resolve()
    const { getDb } = require('../../../utils/backends/firestore')
    const { awaitWriteAck } = require('../../../utils/backends/offlineWriteAck')
    const nextValue = value === UNREAD_EMAIL_SETTING_ARCHIVE ? UNREAD_EMAIL_SETTING_ARCHIVE : UNREAD_EMAIL_SETTING_SHOW
    return awaitWriteAck(
        getDb()
            .doc(`users/${userId}`)
            .update({ [`unreadEmailSettings.${kind}`]: nextValue }),
        'set unread email setting'
    )
}
