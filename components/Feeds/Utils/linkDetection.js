export const REGEX_URL = /^((https?|ftp):\/\/[\S]+|(www\.[\S]+)|([\S]+\.[a-zA-Z]{2,}[\S]*))$|^http:\/\/localhost:[0-9]+\/[^\s.]{2,}(?!\.)$/i

const REGEX_URL_START = /^(?:(?:https?|ftp):\/\/|www\.|(?:[a-z0-9\u00a1-\uffff](?:[a-z0-9\-\u00a1-\uffff]*[a-z0-9\u00a1-\uffff])?\.)+[a-z\u00a1-\uffff]{2,}(?::[0-9]+)?(?:[/?#]|$))/i

const LEADING_BOUNDARIES = new Set(['(', '[', '{', '<', '"', "'", '“', '‘'])
const TRAILING_BOUNDARIES = new Set(['>', '"', "'", '”', '’'])
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?'])
const CLOSING_BOUNDARIES = {
    ')': '(',
    ']': '[',
    '}': '{',
}

const countCharacter = (text, character) => text.split(character).length - 1

export const isDetectedUrl = value => REGEX_URL_START.test(value) && REGEX_URL.test(value)

/**
 * Separates a URL from punctuation or wrappers that touch it in prose.
 * Balanced delimiters inside the URL are retained (for example, Wikipedia paths).
 */
export const getUrlTokenParts = token => {
    if (!token || typeof token !== 'string') return null

    let start = 0
    let end = token.length

    while (start < end && LEADING_BOUNDARIES.has(token[start])) start++

    let suffix = ''
    let changed = true
    while (start < end && changed) {
        changed = false
        const lastCharacter = token[end - 1]

        if (TRAILING_PUNCTUATION.has(lastCharacter) || TRAILING_BOUNDARIES.has(lastCharacter)) {
            suffix = lastCharacter + suffix
            end--
            changed = true
            continue
        }

        const openingCharacter = CLOSING_BOUNDARIES[lastCharacter]
        if (openingCharacter) {
            const candidate = token.substring(start, end)
            if (countCharacter(candidate, lastCharacter) > countCharacter(candidate, openingCharacter)) {
                suffix = lastCharacter + suffix
                end--
                changed = true
            }
        }
    }

    const url = token.substring(start, end)
    if (!isDetectedUrl(url)) return null

    return {
        prefix: token.substring(0, start),
        url,
        suffix,
    }
}

const findMarkdownLinkAt = (text, openingBracketIndex) => {
    const labelEnd = text.indexOf('](', openingBracketIndex + 1)
    if (labelEnd === -1 || text.substring(openingBracketIndex + 1, labelEnd).includes('\n')) return null

    const destinationStart = labelEnd + 2
    if (destinationStart >= text.length) return null

    let destinationEnd
    let markdownEnd

    if (text[destinationStart] === '<') {
        destinationEnd = text.indexOf('>', destinationStart + 1)
        if (destinationEnd === -1 || text[destinationEnd + 1] !== ')') return null
        markdownEnd = destinationEnd + 2
        const url = text.substring(destinationStart + 1, destinationEnd)
        return isDetectedUrl(url) ? { url, end: markdownEnd } : null
    }

    let nestedParentheses = 0
    for (let index = destinationStart; index < text.length; index++) {
        const character = text[index]
        if (/\s/.test(character)) return null

        if (character === '(') {
            nestedParentheses++
        } else if (character === ')') {
            if (nestedParentheses === 0) {
                destinationEnd = index
                markdownEnd = index + 1
                break
            }
            nestedParentheses--
        }
    }

    if (destinationEnd === undefined) return null

    const url = text.substring(destinationStart, destinationEnd)
    return isDetectedUrl(url) ? { url, end: markdownEnd } : null
}

/**
 * Splits Markdown links out before whitespace tokenization can combine the final
 * label word, `](`, and destination into one malformed URL.
 */
export const splitMarkdownLinks = text => {
    if (!text || typeof text !== 'string') return [{ type: 'text', value: text || '' }]

    const segments = []
    let textStart = 0
    let searchFrom = 0

    while (searchFrom < text.length) {
        const openingBracketIndex = text.indexOf('[', searchFrom)
        if (openingBracketIndex === -1) break

        const markdownLink = findMarkdownLinkAt(text, openingBracketIndex)
        if (!markdownLink) {
            searchFrom = openingBracketIndex + 1
            continue
        }

        if (openingBracketIndex > textStart) {
            segments.push({ type: 'text', value: text.substring(textStart, openingBracketIndex) })
        }
        segments.push({ type: 'url', value: markdownLink.url })
        textStart = markdownLink.end
        searchFrom = markdownLink.end
    }

    if (textStart < text.length) segments.push({ type: 'text', value: text.substring(textStart) })

    return segments.length > 0 ? segments : [{ type: 'text', value: text }]
}
