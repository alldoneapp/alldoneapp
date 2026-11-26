'use strict'

const {
    GET_NOTES_LIST_HINT,
    NOTE_CONTENT_PAGE_MAX_CHARS,
    NOTE_RESPONSE_MAX_CHARS,
    NoteCursorError,
    buildSingleNotePage,
    decodeNoteCursor,
    encodeNoteCursor,
    findPageEnd,
    fingerprintContent,
} = require('./notePagination')
const { MAX_TOOL_RESULT_CONTEXT_CHARS } = require('../Assistant/attachmentToolHandoff')

const baseNote = content => ({
    id: 'note-1',
    title: 'Spec',
    projectId: 'project-1',
    projectName: 'Product',
    content,
    createdAt: 1,
    updatedAt: 2,
    wordCount: 0,
})

function readAllPages(note, options = {}) {
    const pages = []
    let cursor = null
    do {
        const page = buildSingleNotePage(note, { ...options, cursor })
        pages.push(page)
        cursor = page.nextCursor
        if (pages.length > 1000) throw new Error('pagination does not end')
    } while (cursor)
    return pages
}

function expectGaplessPages(pages, content) {
    expect(pages.map(page => page.note.content).join('')).toBe(content)
    let expectedStart = 0
    pages.forEach((page, index) => {
        expect(page.contentRange.start).toBe(expectedStart)
        expect(page.contentRange.totalCharacters).toBe(content.length)
        expect(page.note.content).toBe(content.slice(page.contentRange.start, page.contentRange.end))
        expect(page.truncated).toBe(index < pages.length - 1)
        expectedStart = page.contentRange.end
    })
    expect(expectedStart).toBe(content.length)
}

