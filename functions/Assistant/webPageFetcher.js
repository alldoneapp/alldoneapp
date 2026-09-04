'use strict'

// Reads a public web page for the assistant's `fetch_url` tool and reduces it to what a model can
// use: title, description, a social image, readable text and the outgoing links.
//
// Two rules are deliberate and worth keeping:
//
// - LinkedIn is refused up front. Profile pages sit behind a login wall and answer a datacenter IP
//   with a redirect or a 999; letting the tool try costs a round trip and teaches the model that the
//   page "could not be read" for reasons it then tries to work around. The contact enrichment prompt
//   sends the model to search-engine snippets for LinkedIn instead.
// - Private and link-local addresses are refused too. The fetch runs inside the Cloud Functions
//   network, and a model-authored URL must not be able to point it at the metadata server or an
//   internal service.

const DEFAULT_TIMEOUT_MS = 10000
const MAX_HTML_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_TEXT_CHARS = 12000
const MAX_LINKS = 60
const MAX_IMAGES = 10
const USER_AGENT = 'Mozilla/5.0 (compatible; AlldoneBot/1.0; +https://alldone.app)'
const THIN_PAGE_TEXT_CHARS = 200

const BLOCKED_HOST_PATTERNS = [/(^|\.)linkedin\.com$/i, /(^|\.)licdn\.com$/i]
const PRIVATE_HOST_PATTERNS = [
    /^localhost$/i,
    /\.local$/i,
    /\.internal$/i,
    /^127\./,
    /^10\./,
    /^0\./,
    /^169\.254\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^\[?::1\]?$/,
    /^metadata\.google\.internal$/i,
]

const HTML_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    copy: '©',
    reg: '®',
    trade: '™',
    laquo: '«',
    raquo: '»',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    bull: '•',
    middot: '·',
    eacute: 'é',
    egrave: 'è',
    auml: 'ä',
    ouml: 'ö',
    uuml: 'ü',
    Auml: 'Ä',
    Ouml: 'Ö',
    Uuml: 'Ü',
    szlig: 'ß',
    ntilde: 'ñ',
    ccedil: 'ç',
    aacute: 'á',
    iacute: 'í',
    oacute: 'ó',
    uacute: 'ú',
}

function decodeHtmlEntities(text = '') {
    return String(text)
        .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
            const codePoint = parseInt(hex, 16)
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
        })
        .replace(/&#(\d+);/g, (match, dec) => {
            const codePoint = parseInt(dec, 10)
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
        })
        .replace(/&([a-z]+);/gi, (match, name) => (HTML_ENTITIES[name] !== undefined ? HTML_ENTITIES[name] : match))
}

