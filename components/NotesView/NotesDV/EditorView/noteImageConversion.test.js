import Delta from 'quill-delta'
import { convertNoteImages } from './noteImageConversion'

it('replaces images incrementally without resetting other embeds or moving an earlier cursor', () => {
    let contents = new Delta()
        .insert('abc')
        .insert({ taskTagFormat: { taskId: 't1' } })
        .insert({ image: 'uri' })
        .insert('\n')
    const editor = {
        getContents: () => contents,
        getSelection: () => ({ index: 2, length: 0 }),
        updateContents: jest.fn(delta => {
            contents = contents.compose(delta)
        }),
        setContents: jest.fn(),
        setSelection: jest.fn(),
    }
    convertNoteImages(editor, uri => ({ uri }), null)
    expect(editor.setContents).not.toHaveBeenCalled()
    expect(editor.updateContents).toHaveBeenCalledWith(expect.any(Delta), 'api')
    expect(contents.ops).toContainEqual({ insert: { taskTagFormat: { taskId: 't1' } } })
    expect(contents.ops).toContainEqual({ insert: { customImageFormat: { uri: 'uri' } } })
    expect(editor.setSelection).toHaveBeenCalledWith(2, 0, 'silent')
})
it('transforms a selection past multiple images, including rejected images', () => {
    const contents = new Delta().insert({ image: 'a' }).insert('x').insert({ image: 'b' }).insert('end\n')
    const editor = {
        getContents: () => contents,
        getSelection: () => ({ index: 3, length: 3 }),
        updateContents: jest.fn(),
        setSelection: jest.fn(),
    }
    convertNoteImages(editor, uri => (uri === 'a' ? { uri } : null))
    expect(editor.setSelection).toHaveBeenCalledWith(4, 3, 'silent')
})
