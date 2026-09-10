import moment from 'moment'

import {
    CONNECTION_SERVICE_CALENDAR,
    listCalendarConnections,
    listEmailConnections,
} from '../../../utils/IntegrationProviders'

// A connected account whose OAuth grant is dead. The server flags this on the user
// document (`emailConnections.<id>.authInvalid`) the moment a refresh returns
// `invalid_grant` — a revoked grant, a changed password, a removed third-party app
// access, or 6 months of Google's unused-refresh-token expiry.
//
// Until AT-2491 this was invisible on the client: `mapUserData` did not carry the
// connection maps at all, so `listConnections` always fell back to synthesizing from the
// legacy `apisConnected` shape, which hardcodes `authInvalid: false`. The account went on
// looking perfectly healthy while every Gmail read, label sweep and email-line summary
// silently failed.
export function isConnectionBroken(connection) {
    return connection?.authInvalid === true
}

// Every broken account across both services, in the order the settings page renders them.
export function listBrokenConnections(loggedUser = {}) {
    return [...listEmailConnections(loggedUser), ...listCalendarConnections(loggedUser)].filter(isConnectionBroken)
}

// Drives the attention badge on the Settings > Integrations tab. A user who never opens
// that tab has no other reason to look, so the count is the only thing that says "one of
// your accounts stopped working".
export function countBrokenConnections(loggedUser = {}) {
    return listBrokenConnections(loggedUser).length
}

// What actually stopped working, so the card explains the consequence rather than just
// naming the failure. Returns a translation key.
export function getBreakageConsequenceKey(service) {
    return service === CONNECTION_SERVICE_CALENDAR
        ? 'ConnectionBrokenCalendarConsequence'
        : 'ConnectionBrokenEmailConsequence'
}

// `authInvalidAt` is 0 for every connection flagged before AT-2491 started recording it,
// and for a legacy connection synthesized from `apisConnected`. Absent is not the epoch:
// the caller renders no "since" line at all rather than "since 1 Jan 1970".
export function formatBrokenSince(authInvalidAt, now = Date.now()) {
    if (!authInvalidAt || !Number.isFinite(authInvalidAt)) return null
    // A timestamp in the future is a clock skew, not information worth showing.
    if (authInvalidAt > now) return null
    return moment(authInvalidAt).format('MMM D, YYYY')
}

// Whole days the account has been dead, for the "· 4 days" hint next to the date. Same
// unknown-vs-zero rule as above.
export function brokenForDays(authInvalidAt, now = Date.now()) {
    if (!authInvalidAt || !Number.isFinite(authInvalidAt) || authInvalidAt > now) return null
    return Math.floor((now - authInvalidAt) / (24 * 60 * 60 * 1000))
}
