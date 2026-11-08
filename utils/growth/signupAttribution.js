// Where a new account came from (growth scoreboard).
//
// The landing URL is only visible in the browser, and a Google redirect sign-in reloads the page
// before the account exists, so the campaign labels of the FIRST page load of a tab are kept in
// sessionStorage until signup and then written once to users/{uid}/private/signupAttribution.
// Nothing is stored for a visit that carries no signal (no campaign parameter, no click id, no
// external referrer), and nothing identifying is ever kept: campaign labels, the referring host
// (never the full referring URL), the landing path (never its query) and which ad network a click
// came from (never the click id itself). The server re-sanitises everything it reads, since the
// owner can write that document; `functions/Growth/signupAttributionModel.js` is the other half.

export const SIGNUP_ATTRIBUTION_STORAGE_KEY = 'alldone.signupAttribution.v1'
export const SIGNUP_ATTRIBUTION_VERSION = 1

const MAX_LABEL_LENGTH = 80
const MAX_PATH_LENGTH = 200

const UTM_FIELDS = [
    ['utm_source', 'utmSource'],
    ['utm_medium', 'utmMedium'],
    ['utm_campaign', 'utmCampaign'],
    ['utm_content', 'utmContent'],
    ['utm_term', 'utmTerm'],
]

// Presence only: the ids themselves are personal data and are never kept.
const CLICK_ID_SOURCES = [
    ['gclid', 'google_ads'],
    ['gbraid', 'google_ads'],
    ['wbraid', 'google_ads'],
    ['fbclid', 'meta_ads'],
    ['li_fat_id', 'linkedin_ads'],
    ['msclkid', 'microsoft_ads'],
]

// The app's own hosts and sign-in providers are not where somebody came from: a Google redirect
// sign-in comes back with accounts.google.com as its referrer.
const IGNORED_REFERRER_HOSTS = [
    'my.alldone.app',
    'alldonealeph.web.app',
    'alldonealeph.firebaseapp.com',
    'alldonestaging.web.app',
    'alldonestaging.firebaseapp.com',
    'localhost',
    '127.0.0.1',
    'accounts.google.com',
    'login.microsoftonline.com',
    'login.live.com',
    'appleid.apple.com',
]

export const sanitizeAttributionLabel = value => {
    if (typeof value !== 'string') return ''
    return value
        .trim()
        .toLowerCase()
        .replace(/[\s+]+/g, '-')
        .replace(/[^a-z0-9._-]/g, '')
        .slice(0, MAX_LABEL_LENGTH)
}

const sanitizePath = pathname => {
    if (typeof pathname !== 'string' || !pathname.startsWith('/')) return '/'
    return pathname.replace(/[^A-Za-z0-9/._~@-]/g, '').slice(0, MAX_PATH_LENGTH) || '/'
}

const isIgnoredReferrerHost = host =>
    IGNORED_REFERRER_HOSTS.some(ignored => host === ignored || host.endsWith(`.${ignored}`)) ||
    host.endsWith('.web.app') ||
    host.endsWith('.firebaseapp.com')

export const getReferrerHost = referrer => {
    if (typeof referrer !== 'string' || !referrer) return ''
    try {
        const { hostname, protocol } = new URL(referrer)
        if (protocol !== 'http:' && protocol !== 'https:') return ''
        const host = hostname.toLowerCase().replace(/^www\./, '')
        if (!host || isIgnoredReferrerHost(host)) return ''
        return sanitizeAttributionLabel(host)
    } catch (error) {
        return ''
    }
}

export const buildLandingAttribution = ({ href, referrer, now = Date.now() } = {}) => {
    let url = null
    try {
        url = new URL(href)
    } catch (error) {
        url = null
    }
    const params = url ? url.searchParams : new URLSearchParams()

    const record = {
        version: SIGNUP_ATTRIBUTION_VERSION,
        utmSource: '',
        utmMedium: '',
        utmCampaign: '',
        utmContent: '',
        utmTerm: '',
        ref: sanitizeAttributionLabel(params.get('ref') || params.get('via') || ''),
        clickSource: '',
        referrerHost: getReferrerHost(referrer),
        landingPath: sanitizePath(url ? url.pathname : '/'),
        capturedAt: now,
    }
    UTM_FIELDS.forEach(([param, field]) => {
        record[field] = sanitizeAttributionLabel(params.get(param) || '')
    })
    const click = CLICK_ID_SOURCES.find(([param]) => params.has(param))
    if (click) record.clickSource = click[1]
    return record
}

export const hasAttributionSignal = record =>
    !!record &&
    !!(
        record.utmSource ||
        record.utmMedium ||
        record.utmCampaign ||
        record.ref ||
        record.clickSource ||
        record.referrerHost
    )

const getSessionStorage = () => {
    try {
        return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null
    } catch (error) {
        // Storage can throw on access (blocked third-party storage, some private modes).
        return null
    }
}

const readStored = storage => {
    if (!storage) return null
    try {
        const raw = storage.getItem(SIGNUP_ATTRIBUTION_STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' && parsed.version === SIGNUP_ATTRIBUTION_VERSION ? parsed : null
    } catch (error) {
        return null
    }
}

// Called once at module load of the app, before any routing rewrites the address bar.
// First touch of the tab wins, so the return from a redirect sign-in cannot replace it.
export const captureLandingAttribution = ({
    storage = getSessionStorage(),
    href = typeof window !== 'undefined' ? window.location.href : '',
    referrer = typeof document !== 'undefined' ? document.referrer : '',
    now = Date.now(),
} = {}) => {
    if (!storage || readStored(storage)) return null
    const record = buildLandingAttribution({ href, referrer, now })
    if (!hasAttributionSignal(record)) return null
    try {
        storage.setItem(SIGNUP_ATTRIBUTION_STORAGE_KEY, JSON.stringify(record))
    } catch (error) {
        return null
    }
    return record
}

// What a new account records: the captured first touch, or a direct visit to the path the
// signup started from. Always a record, so the scoreboard can tell "came directly" from an
// account created before attribution existed.
export const getSignupAttribution = ({ initialUrl = '/', storage = getSessionStorage(), now = Date.now() } = {}) => {
    const stored = readStored(storage)
    if (stored) return { ...stored, recordedAt: now }
    const path = typeof initialUrl === 'string' ? initialUrl.split('?')[0] : '/'
    return {
        ...buildLandingAttribution({ href: `https://my.alldone.app${sanitizePath(path)}`, referrer: '', now }),
        recordedAt: now,
    }
}

export const clearSignupAttribution = (storage = getSessionStorage()) => {
    if (!storage) return
    try {
        storage.removeItem(SIGNUP_ATTRIBUTION_STORAGE_KEY)
    } catch (error) {
        // Nothing to clean up if storage is unavailable.
    }
}
