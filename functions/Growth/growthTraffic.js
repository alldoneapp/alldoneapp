'use strict'

// Traffic for the growth scoreboard, from Google Analytics 4.
//
// No property id is configured anywhere: the run asks the Analytics Admin API which GA4 properties
// its own service account (the Firebase Admin SDK account the Functions run as) may read, and
// reports each of them. Giving that account the Viewer role on a property is therefore the whole
// setup, and taking it away switches the section off. Until then the section says what is missing
// instead of failing the run.
//
// GA4 only sees visitors who consented to analytics, so its numbers are a fraction of real
// traffic. To make that fraction visible, the run also counts the `sign_up` events GA saw (the
// app maps its own `new_user` event to GA's `sign_up`, utils/analytics/analytics.js) and sets them
// against the real signups from Firebase Auth: that ratio is the share of traffic GA can see.
// GA reports days in the property's own time zone; the rest of the scoreboard uses UTC days.

const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly']
const SIGNUP_EVENT_NAMES = ['sign_up']
const MAX_PROPERTIES = 5
const MAX_REPORT_ROWS = 250
const MAX_LABEL_LENGTH = 60
const MAX_KEYS = 30

const sanitizeLabel = value =>
    String(value === undefined || value === null ? '' : value)
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .toLowerCase()
        .slice(0, MAX_LABEL_LENGTH) || '(not set)'

function topEntries(counts) {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    if (entries.length <= MAX_KEYS) return Object.fromEntries(entries)
    const rest = entries.slice(MAX_KEYS - 1).reduce((sum, [, value]) => sum + value, 0)
    return Object.fromEntries([...entries.slice(0, MAX_KEYS - 1), ['other', rest]])
}

// The production client: googleapis' per-API modules (loading all of googleapis takes seconds).
function createAnalyticsClient() {
    const { GoogleAuth } = require('google-auth-library')
    const { analyticsadmin } = require('googleapis/build/src/apis/analyticsadmin')
    const { analyticsdata } = require('googleapis/build/src/apis/analyticsdata')
    const auth = new GoogleAuth({ scopes: SCOPES })
    const adminApi = analyticsadmin({ version: 'v1beta', auth })
    const dataApi = analyticsdata({ version: 'v1beta', auth })
    return {
        async listProperties() {
            const response = await adminApi.accountSummaries.list({ pageSize: 50 })
            const summaries = (response.data && response.data.accountSummaries) || []
            return summaries.flatMap(account =>
                (account.propertySummaries || []).map(property => ({
                    property: property.property,
                    displayName: property.displayName || property.property,
                }))
            )
        },
        async runReport(property, requestBody) {
            const response = await dataApi.properties.runReport({ property, requestBody })
            return response.data || {}
        },
    }
}

const metricValue = (row, index) => Number(((row.metricValues || [])[index] || {}).value) || 0
const dimensionValue = (row, index) => ((row.dimensionValues || [])[index] || {}).value

// One property's day: sessions, users and new users by host, by "source / medium" and by campaign,
// plus the signup events it recorded.
function summarizePropertyReports(trafficReport = {}, signupReport = {}) {
    const byHost = {}
    const bySourceMedium = {}
    const byCampaign = {}
    let sessions = 0
    let users = 0
    let newUsers = 0
    ;(trafficReport.rows || []).forEach(row => {
        const rowSessions = metricValue(row, 0)
        sessions += rowSessions
        users += metricValue(row, 1)
        newUsers += metricValue(row, 2)
        const host = sanitizeLabel(dimensionValue(row, 0))
        const sourceMedium = `${sanitizeLabel(dimensionValue(row, 1))} / ${sanitizeLabel(dimensionValue(row, 2))}`
        const campaign = sanitizeLabel(dimensionValue(row, 3))
        byHost[host] = (byHost[host] || 0) + rowSessions
        bySourceMedium[sourceMedium] = (bySourceMedium[sourceMedium] || 0) + rowSessions
        if (campaign !== '(not set)' && campaign !== '(direct)' && campaign !== '(organic)') {
            byCampaign[campaign] = (byCampaign[campaign] || 0) + rowSessions
        }
    })
    const signupEvents = (signupReport.rows || []).reduce((sum, row) => sum + metricValue(row, 0), 0)
    return {
        sessions,
        users,
        newUsers,
        signupEvents,
        byHost: topEntries(byHost),
        bySourceMedium: topEntries(bySourceMedium),
        byCampaign: topEntries(byCampaign),
        // GA caps a report; a truncated report undercounts the long tail, never the totals' rows shown.
        truncated: Number(trafficReport.rowCount) > (trafficReport.rows || []).length,
    }
}

async function readTraffic({ day, signups, client }) {
    let analytics = client
    let properties
    try {
        analytics = analytics || createAnalyticsClient()
        properties = await analytics.listProperties()
    } catch (error) {
        return {
            connected: false,
            reason: `Google Analytics could not be read (${String(error.message || error).slice(0, 200)}). Enable the Google Analytics Admin and Data APIs and give the Functions service account the Viewer role on the GA4 property.`,
        }
    }
    if (!properties.length) {
        return {
            connected: false,
            reason: 'The Functions service account has no access to any GA4 property yet. Give it the Viewer role on the property.',
        }
    }

    const result = { connected: true, properties: [], sessions: 0, users: 0, newUsers: 0, signupEvents: 0 }
    for (const { property, displayName } of properties.slice(0, MAX_PROPERTIES)) {
        try {
            const dateRanges = [{ startDate: day, endDate: day }]
            const [trafficReport, signupReport] = await Promise.all([
                analytics.runReport(property, {
                    dateRanges,
                    dimensions: [
                        { name: 'hostName' },
                        { name: 'sessionSource' },
                        { name: 'sessionMedium' },
                        { name: 'sessionCampaignName' },
                    ],
                    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }],
                    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
                    limit: MAX_REPORT_ROWS,
                }),
                analytics.runReport(property, {
                    dateRanges,
                    dimensions: [{ name: 'eventName' }],
                    metrics: [{ name: 'eventCount' }],
                    dimensionFilter: {
                        filter: { fieldName: 'eventName', inListFilter: { values: SIGNUP_EVENT_NAMES } },
                    },
                }),
            ])
            const summary = summarizePropertyReports(trafficReport, signupReport)
            result.properties.push({ name: sanitizeLabel(displayName), ...summary })
            result.sessions += summary.sessions
            result.users += summary.users
            result.newUsers += summary.newUsers
            result.signupEvents += summary.signupEvents
        } catch (error) {
            result.properties.push({
                name: sanitizeLabel(displayName),
                error: String(error.message || error).slice(0, 200),
            })
        }
    }
    // The share of real signups GA saw: roughly the share of all traffic it can see.
    const realSignups = Number(signups) || 0
    result.visibleShare =
        realSignups > 0 ? Math.min(1, Math.round((result.signupEvents / realSignups) * 100) / 100) : null
    return result
}

module.exports = { SIGNUP_EVENT_NAMES, summarizePropertyReports, readTraffic, sanitizeLabel }
