'use strict'

/**
 * get_notes single-note reads (AT-3159).
 *
 * A read with noteId + projectId returns the note's text as `content`. A note too large for one
 * response is never cut silently: the response says `truncated: true` and carries a `nextCursor`;
 * calling again with that cursor returns the next page, until `truncated` is false. Joining the
 * pages' `content` in order gives the complete text, without gaps or overlap.
 *
 * Page size is measured the way the assistant's tool-result ceiling measures it (JSON-serialized
 * characters, `MAX_TOOL_RESULT_CONTEXT_CHARS` = 40,000 in Assistant/attachmentToolHandoff.js), so a
 * page passes that ceiling untouched. MCP gets the same pages: both run executeToolNatively.
 *
 * The cursor carries a fingerprint of the note text. If the note changes between two pages, the
 * offsets no longer line up; the read fails with `code: 'note_changed'` instead of returning text
 * that would leave a gap or repeat a passage.
 */

const { createHash } = require('crypto')

// JSON-serialized characters of `content` per page (escapes count, as in the context ceiling).
const NOTE_CONTENT_PAGE_MAX_CHARS = 30000
// The whole single-note response stays below this, so it fits the 40,000-character ceiling with room
// for the ceiling's own metadata. A long title takes its room from the page, not from the ceiling.
const NOTE_RESPONSE_MAX_CHARS = 38000
const NOTE_CONTENT_PAGE_MIN_CHARS = 1000
// Prefer to end a page after a line break (or a space) found in the page's last part.
const PAGE_BREAK_LOOKBACK_CHARS = 2000
const CURSOR_PREFIX = 'nc1.'

// Sent with every non-empty list, where the model decides what to read next.
const GET_NOTES_LIST_HINT =
    'contentPreview is a short excerpt, not the note content. To read a note completely, call get_notes with its id as noteId and its projectId; if that response has truncated: true, call again with cursor set to nextCursor until truncated is false.'

class NoteCursorError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

function fingerprintContent(content) {
    return createHash('sha256').update(String(content), 'utf8').digest('hex').slice(0, 16)
}

function encodeNoteCursor({ noteId, projectId, offset, fingerprint }) {
    const payload = JSON.stringify({ n: noteId, p: projectId, o: offset, h: fingerprint })
    return CURSOR_PREFIX + Buffer.from(payload, 'utf8').toString('base64url')
}

function decodeNoteCursor(cursor) {
    if (typeof cursor !== 'string' || !cursor.startsWith(CURSOR_PREFIX)) {
        throw new NoteCursorError(
            'invalid_cursor',
            'Invalid cursor. Pass the exact nextCursor string from the previous get_notes response, or omit cursor to read the note from the beginning.'
        )
    }
    let payload
    try {
        payload = JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'))
    } catch (error) {
        payload = null
    }
    if (
        !payload ||
        typeof payload.n !== 'string' ||
        typeof payload.p !== 'string' ||
        typeof payload.h !== 'string' ||
        !Number.isInteger(payload.o) ||
        payload.o <= 0
    ) {
        throw new NoteCursorError(
            'invalid_cursor',
            'Invalid cursor. Pass the exact nextCursor string from the previous get_notes response, or omit cursor to read the note from the beginning.'
        )
    }
    return { noteId: payload.n, projectId: payload.p, offset: payload.o, fingerprint: payload.h }
}

// Characters one code point adds to a JSON string literal (JSON.stringify escaping).
function serializedLength(codePointString) {
    return JSON.stringify(codePointString).length - 2
}

function isHighSurrogate(code) {
    return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code) {
    return code >= 0xdc00 && code <= 0xdfff
}

/**
 * End offset (exclusive) of the page that starts at `start`: as much text as fits `maxChars`
 * serialized characters, never splitting a surrogate pair, preferably right after a line break.
 */
