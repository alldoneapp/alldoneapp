const nodeCrypto = require('crypto')

if (!global.crypto) {
    global.crypto = nodeCrypto.webcrypto || {
        getRandomValues: typedArray => nodeCrypto.randomFillSync(typedArray),
    }
}

const Y = require('yjs')

const { NoteService } = require('./NoteService')

const createService = options =>
    new NoteService({
        database: null,
        storage: null,
        moment: { format: () => '01.01.2026 ' },
        enableFeeds: false,
        enableValidation: false,
        isCloudFunction: true,
        storageBucket: 'notescontentdev',
        ...options,
    })

const encodePlainContent = content => {
    const doc = new Y.Doc()
    const ytext = doc.getText('quill')
    ytext.insert(0, content)
    return Buffer.from(Y.encodeStateAsUpdate(doc))
}

const decodeContent = buffer => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(buffer))
    return doc.getText('quill').toString()
}

describe('NoteService patch planning', () => {
    test('replaces exact text when it appears once', () => {
        const service = createService()

        const result = service.buildPatchOperations('Alpha old text Omega', [
            { type: 'replace_text', find: 'old text', replaceWith: 'new text' },
        ])

        expect(result.success).toBe(true)
        expect(result.content).toBe('Alpha new text Omega')
        expect(result.changes).toEqual(['patched exact text'])
    })

    test('rejects ambiguous exact text unless occurrence is provided', () => {
        const service = createService()

        const result = service.buildPatchOperations('same then same', [
            { type: 'replace_text', find: 'same', replaceWith: 'changed' },
        ])

        expect(result.success).toBe(false)
        expect(result.error).toBe('PATCH_ANCHOR_AMBIGUOUS')
    })

    test('replaces a specified exact text occurrence', () => {
        const service = createService()

        const result = service.buildPatchOperations('same then same', [
            { type: 'replace_text', find: 'same', replaceWith: 'changed', occurrence: 2 },
        ])

        expect(result.success).toBe(true)
        expect(result.content).toBe('same then changed')
    })

    test('rejects missing anchors without producing operations', () => {
        const service = createService()

        const result = service.buildPatchOperations('Alpha Beta', [
            { type: 'insert_after', anchor: 'Gamma', content: '\nInserted' },
        ])

        expect(result.success).toBe(false)
        expect(result.error).toBe('PATCH_ANCHOR_NOT_FOUND')
        expect(result.changes).toEqual([])
    })

    test('replaces content under a heading until the next heading', () => {
        const service = createService()

        const result = service.buildPatchOperations(
            'Summary\nold line\nDetails\nkeep line',
            [{ type: 'replace_section', heading: 'Summary', content: 'new line\n' }],
            new Set(['Summary', 'Details'])
        )

        expect(result.success).toBe(true)
        expect(result.content).toBe('Summary\nnew line\nDetails\nkeep line')
    })

    test('applies multiple inserts in order', () => {
        const service = createService()

        const result = service.buildPatchOperations('Hello world', [
            { type: 'insert_before', anchor: 'world', content: 'beautiful ' },
            { type: 'insert_after', anchor: 'Hello', content: ',' },
        ])

        expect(result.success).toBe(true)
        expect(result.content).toBe('Hello, beautiful world')
        expect(result.changes).toEqual(['inserted content before anchor', 'inserted content after anchor'])
    })
})

describe('NoteService patch storage updates', () => {
    test('updates storage content and metadata for a safe patch', async () => {
        let savedBuffer = null
        const file = {
            exists: jest.fn(async () => [true]),
            download: jest.fn(async () => [encodePlainContent('Hello old world')]),
            save: jest.fn(async buffer => {
                savedBuffer = buffer
            }),
        }
        const update = jest.fn(async () => {})
        const service = createService({
            storage: {
                bucket: jest.fn(() => ({
                    file: jest.fn(() => file),
                })),
            },
            database: {
                doc: jest.fn(() => ({ update })),
            },
        })

        const result = await service.applyPatchEditsToStorage(
            'project-1',
            'note-1',
            [{ type: 'replace_text', find: 'old', replaceWith: 'new' }],
            { uid: 'user-1', displayName: 'Ada' }
        )

        expect(result.success).toBe(true)
        expect(decodeContent(savedBuffer)).toBe('Hello new world')
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                preview: 'Hello new world',
                lastEditorId: 'user-1',
                lastEditorName: 'Ada',
            })
        )
    })

    test('does not save storage or metadata when a patch is ambiguous', async () => {
        const file = {
            exists: jest.fn(async () => [true]),
            download: jest.fn(async () => [encodePlainContent('same same')]),
            save: jest.fn(async () => {}),
        }
        const update = jest.fn(async () => {})
        const service = createService({
            storage: {
                bucket: jest.fn(() => ({
                    file: jest.fn(() => file),
                })),
            },
            database: {
                doc: jest.fn(() => ({ update })),
            },
        })

        const result = await service.applyPatchEditsToStorage('project-1', 'note-1', [
            { type: 'replace_text', find: 'same', replaceWith: 'changed' },
        ])

        expect(result.success).toBe(false)
        expect(result.error).toBe('PATCH_ANCHOR_AMBIGUOUS')
        expect(file.save).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
    })

    test('ignores stray top-level content when valid patch edits are provided', async () => {
        let savedBuffer = null
        const file = {
            exists: jest.fn(async () => [true]),
            download: jest.fn(async () => [encodePlainContent('Keep old value')]),
            save: jest.fn(async buffer => {
                savedBuffer = buffer
            }),
        }
        const update = jest.fn(async () => {})
        const get = jest.fn(async () => ({
            exists: true,
            data: () => ({ preview: 'Keep new value' }),
        }))
        const service = createService({
            storage: {
                bucket: jest.fn(() => ({
                    file: jest.fn(() => file),
                })),
            },
            database: {
                doc: jest.fn(() => ({ update, get })),
            },
        })

        const result = await service.updateAndPersistNote({
            noteId: 'note-1',
            projectId: 'project-1',
            currentNote: { id: 'note-1', title: 'Note' },
            mode: 'patch',
            content: 'This must not be prepended',
            edits: [{ type: 'replace_text', find: 'old', replaceWith: 'new' }],
        })

        expect(result.success).toBe(true)
        expect(decodeContent(savedBuffer)).toBe('Keep new value')
    })

    test('returns a safe failure when patch mode has top-level content but no edits', async () => {
        const service = createService()

        const result = await service.updateAndPersistNote({
            noteId: 'note-1',
            projectId: 'project-1',
            currentNote: { id: 'note-1', title: 'Note' },
            mode: 'patch',
            content: 'Top-level patch content',
        })

        expect(result).toMatchObject({
            success: false,
            error: 'PATCH_EDITS_REQUIRED',
            persisted: false,
        })
    })
})
