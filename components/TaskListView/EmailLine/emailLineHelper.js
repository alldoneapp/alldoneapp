import { Linking, Platform } from 'react-native'

import { getOkrAllProjectsTodayKey, getOkrUserTimezone } from '../OKRs/okrHelper'

export const MAX_VISIBLE_CHIPS = 8

// Today key for the "Done for today" behavior. Reuses the OKR timezone-aware
// day key so the email line hides/resets on the same daily boundary as OKRs.
export function getEmailLineTodayKey(loggedUser = {}) {
    return getOkrAllProjectsTodayKey(undefined, getOkrUserTimezone(loggedUser))
}

// The unified line collapses only when EVERY listed connection is hidden for today.
export function areEmailLineConnectionsHiddenToday(loggedUser = {}, connectionIds = []) {
    if (!connectionIds.length) return false
    const todayKey = getEmailLineTodayKey(loggedUser)
    return connectionIds.every(connectionId => loggedUser.emailLineHiddenTodayByConnection?.[connectionId] === todayKey)
}

// The number a chip displays: threads currently in the inbox with that label
// (read or unread). Falls back to the unread count for summaries produced by
// an older server version that doesn't send threadCount yet.
export function getLabelDisplayCount(label = {}) {
    return Number.isFinite(label.threadCount) ? label.threadCount : Number(label.unreadCount || 0)
}

// Merges the labels of all connected accounts into one chip list, grouped
// case-insensitively by display name (both accounts' "Inbox" become one chip
// summing their counts). Each group keeps per-account entries so the modal and
// its actions can route to the right connection.
export function mergeLabelsAcrossConnections(connections = [], summariesByKey = {}) {
    const groups = new Map()
    connections.forEach(connection => {
        const summary = summariesByKey[connection.connectionId]
        if (!summary || summary.authExpired || connection.authInvalid) return
        ;(summary.labels || []).forEach(label => {
            const displayName = label.displayName || label.name || label.labelId
            if (!displayName) return
            const key = String(displayName).toLowerCase()
            let group = groups.get(key)
            if (!group) {
                group = {
                    key,
                    displayName,
                    isInbox: false,
                    threadCount: 0,
                    unreadCount: 0,
                    sweeping: false,
                    entries: [],
                }
                groups.set(key, group)
            }
            group.threadCount += getLabelDisplayCount(label)
            group.unreadCount += Number(label.unreadCount || 0)
            if (label.sweeping) group.sweeping = true
            if (label.kind === 'inbox' || label.labelId === 'INBOX') group.isInbox = true
            group.entries.push({
                connectionId: connection.connectionId,
                provider: connection.provider || summary.provider || '',
                emailAddress: summary.emailAddress || connection.email || '',
                labelId: label.labelId,
                label,
            })
        })
    })
    return [...groups.values()].sort((a, b) => {
        if (a.isInbox !== b.isInbox) return a.isInbox ? -1 : 1
        return a.displayName.localeCompare(b.displayName)
    })
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
