'use strict'

const { getAccessToken } = require('../MicrosoftOAuth/microsoftOAuthHandler')

if (!global.fetch) require('isomorphic-fetch')
const fetchImpl = global.fetch
const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'

function encodePath(value = '') {
    return encodeURIComponent(String(value || ''))
}

function buildQuery(params = {}) {
    const query = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return
        query.set(key, String(value))
    })
    const text = query.toString()
    return text ? `?${text}` : ''
}

async function graphRequest(accessToken, path, options = {}) {
    const response = await fetchImpl(`${GRAPH_ROOT}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            Prefer: 'outlook.body-content-type="text"',
            ...(options.headers || {}),
        },
    })

    if (response.status === 204) return null
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data.error?.message || `Microsoft Graph request failed: ${response.status}`)
    }
    return data
}

async function getMicrosoftGraphClient(userId, projectId, service) {
    const accessToken = await getAccessToken(userId, projectId, service)
    return {
        request: (path, options) => graphRequest(accessToken, path, options),
    }
}

module.exports = {
    buildQuery,
    encodePath,
    getMicrosoftGraphClient,
    graphRequest,
}
