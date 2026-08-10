/**
 * Migration Stage 4 regression suite for the y-quill binding.
 *
 * The old stack shipped a patched y-quill 0.1.4 (replacement_node_modules) working
 * around yjs#474: applyDelta ignored null attributes, so removing bold/background
 * never reached the CRDT, and unattributed inserts inherited neighbouring formats
 * ("attribute bleed", CLAUDE.md). y-quill 1.0 + yjs 13.6 were adopted UNPATCHED on
 * the strength of upstream fixes — this suite pins exactly the behaviors the patch
 * used to provide, driven through the real QuillBinding against a minimal quill
 * stand-in (the binding only uses on/off, getModule, get/setSelection and the two
 * content calls, all of which quill 2 still emits the same way).
 */
import * as Y from 'yjs'
import Delta from 'quill-delta'
import { QuillBinding } from 'y-quill'

class MockQuill {
    constructor() {
        this.handlers = {}
        this.contents = new Delta().insert('\n')
        this.updates = []
    }

    getModule() {
        return null
    }

    on(event, handler) {
        this.handlers[event] = handler
    }

    off() {}

    getSelection() {
        return null
    }

    // Real quill emits editor-change('text-change', …) from both content setters — the
    // binding relies on that to learn which formats the document uses (its negation map).
    setContents(delta, source) {
        this.contents = new Delta(Array.isArray(delta) ? delta : delta.ops || delta)
        this.lastSetSource = source
        if (this.handlers['editor-change']) {
            this.handlers['editor-change']('text-change', this.contents, null, source)
        }
    }

    updateContents(delta, source) {
        this.contents = this.contents.compose(new Delta(delta))
        this.updates.push({ delta, source })
        if (this.handlers['editor-change']) {
            this.handlers['editor-change']('text-change', new Delta(delta), null, source)
        }
    }

    // What quill 2 emits after a local user edit: editor-change('text-change', delta, old, 'user')
    emitUserChange(ops) {
        this.handlers['editor-change']('text-change', new Delta(ops), null, 'user')
    }
}

const createBoundEditor = seedFn => {
    const doc = new Y.Doc()
    const type = doc.getText('quill')
    if (seedFn) seedFn(type)
    const quill = new MockQuill()
    const binding = new QuillBinding(type, quill)
    return { doc, type, quill, binding }
}

const syncToFreshDoc = doc => {
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
    return copy.getText('quill').toDelta()
}

describe('QuillBinding (y-quill 1.0, unpatched) against the documented gotchas', () => {
    it('seeds the editor with the full document on bind', () => {
        const { quill } = createBoundEditor(type => {
            type.insert(0, 'seeded', { bold: true })
        })
        expect(quill.contents.ops[0]).toEqual({ insert: 'seeded', attributes: { bold: true } })
    })

    it('propagates format removal (bold: null retain) into yjs and persists it', () => {
        const { doc, type, quill, binding } = createBoundEditor(type => {
            type.insert(0, 'hello', { bold: true })
        })
        quill.emitUserChange([{ retain: 5, attributes: { bold: null } }])

        expect(type.toDelta().some(op => op.attributes && op.attributes.bold)).toBe(false)
        expect(syncToFreshDoc(doc).some(op => op.attributes && op.attributes.bold)).toBe(false)
        binding.destroy()
    })

    it('propagates background "None" (background: null via format(false)) into yjs', () => {
        const { doc, type, quill, binding } = createBoundEditor(type => {
            type.insert(0, 'marked', { background: '#FFE6C7' })
        })
        quill.emitUserChange([{ retain: 6, attributes: { background: null } }])

        expect(type.toDelta().some(op => op.attributes && op.attributes.background)).toBe(false)
        expect(syncToFreshDoc(doc).some(op => op.attributes && op.attributes.background)).toBe(false)
        binding.destroy()
    })

    it('does not bleed formatting onto a plain insert typed after formatted text', () => {
        const { doc, type, quill, binding } = createBoundEditor(type => {
            type.insert(0, 'bold', { bold: true })
        })
        quill.emitUserChange([{ retain: 4 }, { insert: ' plain' }])

        const plainOps = ops => ops.filter(op => typeof op.insert === 'string' && op.insert.includes('plain'))
        expect(plainOps(type.toDelta())[0].attributes).toBeUndefined()
        // The patched binding existed because the un-negated insert only bled AFTER a
        // persist/reload cycle — assert the persisted form too.
        expect(plainOps(syncToFreshDoc(doc))[0].attributes).toBeUndefined()
        binding.destroy()
    })

    it('negates known formats on remote inserts so quill cannot inherit them', () => {
        const { type, quill, binding } = createBoundEditor(type => {
            type.insert(0, 'bold', { bold: true })
        })
        // A remote client's plain typing arrives as an attribute-less applyDelta (a raw
        // ytext.insert would inherit by yjs design); the binding must hand quill explicit
        // bold:false so the editor does not visually inherit.
        type.applyDelta([{ retain: 4 }, { insert: ' remote' }])

        const last = quill.updates[quill.updates.length - 1]
        const insertOp = new Delta(last.delta).ops.find(op => op.insert && String(op.insert).includes('remote'))
        expect(insertOp.attributes).toEqual({ bold: false })
        binding.destroy()
    })

    it('converges two bound editors editing concurrently', () => {
        const a = createBoundEditor(type => type.insert(0, 'shared base '))
        const b = { doc: new Y.Doc() }
        Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
        const bType = b.doc.getText('quill')
        const bQuill = new MockQuill()
        const bBinding = new QuillBinding(bType, bQuill)

        a.quill.emitUserChange([{ insert: 'A-edit ', attributes: { bold: true } }])
        bQuill.emitUserChange([{ retain: 12 }, { insert: 'B-edit' }])

        const aUpdate = Y.encodeStateAsUpdate(a.doc)
        const bUpdate = Y.encodeStateAsUpdate(b.doc)
        Y.applyUpdate(b.doc, aUpdate)
        Y.applyUpdate(a.doc, bUpdate)

        expect(a.type.toDelta()).toEqual(bType.toDelta())
        // Each binding replayed the other client's edit into its editor surface. (The
        // mock never applies its own local edits, so full surface equality is not a
        // meaningful assertion here — remote delivery is.)
        const surfaceText = quill => quill.contents.ops.map(op => op.insert).join('')
        expect(surfaceText(a.quill)).toContain('B-edit')
        expect(surfaceText(bQuill)).toContain('A-edit')
        a.binding.destroy()
        bBinding.destroy()
    })
})