function findPageEnd(content, start, maxChars) {
    let end = start
    let used = 0
    while (end < content.length) {
        const code = content.charCodeAt(end)
        const width = isHighSurrogate(code) && isLowSurrogate(content.charCodeAt(end + 1)) ? 2 : 1
        const cost = serializedLength(content.slice(end, end + width))
        if (used + cost > maxChars) break
        used += cost
        end += width
    }
    if (end >= content.length) return content.length
    if (end === start) {
        // maxChars is never below one escaped code point in practice; still make progress.
        const code = content.charCodeAt(start)
        return start + (isHighSurrogate(code) && isLowSurrogate(content.charCodeAt(start + 1)) ? 2 : 1)
    }

    const lookbackFloor = Math.max(start + 1, end - PAGE_BREAK_LOOKBACK_CHARS)
    const window = content.slice(lookbackFloor, end)
    const newline = window.lastIndexOf('\n')
    if (newline !== -1) return lookbackFloor + newline + 1
    const space = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\t'))
    if (space !== -1) return lookbackFloor + space + 1
    return end
}

function buildContinuationMessage(start, end, total) {
    return (
        `Partial content: characters ${start}-${end} of ${total}. The note is not complete yet. ` +
        'Call get_notes again with the same noteId and projectId and cursor set to nextCursor, and repeat until truncated is false. ' +
        'Join the content of all pages in order, without adding or removing characters.'
    )
}

/**
 * Build the get_notes response for one note.
 * @param {Object} note - { id, title, projectId, projectName, content, createdAt, updatedAt, wordCount }
 * @param {Object} [options]
 * @param {string} [options.cursor] - nextCursor from the previous page
 * @param {number} [options.pageMaxChars]
 * @param {number} [options.responseMaxChars]
 */
function buildSingleNotePage(note, options = {}) {
    const {
        cursor = null,
        pageMaxChars = NOTE_CONTENT_PAGE_MAX_CHARS,
        responseMaxChars = NOTE_RESPONSE_MAX_CHARS,
    } = options
    const content = typeof note.content === 'string' ? note.content : String(note.content || '')
    const fingerprint = fingerprintContent(content)
    const total = content.length

    let start = 0
    if (cursor !== null && cursor !== undefined && cursor !== '') {
        const decoded = decodeNoteCursor(cursor)
        if (decoded.noteId !== note.id || decoded.projectId !== note.projectId) {
            throw new NoteCursorError(
                'invalid_cursor',
                'This cursor belongs to a different note. Pass the noteId and projectId the cursor was returned for, or omit cursor to read this note from the beginning.'
            )
        }
        if (decoded.fingerprint !== fingerprint) {
            throw new NoteCursorError(
                'note_changed',
                'The note was edited after the previous page was read, so the remaining pages would not line up. Read it again from the beginning: call get_notes with noteId and projectId and no cursor.'
            )
        }
        if (decoded.offset >= total) {
            throw new NoteCursorError(
                'invalid_cursor',
                'Invalid cursor: it points past the end of the note. Omit cursor to read the note from the beginning.'
            )
        }
        start = decoded.offset
    }

    const meta = {
        id: note.id,
        title: note.title,
        projectId: note.projectId,
        projectName: note.projectName || null,
        createdAt: note.createdAt ?? null,
        updatedAt: note.updatedAt ?? null,
        wordCount: note.wordCount || 0,
        characterCount: total,
    }

    // Room the response needs besides the page text, sized for the longest possible cursor/message.
    const skeleton = {
        success: true,
        note: { ...meta, content: '' },
        truncated: true,
        nextCursor: encodeNoteCursor({ noteId: note.id, projectId: note.projectId, offset: total, fingerprint }),
        contentRange: { start: total, end: total, totalCharacters: total },
        message: buildContinuationMessage(total, total, total),
    }
    const overhead = JSON.stringify(skeleton).length
    const budget = Math.max(NOTE_CONTENT_PAGE_MIN_CHARS, Math.min(pageMaxChars, responseMaxChars - overhead))

    const end = findPageEnd(content, start, budget)
    const truncated = end < total

    const result = {
        success: true,
        note: { ...meta, content: content.slice(start, end) },
        truncated,
        nextCursor: truncated
            ? encodeNoteCursor({ noteId: note.id, projectId: note.projectId, offset: end, fingerprint })
            : null,
        contentRange: { start, end, totalCharacters: total },
    }
    if (truncated) result.message = buildContinuationMessage(start, end, total)
    return result
}

module.exports = {
    GET_NOTES_LIST_HINT,
    NOTE_CONTENT_PAGE_MAX_CHARS,
    NOTE_RESPONSE_MAX_CHARS,
    NoteCursorError,
    buildSingleNotePage,
    decodeNoteCursor,
    encodeNoteCursor,
    findPageEnd,
    fingerprintContent,
}