function normalizeWhitespace(text = '') {
    return String(text)
        .replace(/\r/g, '')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function isFetchableUrl(rawUrl) {
    const value = typeof rawUrl === 'string' ? rawUrl.trim() : ''
    if (!value) return { ok: false, reason: 'A URL is required.' }

    let parsed
    try {
        // Only a bare host gets a scheme; `ftp://…` must stay `ftp://` so it is refused below.
        parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`)
    } catch (error) {
        return { ok: false, reason: 'The URL could not be parsed.' }
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, reason: 'Only http and https URLs can be fetched.' }
    }

    const hostname = parsed.hostname
    if (BLOCKED_HOST_PATTERNS.some(pattern => pattern.test(hostname))) {
        return {
            ok: false,
            reason: 'LinkedIn pages cannot be fetched (they require a login). Use web_search and rely on the search result title and snippet instead.',
            blockedHost: true,
        }
    }
    if (PRIVATE_HOST_PATTERNS.some(pattern => pattern.test(hostname))) {
        return { ok: false, reason: 'Private or internal addresses cannot be fetched.' }
    }

    return { ok: true, url: parsed.toString() }
}

function resolveUrl(href, baseUrl) {
    try {
        return new URL(href, baseUrl).toString()
    } catch (error) {
        return null
    }
}

function readAttribute(tag, name) {
    const pattern = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
    const match = pattern.exec(tag)
    if (!match) return ''
    return decodeHtmlEntities(match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] || '')
}

function readMetaContent(html, key, value) {
    const metaTags = html.match(/<meta\b[^>]*>/gi) || []
    for (const tag of metaTags) {
        const attr = readAttribute(tag, key)
        if (attr && attr.toLowerCase() === value.toLowerCase()) {
            const content = readAttribute(tag, 'content').trim()
            if (content) return content
        }
    }
    return ''
}

function readLinkHref(html, relValue) {
    const linkTags = html.match(/<link\b[^>]*>/gi) || []
    for (const tag of linkTags) {
        const rel = readAttribute(tag, 'rel')
        if (rel && rel.toLowerCase().split(/\s+/).includes(relValue.toLowerCase())) {
            const href = readAttribute(tag, 'href').trim()
            if (href) return href
        }
    }
    return ''
}

function htmlToText(html) {
    let text = String(html)
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|svg|template|iframe|canvas)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(
            /<\/?(p|div|section|article|header|footer|main|nav|aside|h[1-6]|li|ul|ol|tr|td|th|table|blockquote|pre|dd|dt|dl|figure|figcaption|address)\b[^>]*>/gi,
            '\n'
        )
        .replace(/<[^>]+>/g, ' ')
    text = decodeHtmlEntities(text)
    return normalizeWhitespace(text)
}

function extractLinks(html, baseUrl) {
    const links = []
    const seen = new Set()
    const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
    let match
    while ((match = anchorPattern.exec(html)) !== null && links.length < MAX_LINKS) {
        const href = readAttribute(match[1], 'href').trim()
        if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) continue
        const absolute = resolveUrl(href, baseUrl)
        if (!absolute || seen.has(absolute)) continue
        seen.add(absolute)
        const label = normalizeWhitespace(htmlToText(match[2])).replace(/\n+/g, ' ').slice(0, 120)
        links.push({ url: absolute, text: label })
    }
    return links
}

function extractImages(html, baseUrl) {
    const images = []
    const seen = new Set()
    const imgPattern = /<img\b[^>]*>/gi
    let match
    while ((match = imgPattern.exec(html)) !== null && images.length < MAX_IMAGES) {
        const tag = match[0]
        const src = readAttribute(tag, 'src').trim() || readAttribute(tag, 'data-src').trim()
        if (!src || /^data:/i.test(src)) continue
        const absolute = resolveUrl(src, baseUrl)
        if (!absolute || seen.has(absolute)) continue
        seen.add(absolute)
        images.push({ url: absolute, alt: readAttribute(tag, 'alt').trim().slice(0, 120) })
    }
    return images
}

function extractPageContent(html, baseUrl, { maxChars = DEFAULT_MAX_TEXT_CHARS } = {}) {
    const source = typeof html === 'string' ? html : ''
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source)
    const title = titleMatch ? normalizeWhitespace(decodeHtmlEntities(titleMatch[1])).replace(/\n+/g, ' ') : ''

    const description =
        readMetaContent(source, 'name', 'description') ||
        readMetaContent(source, 'property', 'og:description') ||
        readMetaContent(source, 'name', 'twitter:description')

    const ogImageRaw =
        readMetaContent(source, 'property', 'og:image') ||
        readMetaContent(source, 'property', 'og:image:url') ||
        readMetaContent(source, 'name', 'twitter:image') ||
        readLinkHref(source, 'image_src')
    const ogImage = ogImageRaw ? resolveUrl(ogImageRaw, baseUrl) : null

    const canonicalRaw = readLinkHref(source, 'canonical')
    const canonicalUrl = canonicalRaw ? resolveUrl(canonicalRaw, baseUrl) : null

    const fullText = htmlToText(source)
    const truncated = fullText.length > maxChars
    const text = truncated ? fullText.slice(0, maxChars) : fullText

    return {
        title,
        description,
        ogImage,
        canonicalUrl,
        text,
        truncated,
        links: extractLinks(source, baseUrl),
        images: extractImages(source, baseUrl),
    }
}

function isHtmlContentType(contentType = '') {
    const value = String(contentType || '').toLowerCase()
    return !value || value.includes('text/html') || value.includes('application/xhtml')
}

function isTextContentType(contentType = '') {
    const value = String(contentType || '').toLowerCase()
    return value.includes('text/plain') || value.includes('text/markdown') || value.includes('application/json')
}

async function readBodyWithLimit(response, maxBytes) {
    const buffer = Buffer.from(await response.arrayBuffer())
    const limited = buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer
    return { body: limited.toString('utf8'), bytesTruncated: buffer.length > maxBytes }
}

async function fetchDirect(url, { fetchImpl, timeoutMs }) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetchImpl(url, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
                'Accept-Language': 'en,de;q=0.8,es;q=0.7',
            },
            signal: controller.signal,
        })
        const contentType = response.headers?.get ? response.headers.get('content-type') || '' : ''
        const finalUrl = response.url || url
        if (!response.ok) {
            return { ok: false, status: response.status, finalUrl, contentType }
        }
        if (!isHtmlContentType(contentType) && !isTextContentType(contentType)) {
            return { ok: false, status: response.status, finalUrl, contentType, unsupportedContentType: true }
        }
        const { body, bytesTruncated } = await readBodyWithLimit(response, MAX_HTML_BYTES)
        return { ok: true, status: response.status, finalUrl, contentType, body, bytesTruncated }
    } finally {
        clearTimeout(timer)
    }
}

async function fetchViaTavily(url, { tavilyApiKey, tavilyClientFactory }) {
    const factory =
        tavilyClientFactory ||
        (apiKey => {
            const { tavily } = require('@tavily/core')
            return tavily({ apiKey })
        })
    const client = factory(tavilyApiKey)
    const response = await client.extract([url], { extractDepth: 'basic', format: 'text', includeImages: true })
    const result = Array.isArray(response?.results) ? response.results[0] : null
    if (!result || typeof result.rawContent !== 'string' || !result.rawContent.trim()) {
        const failure = Array.isArray(response?.failedResults) ? response.failedResults[0] : null
        throw new Error(failure?.error || 'Tavily returned no content for the page')
    }
    return {
        title: result.title || '',
        text: result.rawContent,
        images: Array.isArray(result.images)
            ? result.images.slice(0, MAX_IMAGES).map(img => ({ url: img, alt: '' }))
            : [],
    }
}

function isTavilyConfigured(tavilyApiKey) {
    return typeof tavilyApiKey === 'string' && tavilyApiKey.trim() !== '' && !tavilyApiKey.startsWith('your_')
}

/**
 * Fetches a page and returns a model-friendly summary of it. Never throws for a page problem — a
 * failure is reported as `{ success: false, error }` so the model can pick a different source.
 */
async function fetchWebPage(rawUrl, options = {}) {
    const {
        fetchImpl = globalThis.fetch,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        maxChars = DEFAULT_MAX_TEXT_CHARS,
        tavilyApiKey = '',
        tavilyClientFactory = null,
    } = options

    const check = isFetchableUrl(rawUrl)
    if (!check.ok) {
        return { success: false, url: rawUrl, error: check.reason, blockedHost: check.blockedHost === true }
    }
    const url = check.url

    let direct = null
    let directError = null
    try {
        direct = await fetchDirect(url, { fetchImpl, timeoutMs })
    } catch (error) {
        directError = error
    }

    if (direct?.ok) {
        const isHtml = isHtmlContentType(direct.contentType)
        const page = isHtml
            ? extractPageContent(direct.body, direct.finalUrl, { maxChars })
            : {
                  title: '',
                  description: '',
                  ogImage: null,
                  canonicalUrl: null,
                  text: normalizeWhitespace(direct.body).slice(0, maxChars),
                  truncated: direct.body.length > maxChars,
                  links: [],
                  images: [],
              }
        const thin = page.text.length < THIN_PAGE_TEXT_CHARS
        if (!thin || !isTavilyConfigured(tavilyApiKey)) {
            return {
                success: true,
                source: 'direct',
                url,
                finalUrl: direct.finalUrl,
                status: direct.status,
                ...page,
                truncated: page.truncated || direct.bytesTruncated === true,
                note: thin
                    ? 'The page returned very little readable text; it may be rendered by JavaScript.'
                    : undefined,
            }
        }
        // A page that renders through JavaScript reads as empty to a plain fetch; Tavily renders it.
        try {
            const rendered = await fetchViaTavily(url, { tavilyApiKey, tavilyClientFactory })
            const text = normalizeWhitespace(rendered.text)
            return {
                success: true,
                source: 'tavily',
                url,
                finalUrl: direct.finalUrl,
                status: direct.status,
                title: page.title || rendered.title,
                description: page.description,
                ogImage: page.ogImage,
                canonicalUrl: page.canonicalUrl,
                text: text.slice(0, maxChars),
                truncated: text.length > maxChars,
                links: page.links,
                images: page.images.length ? page.images : rendered.images,
            }
        } catch (error) {
            return { success: true, source: 'direct', url, finalUrl: direct.finalUrl, status: direct.status, ...page }
        }
    }

    if (direct?.unsupportedContentType) {
        return {
            success: false,
            url,
            finalUrl: direct.finalUrl,
            status: direct.status,
            error: `The page is not readable text (content-type ${direct.contentType || 'unknown'}).`,
        }
    }

    // Blocked, rate-limited, timed out or network error: try the rendering service before giving up.
    if (isTavilyConfigured(tavilyApiKey)) {
        try {
            const rendered = await fetchViaTavily(url, { tavilyApiKey, tavilyClientFactory })
            const text = normalizeWhitespace(rendered.text)
            return {
                success: true,
                source: 'tavily',
                url,
                finalUrl: direct?.finalUrl || url,
                status: direct?.status || null,
                title: rendered.title,
                description: '',
                ogImage: null,
                canonicalUrl: null,
                text: text.slice(0, maxChars),
                truncated: text.length > maxChars,
                links: [],
                images: rendered.images,
            }
        } catch (error) {
            // fall through to the direct failure below
        }
    }

    if (directError) {
        const timedOut = directError.name === 'AbortError'
        return {
            success: false,
            url,
            error: timedOut
                ? `The page did not respond within ${timeoutMs / 1000}s.`
                : `The page could not be fetched: ${directError.message}`,
        }
    }
    return {
        success: false,
        url,
        finalUrl: direct?.finalUrl || url,
        status: direct?.status || null,
        error: `The page answered with HTTP ${direct?.status}.`,
    }
}

module.exports = {
    DEFAULT_MAX_TEXT_CHARS,
    THIN_PAGE_TEXT_CHARS,
    decodeHtmlEntities,
    extractPageContent,
    fetchWebPage,
    htmlToText,
    isFetchableUrl,
    isTavilyConfigured,
}
