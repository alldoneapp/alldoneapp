/**
 * AT-2626 — shortens an undo record's label for display in the undo banner.
 *
 * Every undo label names its object inside curly quotes (`Completed “<task name>”`,
 * `Added “<task>” to “<goal>”`, …) and the names are stored in full by a dozen producers on both
 * the client and the server. A task name is free text and routinely carries a pasted link, so a
 * label can be several hundred characters long. The banner shows at most two lines, so the long
 * name used to take the whole card and push the Undo button out of view.
 *
 * Abbreviation is therefore done at display time, in one place, so every producer and every
 * record already stored benefits:
 *   - a URL inside a quoted name is reduced to host + path, without protocol, query or fragment,
 *     and a path that is still long is cut back to the host (`jtl-software.atlassian.net/…`);
 *   - each quoted name is then capped at `UNDO_LABEL_NAME_MAX_LENGTH` characters;
 *   - the whole label is capped at `UNDO_LABEL_MAX_LENGTH` as a last line of defence, for labels
 *     with no quoted name at all (error messages, grouped labels).
 *
 * The unabbreviated label is still available as the banner's accessibility label.
 */

export const UNDO_LABEL_NAME_MAX_LENGTH = 60
export const UNDO_LABEL_URL_MAX_LENGTH = 40
export const UNDO_LABEL_MAX_LENGTH = 140

const ELLIPSIS = '…'
const QUOTED_NAME = /“([^”]*)”/g
// A URL inside free text: an explicit scheme or a `www.` prefix, up to the next whitespace or
// closing quote. Bare domains (`example.com`) are deliberately left alone — they are short already
// and matching them would also catch ordinary words like `v1.2`.
const INLINE_URL = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s”"]+/gi
const TRAILING_URL_PUNCTUATION = /[.,;:!?)\]]+$/

// Code-point aware, so an emoji in a task name is never cut in half into a broken glyph.
const toChars = text => Array.from(text)

export const truncateText = (text, maxLength) => {
    if (!text) return ''
    const chars = toChars(text)
    if (chars.length <= maxLength) return text
    // Leave room for the ellipsis, and do not end on dangling whitespace or separators.
    const cut = chars
        .slice(0, Math.max(1, maxLength - 1))
        .join('')
        .replace(/[\s\-–—:,;/]+$/, '')
    return `${cut}${ELLIPSIS}`
}

export const shortenUrl = url => {
    const trailing = (url.match(TRAILING_URL_PUNCTUATION) || [''])[0]
    const bare = trailing ? url.slice(0, -trailing.length) : url
    const withoutScheme = bare.replace(/^(?:https?|ftp):\/\//i, '').replace(/^www\./i, '')
    const queryIndex = withoutScheme.search(/[?#]/)
    const hadQuery = queryIndex !== -1
    const withoutQuery = (hadQuery ? withoutScheme.slice(0, queryIndex) : withoutScheme).replace(/\/+$/, '')
    const slashIndex = withoutQuery.indexOf('/')
    const host = slashIndex === -1 ? withoutQuery : withoutQuery.slice(0, slashIndex)

    let shortened
    if (toChars(withoutQuery).length <= UNDO_LABEL_URL_MAX_LENGTH) {
        shortened = hadQuery ? `${withoutQuery}${ELLIPSIS}` : withoutQuery
    } else {
        shortened = `${truncateText(host, UNDO_LABEL_URL_MAX_LENGTH - 2)}/${ELLIPSIS}`
    }
    return `${shortened || url}${trailing}`
}

export const abbreviateUndoName = name => truncateText(name.replace(INLINE_URL, shortenUrl), UNDO_LABEL_NAME_MAX_LENGTH)

export const abbreviateUndoLabel = label => {
    if (typeof label !== 'string' || !label) return ''
    const withShortNames = label.replace(QUOTED_NAME, (match, name) => `“${abbreviateUndoName(name)}”`)
    return truncateText(withShortNames, UNDO_LABEL_MAX_LENGTH)
}
