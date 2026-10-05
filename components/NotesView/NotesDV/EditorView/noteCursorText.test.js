import Delta from 'quill-delta'
import { findMentionStart, findMentionEnd, readCursorText } from './noteCursorText'

const editorOf = delta => ({
    getContents: jest.fn((start, length) => delta.slice(start, start + length)),
    getLength: () => delta.length(),
})

it('reads four positions around a cursor in a 100k formatted note, preserving embed positions', () => {
    const delta = new Delta()
        .insert('x'.repeat(100000))
        .insert({ mention: { text: 'Task' } })
        .insert('@a\n')
    const editor = editorOf(delta)
    expect(findMentionStart(editor, 100003)).toBe(100002)
    expect(editor.getContents).toHaveBeenCalledWith(100000, 4)
    expect(readCursorText(editor, 100000, 3)).toBe('&@a')
})

it.each(['@', ' @', '\n@', '&@'])('recognises mentions at a boundary: %s', text => {
    const editor = editorOf(new Delta().insert(text + 'Name rest\n'))
    expect(findMentionStart(editor, text.length)).toBe(text.length)
    expect(findMentionEnd(editor, text.length)).toBe(text.length + 4)
})

it('ignores an @ within a word and stops a token at an embed', () => {
    expect(findMentionStart(editorOf(new Delta().insert('mail@example\n')), 5)).toBeNull()
    const editor = editorOf(new Delta().insert('@Long').insert({ image: 'test' }).insert('after\n'))
    expect(findMentionEnd(editor, 1)).toBe(5)
})

it('preserves long tokens without reading the rest of the document', () => {
    const editor = editorOf(new Delta().insert('@' + 'a'.repeat(300) + ' ' + 'z'.repeat(100000)))
    expect(findMentionEnd(editor, 1)).toBe(301)
    expect(editor.getContents).toHaveBeenCalledTimes(5)
    expect(editor.getContents.mock.calls.every(([, length]) => length <= 64)).toBe(true)
})
