'use strict'

// Finds candidate profile photos for a contact from sources that are free and legitimate to read:
// Gravatar (keyed on the email address), a GitHub account, and the social image (`og:image`) of
// pages the assistant has already identified as being about the person. LinkedIn's own picture is
// deliberately not a source — the profile page cannot be read without a login (see webPageFetcher).
//
// Every source is best-effort: a lookup that fails is reported in `checked` and never throws, so the
// tool can still return the candidates it did find.

const crypto = require('crypto')
const { fetchWebPage, isFetchableUrl } = require('./webPageFetcher')

const MAX_PAGE_URLS = 4
const LOOKUP_TIMEOUT_MS = 8000
const USER_AGENT = 'Mozilla/5.0 (compatible; AlldoneBot/1.0; +https://alldone.app)'

function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

function buildGravatarUrl(email, { size = 400 } = {}) {
    const normalized = normalizeEmail(email)
    if (!normalized || !normalized.includes('@')) return null
    // Gravatar accepts SHA-256 hashes of the lower-cased, trimmed address (MD5 is the legacy form).
    const hash = crypto.createHash('sha256').update(normalized).digest('hex')
    return `https://gravatar.com/avatar/${hash}?s=${size}&d=404`
}

function normalizeGithubUsername(value) {
    let raw = typeof value === 'string' ? value.trim() : ''
    if (!raw) return ''
    const urlMatch = /github\.com\/([A-Za-z0-9-]+)/i.exec(raw)
    if (urlMatch) raw = urlMatch[1]
    raw = raw.replace(/^@/, '')
    return /^[A-Za-z0-9-]{1,39}$/.test(raw) ? raw : ''
}

async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = LOOKUP_TIMEOUT_MS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetchImpl(url, { ...init, signal: controller.signal })
    } finally {
        clearTimeout(timer)
    }
}

function isImageResponse(response) {
    const contentType = response.headers?.get ? response.headers.get('content-type') || '' : ''
    return response.ok && (!contentType || contentType.toLowerCase().startsWith('image/'))
}

async function lookupGravatar(email, { fetchImpl }) {
    const url = buildGravatarUrl(email)
    if (!url) return { source: 'gravatar', skipped: true, reason: 'No email address' }
    try {
        const response = await fetchWithTimeout(fetchImpl, url, {
            method: 'GET',
            headers: { 'User-Agent': USER_AGENT },
        })
        if (isImageResponse(response)) {
            return {
                source: 'gravatar',
                found: true,
                url,
                note: `Gravatar image registered for ${normalizeEmail(email)}`,
            }
        }
        return { source: 'gravatar', found: false, reason: `No Gravatar for this address (HTTP ${response.status})` }
    } catch (error) {
        return { source: 'gravatar', found: false, reason: `Gravatar lookup failed: ${error.message}` }
    }
}

async function lookupGithub(username, { fetchImpl }) {
    const login = normalizeGithubUsername(username)
    if (!login) return { source: 'github', skipped: true, reason: 'No GitHub username' }
    try {
        const response = await fetchWithTimeout(
            fetchImpl,
            `https://api.github.com/users/${encodeURIComponent(login)}`,
            {
                method: 'GET',
                headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
            }
        )
        if (response.ok) {
            const profile = await response.json()
            if (profile && typeof profile.avatar_url === 'string' && profile.avatar_url) {
                return {
                    source: 'github',
                    found: true,
                    url: profile.avatar_url,
                    note: [profile.name, profile.company, profile.location, profile.blog].filter(Boolean).join(' · '),
                    profileUrl: profile.html_url || `https://github.com/${login}`,
                }
            }
        }
        if (response.status === 404) return { source: 'github', found: false, reason: 'GitHub user not found' }
        // The unauthenticated API is rate-limited; the avatar redirect endpoint is not.
        const fallbackUrl = `https://github.com/${login}.png?size=400`
        const fallback = await fetchWithTimeout(fetchImpl, fallbackUrl, {
            method: 'GET',
            headers: { 'User-Agent': USER_AGENT },
        })
        if (isImageResponse(fallback)) {
            return {
                source: 'github',
                found: true,
                url: fallback.url || fallbackUrl,
                profileUrl: `https://github.com/${login}`,
            }
        }
        return { source: 'github', found: false, reason: `GitHub lookup answered HTTP ${response.status}` }
    } catch (error) {
        return { source: 'github', found: false, reason: `GitHub lookup failed: ${error.message}` }
    }
}

async function lookupPageImage(pageUrl, { fetchPage }) {
    const check = isFetchableUrl(pageUrl)
    if (!check.ok) return { source: 'page', pageUrl, found: false, reason: check.reason }
    try {
        const page = await fetchPage(check.url)
        if (!page?.success)
            return { source: 'page', pageUrl: check.url, found: false, reason: page?.error || 'Page not readable' }
        if (page.ogImage) {
            return { source: 'page', pageUrl: check.url, found: true, url: page.ogImage, note: page.title || '' }
        }
        return { source: 'page', pageUrl: check.url, found: false, reason: 'The page declares no social image' }
    } catch (error) {
        return { source: 'page', pageUrl: check.url, found: false, reason: `Page lookup failed: ${error.message}` }
    }
}

/**
 * @param {{ email?: string, githubUsername?: string, pageUrls?: string[] }} input
 * @param {{ fetchImpl?: Function, fetchPage?: Function, tavilyApiKey?: string }} deps
 */
async function findProfilePhotoCandidates(input = {}, deps = {}) {
    const fetchImpl = deps.fetchImpl || globalThis.fetch
    const fetchPage = deps.fetchPage || (url => fetchWebPage(url, { fetchImpl, tavilyApiKey: deps.tavilyApiKey || '' }))
    const pageUrls = (Array.isArray(input.pageUrls) ? input.pageUrls : [])
        .filter(url => typeof url === 'string' && url.trim())
        .slice(0, MAX_PAGE_URLS)

    const lookups = await Promise.all([
        lookupGravatar(input.email, { fetchImpl }),
        lookupGithub(input.githubUsername, { fetchImpl }),
        ...pageUrls.map(url => lookupPageImage(url, { fetchPage })),
    ])

    const candidates = lookups
        .filter(result => result.found)
        .map(result => ({
            url: result.url,
            source: result.source,
            ...(result.pageUrl ? { pageUrl: result.pageUrl } : {}),
            ...(result.profileUrl ? { profileUrl: result.profileUrl } : {}),
            ...(result.note ? { note: result.note } : {}),
        }))

    return {
        success: true,
        candidates,
        checked: lookups.map(result => ({
            source: result.source,
            ...(result.pageUrl ? { pageUrl: result.pageUrl } : {}),
            found: result.found === true,
            ...(result.skipped ? { skipped: true } : {}),
            ...(result.reason ? { reason: result.reason } : {}),
        })),
        note:
            candidates.length === 0
                ? 'No photo found from Gravatar, GitHub or the given pages. Search for a company team page or personal site and try again with its URL, or leave the photo empty.'
                : 'Pick the candidate that clearly shows this person (a page image can be a logo or banner rather than a portrait) and pass its url as photoUrl to update_contact.',
    }
}

module.exports = {
    buildGravatarUrl,
    findProfilePhotoCandidates,
    normalizeGithubUsername,
}
