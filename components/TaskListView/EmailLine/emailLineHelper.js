import { Linking, Platform } from 'react-native'

import { getOkrAllProjectsTodayKey, getOkrUserTimezone } from '../OKRs/okrHelper'

export const MAX_VISIBLE_CHIPS = 8
export const EMAIL_LINE_NO_LABEL_ID = '__NO_LABEL__'

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
// case-insensitively by display name. The Inbox chip is an aggregate of the
// surfaced label buckets, so its count visually equals the other chips added up.
// Each group keeps per-account entries so the modal and its actions can route to
// the right connection.
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
                    projectId: null,
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
            // The Alldone project this label maps to (default-mode project labels only). The
            // server stamps it via the labeling config; the first account that carries it wins.
            if (!group.projectId && label.projectId) group.projectId = label.projectId
            group.entries.push({
                connectionId: connection.connectionId,
                provider: connection.provider || summary.provider || '',
                emailAddress: summary.emailAddress || connection.email || '',
                labelId: label.labelId,
                label,
            })
        })
    })
    const mergedGroups = [...groups.values()]
    const inboxGroup = mergedGroups.find(group => group.isInbox)
    if (inboxGroup) {
        const labelGroups = mergedGroups.filter(group => !group.isInbox)
        inboxGroup.threadCount = labelGroups.reduce((total, group) => total + group.threadCount, 0)
        inboxGroup.unreadCount = labelGroups.reduce((total, group) => total + group.unreadCount, 0)
        inboxGroup.sweeping = inboxGroup.sweeping || labelGroups.some(group => group.sweeping)
        inboxGroup.entries = labelGroups.flatMap(group => group.entries)
    }

    return mergedGroups.sort((a, b) => {
        if (a.isInbox !== b.isInbox) return a.isInbox ? -1 : 1
        return a.displayName.localeCompare(b.displayName)
    })
}

// A merged group is worth a chip when it has inbox threads (or is mid-sweep with an
// optimistically-zeroed count). The Inbox aggregate is excluded here — it belongs only to the
// standalone Email line, not the per-project/all-projects header chips.
function isChipWorthy(group) {
    return !group.isInbox && (group.threadCount > 0 || group.sweeping)
}

// The label chips that belong to a specific project's header line: labels the server mapped to
// this project via its labeling config (default-mode project labels).
export function getEmailLabelGroupsForProject(groups = [], projectId) {
    if (!projectId) return []
    return groups.filter(group => isChipWorthy(group) && group.projectId === projectId)
}

// The label chips that belong to the "All Projects" header line: everything not tied to a
// project — Ads, No label, and any custom/unmapped label.
export function getUnassignedEmailLabelGroups(groups = []) {
    return groups.filter(group => isChipWorthy(group) && !group.projectId)
}

// Per-connection maps the label modal needs: the full set of move-target labels and whether
// labeling is disabled for that account. Shared by the standalone Email line and the header
// chips so both feed EmailLabelChip the same props.
export function buildLabelOptionMaps(connections = [], summariesByKey = {}) {
    const labelOptionsByConnectionId = {}
    const labelingDisabledByConnectionId = {}
    connections.forEach(connection => {
        const summary = summariesByKey[connection.connectionId]
        labelOptionsByConnectionId[connection.connectionId] = (summary?.labelOptions || [])
            .map(option =>
                typeof option === 'string'
                    ? { gmailLabelName: option, displayName: option }
                    : { gmailLabelName: option?.gmailLabelName, displayName: option?.displayName }
            )
            .filter(option => option.gmailLabelName && option.displayName)
        labelingDisabledByConnectionId[connection.connectionId] =
            !!summary && connection.provider !== 'microsoft' && summary.labelingEnabled === false
    })
    return { labelOptionsByConnectionId, labelingDisabledByConnectionId }
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
    } else if (label.labelId === EMAIL_LINE_NO_LABEL_ID || label.kind === 'no_label') {
        fragment = `#search/${encodeURIComponent('in:inbox has:nouserlabels')}`
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

function buildGmailAccountUrl(emailAddress) {
    const continueUrl = 'https://mail.google.com/mail/u/0/'
    if (!emailAddress) return continueUrl
    return `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(
        emailAddress
    )}&continue=${encodeURIComponent(continueUrl)}&service=mail`
}

export function getEmailAccountWebUrl(provider, emailAddress) {
    if (provider === 'microsoft') {
        return 'https://outlook.office.com/mail/'
    }
    return buildGmailAccountUrl(emailAddress)
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

// react-tiny-popover v4 fires a popover's onClickOutside on any window click whose target isn't
// inside THAT popover's own portal. The label-options dropdown is a nested popover rendered in its
// own document.body portal, so tapping an option counts as "outside" the parent label modal and
// dismisses it. On mobile a single tap produces the touch press (which selects the label) and then
// a synthesized `click` shortly after — and it is that trailing click that reaches the modal's
// window listener. EmailRow stamps an interaction on the option press (which always runs before the
// trailing click); the modal's onClickOutside then swallows the NEXT dismiss ONCE.
//
// Consume-once (not a fixed time window) so we don't depend on how far apart the tap and click
// land: the one dismiss caused by the option tap is ignored, and a stamp whose dismiss never
// arrives (e.g. desktop, where the press stops the click from bubbling to window) is invalidated by
// a generous sanity cap so it can't later swallow a genuine outside tap.
const EMAIL_LABEL_PICKER_GUARD_MS = 2000
let emailLabelPickerInteractionAt = 0
export function markEmailLabelPickerInteraction() {
    emailLabelPickerInteractionAt = Date.now()
}
export function shouldIgnoreEmailLabelModalDismiss() {
    if (!emailLabelPickerInteractionAt) return false
    const elapsed = Date.now() - emailLabelPickerInteractionAt
    emailLabelPickerInteractionAt = 0 // consume: swallow at most one dismiss per label pick
    return elapsed < EMAIL_LABEL_PICKER_GUARD_MS
}
