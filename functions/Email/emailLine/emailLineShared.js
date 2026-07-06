'use strict'

// Parses an RFC 2369 List-Unsubscribe header value, e.g.
//   <https://example.com/unsub?id=1>, <mailto:unsub@example.com?subject=unsub>
// Returns { httpsUrl, mailto } (either may be absent) or null when neither is present.
function parseListUnsubscribe(headerValue) {
    if (!headerValue || typeof headerValue !== 'string') return null

    const tokens = []
    const bracketMatches = headerValue.match(/<([^>]+)>/g)
    if (bracketMatches) {
        bracketMatches.forEach(match => tokens.push(match.slice(1, -1).trim()))
    } else {
        // Some senders omit the angle brackets.
        headerValue
            .split(',')
            .map(part => part.trim())
            .filter(Boolean)
            .forEach(part => tokens.push(part))
    }

    let httpsUrl = ''
    let mailto = ''
    tokens.forEach(token => {
        const lower = token.toLowerCase()
        if (!httpsUrl && lower.startsWith('https://')) httpsUrl = token
        else if (!mailto && lower.startsWith('mailto:')) mailto = token
    })

    if (!httpsUrl && !mailto) return null
    return {
        ...(httpsUrl ? { httpsUrl } : {}),
        ...(mailto ? { mailto } : {}),
    }
}

// Splits an array into fixed-size chunks (for batchModify / Graph $batch).
function chunk(items, size) {
    const result = []
    for (let i = 0; i < items.length; i += size) {
        result.push(items.slice(i, i + size))
    }
    return result
}

module.exports = {
    parseListUnsubscribe,
    chunk,
}
