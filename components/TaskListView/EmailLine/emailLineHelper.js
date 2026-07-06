import { Linking, Platform } from 'react-native'

import { getOkrAllProjectsTodayKey, getOkrUserTimezone } from '../OKRs/okrHelper'

export const MAX_VISIBLE_CHIPS = 8

// Today key for the "Done for today" behavior. Reuses the OKR timezone-aware
// day key so the email line hides/resets on the same daily boundary as OKRs.
export function getEmailLineTodayKey(loggedUser = {}) {
    return getOkrAllProjectsTodayKey(undefined, getOkrUserTimezone(loggedUser))
}

export function isEmailLineHiddenToday(loggedUser = {}, projectId) {
    if (!projectId) return false
    const hidden = loggedUser.emailLineHiddenTodayByProject?.[projectId]
    return !!hidden && hidden === getEmailLineTodayKey(loggedUser)
}

// Account-level variant: the unified line collapses only when EVERY listed connection
// is hidden for today.
export function areEmailLineConnectionsHiddenToday(loggedUser = {}, connectionIds = []) {
    if (!connectionIds.length) return false
    const todayKey = getEmailLineTodayKey(loggedUser)
    return connectionIds.every(connectionId => loggedUser.emailLineHiddenTodayByConnection?.[connectionId] === todayKey)
}

// Chips are already provider-sorted server-side (Inbox first, then Alldone/*,
// then alphabetical). Split into visible + overflow for the "+N" toggle.
export function splitChipsForDisplay(labels = [], showAll = false) {
    const safeLabels = Array.isArray(labels) ? labels : []
    if (showAll || safeLabels.length <= MAX_VISIBLE_CHIPS) {
        return { visible: safeLabels, overflowCount: 0 }
    }
    return {
        visible: safeLabels.slice(0, MAX_VISIBLE_CHIPS),
        overflowCount: safeLabels.length - MAX_VISIBLE_CHIPS,
    }
}

function buildGmailLabelUrl(emailAddress, label) {
    const base = 'https://mail.google.com/mail/u/0/'
    let fragment
    if (label.labelId === 'INBOX' || label.kind === 'inbox') {
        fragment = '#inbox'
    } else {
        const query = /\s/.test(label.name) ? `label:"${label.name}"` : `label:${label.name}`
        fragment = `#search/${encodeURIComponent(query)}`
    }
    const continueUrl = `${base}${fragment}`
    if (!emailAddress) return continueUrl
    return `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(
        emailAddress
    )}&continue=${encodeURIComponent(continueUrl)}&service=mail`
}

// Interim/fallback destination for a label: open the provider webmail focused
// on that label/folder in a new tab.
export function getLabelWebUrl(provider, emailAddress, label) {
    if (!label) return null
    if (provider === 'microsoft') {
        return 'https://outlook.office.com/mail/'
    }
    return buildGmailLabelUrl(emailAddress, label)
}

export function openUrlInNewTab(url) {
    if (!url) return
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.open) {
        window.open(url, '_blank')
        return
    }
    Linking.openURL(url).catch(() => {})
}
