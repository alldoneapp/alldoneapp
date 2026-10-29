// Activity previews are plain text, and the whole row is already a link to the object, so a URL
// inside a preview cannot be its own link. Show it as a short, readable chip instead of raw text
// (AT-2906). Previews saved before this change may hold a URL cut off by an ellipsis; those are
// described from what survived.
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g
const TRAILING = /[.,;:!?)\]}'"…]+$/

const SERVICES = { 'github.com': 'GitHub', 'gitlab.com': 'GitLab' }

function describePath(service, segments) {
    if (service === 'GitHub') {
        const [, , kind, id] = segments
        if (kind === 'pull' && id) return `PR #${id}`
        if (kind === 'issues' && id) return `Issue #${id}`
        if (kind === 'commit' && id) return `Commit ${id.slice(0, 7)}`
        if (kind === 'actions') return 'Actions'
        return segments.slice(0, 2).join('/')
    }
    if (service === 'GitLab') {
        const marker = segments.indexOf('-')
        const [kind, id] = marker >= 0 ? segments.slice(marker + 1) : []
        if (kind === 'merge_requests' && id) return `MR !${id}`
        if (kind === 'pipelines' && id) return `Pipeline #${id}`
        if (kind === 'jobs' && id) return `Job #${id}`
        if (kind === 'issues' && id) return `Issue #${id}`
        if (kind === 'commit' && id) return `Commit ${id.slice(0, 7)}`
        return (marker >= 0 ? segments.slice(0, marker) : segments).slice(-1)[0] || ''
    }
    return ''
}

export function describeActivityLink(rawUrl) {
    const url = String(rawUrl || '').replace(TRAILING, '')
    try {
        const parsed = new URL(url)
        const host = parsed.hostname.replace(/^www\./, '')
        const service = SERVICES[host] || (/(^|\.)alldone\.app$/.test(host) ? 'Alldone' : host)
        // A truncated last segment is not a real id; describe only complete ones.
        const segments = parsed.pathname.split('/').filter(Boolean)
        if (/…$/.test(rawUrl) || /\.\.\.$/.test(rawUrl)) segments.pop()
        const detail = describePath(service, segments)
        return { url, label: detail ? `${service} · ${detail}` : service }
    } catch (_) {
        return { url, label: url.slice(0, 40) }
    }
}

// Splits a preview into text and link parts, keeping the text punctuation that followed a URL.
export function splitActivityPreview(text) {
    if (typeof text !== 'string' || !text) return []
    const parts = []
    let index = 0
    for (const match of text.matchAll(URL_PATTERN)) {
        const raw = match[0]
        const trailing = raw.match(/[.,;:!?)\]}'"]+$/)?.[0] || ''
        const cut = raw.slice(0, raw.length - trailing.length)
        if (match.index > index) parts.push({ type: 'text', text: text.slice(index, match.index) })
        parts.push({ type: 'link', ...describeActivityLink(cut) })
        index = match.index + cut.length
    }
    if (index < text.length) parts.push({ type: 'text', text: text.slice(index) })
    return parts
}

// Cuts at `limit` without leaving half a URL behind: a URL that does not fit is dropped whole.
export function truncateActivityText(text, limit) {
    if (text.length <= limit) return text
    let end = limit - 1
    for (const match of text.matchAll(URL_PATTERN)) {
        if (match.index < end && match.index + match[0].length > end) {
            end = match.index
            break
        }
    }
    return `${text.slice(0, end).trimEnd()}…`
}
