import React from 'react'
import { render, act } from '@testing-library/react'
import ReactQuill from 'react-quill-new'
import * as Y from 'yjs'
import { QuillBinding } from 'y-quill'
import NoteQuill from './NoteQuill'
import MarkdownTableFormat from './MarkdownTableFormat'

ReactQuill.Quill.register(MarkdownTableFormat, true)

it('forwards real Quill events without HTML or full contents conversion; preserves embeds and tables', () => {
    const ref = React.createRef()
    const changed = jest.fn()
    const selection = jest.fn()
    const view = render(
        <NoteQuill
            ref={ref}
            theme={null}
            modules={{ toolbar: false }}
            onChange={changed}
            onChangeSelection={selection}
        />
    )
    const editor = ref.current.getEditor()
    const semantic = jest.spyOn(editor, 'getSemanticHTML')
    const html = jest.spyOn(ref.current.unprivilegedEditor, 'getHTML')
    const contents = jest.spyOn(ref.current.unprivilegedEditor, 'getContents')
    act(() => {
        editor.insertText(0, 'User ', { bold: true }, 'user')
        editor.insertEmbed(
            5,
            'markdownTable',
            {
                rows: [
                    ['a', 'b'],
                    ['c', 'd'],
                ],
            },
            'api'
        )
        editor.insertEmbed(6, 'image', 'https://example.invalid/a.png', 'api')
        editor.insertText(7, 'silent', 'silent')
    })
    expect(semantic).not.toHaveBeenCalled()
    expect(html).not.toHaveBeenCalled()
    expect(contents).not.toHaveBeenCalled()
    expect(changed.mock.calls.map(call => call[2])).toEqual(['user', 'api', 'api', 'silent'])
    expect(changed.mock.calls.every(call => call[0] === null && call[4]?.ops)).toBe(true)
    expect(editor.getContents().ops.some(op => op.insert?.markdownTable)).toBe(true)
    expect(editor.getContents().ops.some(op => op.insert?.image)).toBe(true)
    act(() => editor.setSelection(2, 3, 'silent'))
    expect(selection).toHaveBeenCalledWith({ index: 2, length: 3 }, 'silent', expect.any(Object))
    view.unmount()
})
it('retains binding-origin events and convergence with a second Yjs client', () => {
    const ref = React.createRef()
    const changed = jest.fn()
    const view = render(<NoteQuill ref={ref} theme={null} modules={{ toolbar: false }} onChange={changed} />)
    const local = new Y.Doc()
    const remote = new Y.Doc()
    let binding
    act(() => {
        binding = new QuillBinding(local.getText('quill'), ref.current.getEditor())
    })
    act(() => ref.current.getEditor().insertText(0, 'Local ', 'user'))
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local))
    remote.getText('quill').insert(0, 'Remote ')
    act(() => Y.applyUpdate(local, Y.encodeStateAsUpdate(remote), 'remote'))
    expect(changed.mock.calls.some(call => call[2] === binding)).toBe(true)
    expect(ref.current.getEditor().getText()).toBe('Remote Local \n')
    act(() => binding.destroy())
    local.destroy()
    remote.destroy()
    view.unmount()
})
it('rejects controlled content, keeping the optimized contract scoped to Yjs notes', () => {
    const quill = new NoteQuill({})
    expect(() => quill.validateProps({ value: 'controlled' })).toThrow('owned by Yjs')
})
