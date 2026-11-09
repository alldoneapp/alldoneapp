// Token counting handles untrusted prose, not tokenizer control instructions. In particular,
// an assistant explaining a token (or an error containing one) must not break a whole thread.
const encodeOrdinaryText = (encoder, text) => encoder.encode(text, [], [])

const isInsideCodeFence = (text, position) => {
    let fence = null
    for (const match of text.slice(0, position).matchAll(/^\s*(`{3,}|~{3,})[^\n]*$/gm)) {
        const delimiter = match[1]
        if (!fence) fence = delimiter
        else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = null
    }
    return fence !== null
}

// These are transcript serialization artifacts, not ordinary mentions of special tokens.
// Discard the contaminated suffix rather than promoting its fake user/tool turns to an answer.
// Keep code examples and plain mentions of tokens intact.
const sanitizeAssistantResponseText = text => {
    if (typeof text !== 'string') return text
    const markers = [
        /<\|fim_suffix\|>\s*\(no final emitted\)/g,
        /^\[Replayed tool definitions, not a model response\]\s*\nThe following tool definitions were present during the historical conversation replay\./gm,
        /(?:^|\n)(?:<\|im_end\|>|\[im_end\])?\s*(?:<\|im_start\|>|\[im_start\])(?:system|developer|assistant|user|tool)(?:<\|im_sep\|>|\[im_sep\])/g,
    ]
    let boundary = text.length
    for (const marker of markers) {
        for (const match of text.matchAll(marker)) {
            if (match.index >= boundary || isInsideCodeFence(text, match.index)) continue
            // If the marker is inline, drop its whole line: transport debris can precede it.
            const markerStart = match.index + (match[0].startsWith('\n') ? 1 : 0)
            const lineStart = text.lastIndexOf('\n', markerStart - 1) + 1
            boundary = Math.min(boundary, lineStart)
        }
    }
    return boundary < text.length ? text.slice(0, boundary).trimEnd() : text
}

// Image and video tokens in a comment make every viewer's browser fetch their URL as soon as the
// comment renders (CustomImage, MediaPlayer). An assistant that read an injected email or web page
// could be steered into writing a token whose URL carries private data from the run to a server
// the attacker reads (security audit 2026-11, NV-04). Media the assistant legitimately shows comes
// from Alldone's own storage, so a token pointing anywhere else is turned back into its plain URL:
// still visible and clickable, but never loaded on its own.
const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
const VIDEO_TRIGGER = 'ptPQsef7OeB5eWd'

const getTrustedMediaBuckets = () => {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || ''
    return projectId ? [`${projectId}.appspot.com`, `${projectId}.firebasestorage.app`] : null
}

const isTrustedMediaUrl = (value, buckets) => {
    if (!value) return true
    try {
        const url = new URL(value)
        if (url.protocol !== 'https:') return false
        if (url.hostname === 'firebasestorage.googleapis.com') {
            const match = url.pathname.match(/^\/v0\/b\/([^/]+)\//)
            return !!match && buckets.includes(decodeURIComponent(match[1]))
        }
        if (url.hostname === 'storage.googleapis.com') return buckets.includes(url.pathname.split('/')[1])
        return false
    } catch (error) {
        return false
    }
}

const neutralizeUntrustedMediaTokens = (text, buckets = getTrustedMediaBuckets()) => {
    // Without a known project (local tools, tests) there is nothing to compare against.
    if (typeof text !== 'string' || !buckets) return text
    if (!text.includes(IMAGE_TRIGGER) && !text.includes(VIDEO_TRIGGER)) return text
    return text
        .split(/(\s+)/)
        .map(word => {
            const trigger = word.includes(IMAGE_TRIGGER)
                ? IMAGE_TRIGGER
                : word.includes(VIDEO_TRIGGER)
                  ? VIDEO_TRIGGER
                  : null
            if (!trigger) return word
            const parts = word.split(trigger)
            const urls = trigger === IMAGE_TRIGGER ? [parts[1], parts[2]] : [parts[1]]
            return urls.every(url => isTrustedMediaUrl(url, buckets)) ? word : parts[1] || ''
        })
        .join('')
}

const sanitizeAssistantOutput = text => neutralizeUntrustedMediaTokens(sanitizeAssistantResponseText(text))

module.exports = {
    encodeOrdinaryText,
    sanitizeAssistantResponseText: sanitizeAssistantOutput,
    neutralizeUntrustedMediaTokens,
    isTrustedMediaUrl,
}
