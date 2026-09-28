/**
 * An embed-aware plain-text view of a note's Y.Text, and the map back to Y.Text positions.
 *
 * `Y.Text.toString()` is the obvious way to read a note and it is wrong for anything that
 * shows the note to a model or computes an offset in it: it only concatenates string
 * content, so every embed (a URL chip, a mention, a task tag, an image) simply vanishes —
 * while in Y.Text coordinates each embed still occupies one position. Two failures follow:
 *
 * - A model reading the note back cannot see what it just wrote. The meeting-summary prompt
 *   asks for a calendar link; markdownToYjs stores it as a `url` embed; the read-back showed
 *   "Calendar event: Re-Design Juno — " and nothing after the dash, so the assistant patched
 *   the section again, and again — seven times, six minutes, a feed entry each.
 * - Patch offsets computed on that string land one position early for every embed before
 *   them, so a `replace_section` after a link deleted the wrong characters.
 *
 * The projection renders every embed as readable text and records, per piece, where it sits
 * in both coordinate systems. `toYIndex` maps a text offset back; an offset that falls inside
 * an embed's rendered text snaps to one side of the embed (an embed is atomic — half a link
 * cannot be deleted), chosen by `bias`.
 */

let markdownTableToMarkdown = null
function renderMarkdownTable(tableData) {
    if (!markdownTableToMarkdown) {
        try {
            markdownTableToMarkdown = require('../Assistant/deltaToMarkdown').markdownTableToMarkdown
        } catch (_) {
            markdownTableToMarkdown = () => ''
        }
    }
    return markdownTableToMarkdown(tableData || {}) || '[table]'
}

const textOf = value => (typeof value === 'string' ? value.trim() : '')

/**
 * Render one Quill embed as the text a reader should see. Never returns an empty string:
 * a zero-width embed would make the offsets on either side of it indistinguishable.
 */
function renderNoteEmbedAsText(embed) {
    if (!embed || typeof embed !== 'object') return '[embed]'
    const [type] = Object.keys(embed)
    const value = embed[type]
    const data = value && typeof value === 'object' ? value : {}

    switch (type) {
        case 'url':
            return textOf(data.url) || '[link]'
        case 'mention':
            return textOf(data.text) ? `@${textOf(data.text)}` : '[mention]'
        case 'email':
            return textOf(data.text) || textOf(data.email) || '[email]'
        case 'hashtag':
            return textOf(data.text) ? `#${textOf(data.text)}` : '[hashtag]'
        case 'milestoneTag':
            return textOf(data.text) || '[milestone]'
        case 'taskTagFormat':
        case 'unprotectedTaskTagFormat':
            return textOf(data.objectUrl) ? `[task: ${textOf(data.objectUrl)}]` : '[task]'
        case 'customImageFormat':
        case 'image': {
            const uri = typeof value === 'string' ? value : textOf(data.uri) || textOf(data.url)
            return uri ? `![${textOf(data.text) || 'image'}](${uri})` : '[image]'
        }
        case 'videoFormat':
            return textOf(data.uri) ? `[video: ${textOf(data.text) || 'video'}](${textOf(data.uri)})` : '[video]'
        case 'attachment':
            return textOf(data.uri)
                ? `[attachment: ${textOf(data.text) || 'file'}](${textOf(data.uri)})`
                : `[attachment: ${textOf(data.text) || 'file'}]`
        case 'commentTagFormat':
            return textOf(data.text) ? `[comment: ${textOf(data.text)}]` : '[comment]'
        case 'karma':
            return '[karma]'
        case 'markdownTable':
            return renderMarkdownTable(value)
        default:
            return `[${type || 'embed'}]`
    }
}

/**
 * @param {Array} delta - Y.Text#toDelta() ops
 * @returns {{ text: string, pieces: Array, yLength: number }}
 */
function buildNoteTextProjection(delta) {
    const pieces = []
    let text = ''
    let yLength = 0

    for (const op of Array.isArray(delta) ? delta : []) {
        if (typeof op.insert === 'string') {
            if (!op.insert) continue
            pieces.push({
                textStart: text.length,
                textEnd: text.length + op.insert.length,
                yStart: yLength,
                embed: false,
                attributes: op.attributes || null,
                text: op.insert,
            })
            text += op.insert
            yLength += op.insert.length
        } else if (op.insert !== undefined && op.insert !== null) {
            const rendered = renderNoteEmbedAsText(op.insert)
            pieces.push({
                textStart: text.length,
                textEnd: text.length + rendered.length,
                yStart: yLength,
                embed: true,
                attributes: op.attributes || null,
                text: rendered,
            })
            text += rendered
            yLength += 1
        }
    }

    return { text, pieces, yLength }
}

function projectYText(ytext) {
    if (!ytext || typeof ytext.toDelta !== 'function') return buildNoteTextProjection([])
    return buildNoteTextProjection(ytext.toDelta())
}

/**
 * Map an offset in `projection.text` to a Y.Text position.
 * @param {'before'|'after'} bias - side of an embed to land on when the offset is inside it
 */
function toYIndex(projection, index, bias = 'before') {
    if (index <= 0) return 0
    if (index >= projection.text.length) return projection.yLength

    for (const piece of projection.pieces) {
        if (index < piece.textStart || index >= piece.textEnd) continue
        if (!piece.embed) return piece.yStart + (index - piece.textStart)
        if (index === piece.textStart) return piece.yStart
        return bias === 'after' ? piece.yStart + 1 : piece.yStart
    }
    return projection.yLength
}

/**
 * Text of every line whose terminating newline carries a `header` attribute, with embeds
 * rendered — the same strings `getPatchLinesFromContent` sees in the projected text.
 */
function getProjectedHeadingTexts(projection) {
    const headingTexts = new Set()
    let lineText = ''
    for (const piece of projection.pieces) {
        if (piece.embed) {
            lineText += piece.text
            continue
        }
        for (const char of piece.text) {
            if (char !== '\n') {
                lineText += char
                continue
            }
            if (piece.attributes && piece.attributes.header) {
                const trimmed = lineText.trim()
                if (trimmed) headingTexts.add(trimmed)
            }
            lineText = ''
        }
    }
    return headingTexts
}

module.exports = {
    renderNoteEmbedAsText,
    buildNoteTextProjection,
    projectYText,
    toYIndex,
    getProjectedHeadingTexts,
}