describe('get_notes single-note pages', () => {
    test('page limits fit the assistant tool-result ceiling', () => {
        expect(NOTE_CONTENT_PAGE_MAX_CHARS).toBe(30000)
        expect(NOTE_RESPONSE_MAX_CHARS).toBeLessThan(MAX_TOOL_RESULT_CONTEXT_CHARS)
    })

    test('a note that fits returns its complete content in one response', () => {
        const content = 'Hello\nworld'
        const page = buildSingleNotePage(baseNote(content))

        expect(page).toEqual({
            success: true,
            note: {
                id: 'note-1',
                title: 'Spec',
                projectId: 'project-1',
                projectName: 'Product',
                createdAt: 1,
                updatedAt: 2,
                wordCount: 0,
                characterCount: content.length,
                content,
            },
            truncated: false,
            nextCursor: null,
            contentRange: { start: 0, end: content.length, totalCharacters: content.length },
        })
        expect(page).not.toHaveProperty('message')
    })

    test('an empty note is complete, not truncated', () => {
        const page = buildSingleNotePage(baseNote(''))
        expect(page.note.content).toBe('')
        expect(page.truncated).toBe(false)
        expect(page.nextCursor).toBeNull()
    })

    test('a note of exactly one page is not truncated; one character more is', () => {
        const exact = 'a'.repeat(NOTE_CONTENT_PAGE_MAX_CHARS)
        expect(buildSingleNotePage(baseNote(exact)).truncated).toBe(false)

        const over = `${exact}b`
        const pages = readAllPages(baseNote(over))
        expect(pages).toHaveLength(2)
        expectGaplessPages(pages, over)
    })

    test('a very large note reads gaplessly to the end, every page within the ceiling', () => {
        const lines = []
        for (let i = 0; lines.join('\n').length < 1000000; i++) {
            lines.push(`${i}: "quote" \\ backslash, äöü ß, 🚀🎉, tab\t, ${'lorem ipsum '.repeat(i % 13)}`)
        }
        const content = lines.join('\n')
        const pages = readAllPages(baseNote(content))

        expect(pages.length).toBeGreaterThan(30)
        expectGaplessPages(pages, content)
        pages.forEach(page => {
            expect(JSON.stringify(page.note.content).length - 2).toBeLessThanOrEqual(NOTE_CONTENT_PAGE_MAX_CHARS)
            expect(JSON.stringify(page).length).toBeLessThanOrEqual(NOTE_RESPONSE_MAX_CHARS)
            if (page.truncated) {
                expect(page.message).toContain('nextCursor')
                expect(page.message).toContain('truncated is false')
                // Pages end after a line break when one is near the limit.
                expect(page.note.content.endsWith('\n')).toBe(true)
            }
        })
    })

    test('escape-heavy text counts its JSON escapes against the page budget', () => {
        const content = '"\\\n\u0001'.repeat(20000)
        const pages = readAllPages(baseNote(content))
        expectGaplessPages(pages, content)
        pages.forEach(page =>
            expect(JSON.stringify(page.note.content).length - 2).toBeLessThanOrEqual(NOTE_CONTENT_PAGE_MAX_CHARS)
        )
    })

    test('a page never splits a surrogate pair', () => {
        const content = '🚀'.repeat(40000)
        const pages = readAllPages(baseNote(content), { pageMaxChars: 1001 })
        expectGaplessPages(pages, content)
        pages.forEach(page => {
            expect(page.contentRange.start % 2).toBe(0)
            expect(page.contentRange.end % 2).toBe(0)
        })
    })

    test('text without line breaks or spaces still pages gaplessly', () => {
        const content = 'x'.repeat(95000)
        const pages = readAllPages(baseNote(content))
        expect(pages).toHaveLength(4)
        expectGaplessPages(pages, content)
    })

    test('a long title takes its room from the page, so the response still fits', () => {
        const note = { ...baseNote('word '.repeat(20000)), title: 'T'.repeat(12000) }
        const pages = readAllPages(note)
        expectGaplessPages(pages, note.content)
        pages.forEach(page => expect(JSON.stringify(page).length).toBeLessThanOrEqual(NOTE_RESPONSE_MAX_CHARS))
    })

    test('the cursor of another note is rejected', () => {
        const content = 'line\n'.repeat(10000)
        const first = buildSingleNotePage(baseNote(content))
        expect(first.truncated).toBe(true)

        expect(() => buildSingleNotePage({ ...baseNote(content), id: 'note-2' }, { cursor: first.nextCursor })).toThrow(
            expect.objectContaining({ code: 'invalid_cursor' })
        )
        expect(() =>
            buildSingleNotePage({ ...baseNote(content), projectId: 'project-2' }, { cursor: first.nextCursor })
        ).toThrow(expect.objectContaining({ code: 'invalid_cursor' }))
    })

    test('a note that changed since the cursor was issued fails with note_changed', () => {
        const content = 'line\n'.repeat(10000)
        const first = buildSingleNotePage(baseNote(content))

        expect(() => buildSingleNotePage(baseNote(`new\n${content}`), { cursor: first.nextCursor })).toThrow(
            expect.objectContaining({ code: 'note_changed' })
        )
    })

    test('malformed, tampered and out-of-range cursors are rejected', () => {
        const content = 'line\n'.repeat(10000)
        const fingerprint = fingerprintContent(content)
        const tampered = encodeNoteCursor({ noteId: 'note-1', projectId: 'project-1', offset: 0, fingerprint })
        const pastEnd = encodeNoteCursor({
            noteId: 'note-1',
            projectId: 'project-1',
            offset: content.length,
            fingerprint,
        })

        for (const cursor of ['garbage', 'nc1.', 'nc1.%%%', `nc1.${Buffer.from('{"n":1}').toString('base64url')}`]) {
            expect(() => buildSingleNotePage(baseNote(content), { cursor })).toThrow(NoteCursorError)
        }
        expect(() => buildSingleNotePage(baseNote(content), { cursor: tampered })).toThrow(
            expect.objectContaining({ code: 'invalid_cursor' })
        )
        expect(() => buildSingleNotePage(baseNote(content), { cursor: pastEnd })).toThrow(
            expect.objectContaining({ code: 'invalid_cursor' })
        )
    })

    test('a cursor round-trips', () => {
        const value = { noteId: 'n', projectId: 'p', offset: 5, fingerprint: 'abc' }
        expect(decodeNoteCursor(encodeNoteCursor(value))).toEqual(value)
    })

    test('findPageEnd prefers a line break near the limit and always makes progress', () => {
        expect(findPageEnd('abc\ndefgh', 0, 7)).toBe(4)
        expect(findPageEnd('abcdefgh', 0, 5)).toBe(5)
        expect(findPageEnd('abc', 0, 0)).toBe(1)
        expect(findPageEnd('abc', 1, 100)).toBe(3)
    })

    test('the list hint tells the caller how to read a note completely', () => {
        expect(GET_NOTES_LIST_HINT).toContain('contentPreview')
        expect(GET_NOTES_LIST_HINT).toContain('noteId')
        expect(GET_NOTES_LIST_HINT).toContain('projectId')
        expect(GET_NOTES_LIST_HINT).toContain('nextCursor')
    })
})
