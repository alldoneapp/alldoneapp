import * as Y from 'yjs'

import { isRemoteEditorChange } from './NotesEditorView'

/**
 * A collaborator's edits must not be recorded as YOUR edits (AT-2340).
 *
 * y-quill applies remote Yjs updates with `quill.updateContents(delta, this)`,
 * so the change source is the QuillBinding instance. Every local change carries
 * a STRING source — 'user' for typing, 'api' for the editor's own programmatic
 * rewrites (the image-format pass, mention insertion, template application),
 * which are local and must still be saved normally. Gating on `source === 'user'`
 * would have silently stopped saving all of those.
 */
describe('isRemoteEditorChange', () => {
    const binding = { name: 'QuillBinding' }

    it('recognises a change applied by the Yjs binding as remote', () => {
        expect(isRemoteEditorChange(binding, binding)).toBe(true)
    })

    it('treats local typing as local', () => {
        expect(isRemoteEditorChange('user', binding)).toBe(false)
    })

    it('treats programmatic LOCAL edits as local, not remote', () => {
        // 'api' is what quill reports for setContents/insertText done by the app
        // itself — the image-format rewrite, template application, mentions.
        expect(isRemoteEditorChange('api', binding)).toBe(false)
        expect(isRemoteEditorChange('silent', binding)).toBe(false)
    })

    it('falls back to "local" when there is no binding to compare against', () => {
        expect(isRemoteEditorChange(binding, null)).toBe(false)
        expect(isRemoteEditorChange(undefined, undefined)).toBe(false)
    })

    it('does not mistake a different object for the binding', () => {
        expect(isRemoteEditorChange({ name: 'QuillBinding' }, binding)).toBe(false)
    })
})

describe('the y-quill contract this relies on', () => {
    it('applies remote updates with the binding instance as the change source', () => {
        // Pin the actual behaviour rather than trusting the docs: a y-quill bump
        // that changed the origin would silently make every remote change look
        // local again, which is exactly the bug being fixed.
        const local = new Y.Doc()
        const remote = new Y.Doc()
        const binding = { id: 'binding' }
        const observed = []

        local.getText('quill').observe((event, transaction) => observed.push(transaction.origin))

        remote.getText('quill').insert(0, 'typed by a collaborator')
        Y.applyUpdate(local, Y.encodeStateAsUpdate(remote), binding)

        expect(observed).toEqual([binding])
        expect(isRemoteEditorChange(observed[0], binding)).toBe(true)

        local.destroy()
        remote.destroy()
    })
})
