const nodeCrypto = require('crypto')

if (!global.crypto) {
    global.crypto = nodeCrypto.webcrypto || {
        getRandomValues: typedArray => nodeCrypto.randomFillSync(typedArray),
    }
}

const Y = require('yjs')

const { NoteService, seedCurrentNoteFeedObject } = require('./NoteService')

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

const decodeDelta = buffer => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(buffer))
    return doc.getText('quill').toDelta()
}

describe('NoteService note creation formatting', () => {
    test('stores new note Markdown as Quill formatting', () => {
        const service = createService()
        const content = service.createNoteContent('Meeting', '# Meeting\n\n**Speaker 1**', { editorId: 'note-1' })
        const delta = decodeDelta(content)

        expect(delta).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ insert: '\n', attributes: { header: 1 } }),
                expect.objectContaining({ insert: 'Speaker 1', attributes: expect.objectContaining({ bold: true }) }),
            ])
        )
    })

    test('stores screenshot H4 syntax as headings instead of literal markers', () => {
        const service = createService()
        const markdown = [
            ' #### 4. Partnerperspektiven konkret einbauen',
            '- **Roger / Zigarrenschachtel:** tägliche Prüfung',
            '#### 5. Trust, control and learning',
        ].join('\n')

        const content = service.createNoteContent('Juno', markdown)
        const delta = decodeDelta(content)

        expect(delta.filter(op => op.insert === '\n' && op.attributes?.header === 4)).toHaveLength(2)
        expect(decodeContent(content)).not.toContain('####')
        expect(delta).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ insert: '4. Partnerperspektiven konkret einbauen' }),
                expect.objectContaining({ insert: '5. Trust, control and learning' }),
            ])
        )
    })
})

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
    test('includes the assistant actor and note owner as update feed followers', () => {
        const service = createService()

        expect(
            service.getNoteUpdateFeedFollowers(
                {
                    userId: 'user-1',
                    followersIds: ['user-1', 'user-2'],
                },
                { uid: 'assistant-1' }
            )
        ).toEqual(['assistant-1', 'user-1', 'user-2'])
    })

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

    test('converts markdown in patch replacement to Quill formatting', async () => {
        let savedBuffer = null
        const file = {
            exists: jest.fn(async () => [true]),
            download: jest.fn(async () => [encodePlainContent('Meeting Notes\nplaceholder')]),
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

        const markdown = '## Summary\n\n_Duration: 63 min_\n\n- First point\n- Second point'
        const result = await service.applyPatchEditsToStorage(
            'project-1',
            'note-1',
            [{ type: 'replace_text', find: 'placeholder', replaceWith: markdown }],
            { uid: 'user-1', displayName: 'Ada' }
        )

        expect(result.success).toBe(true)
        const delta = decodeDelta(savedBuffer)
        expect(delta).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ insert: '\n', attributes: { header: 2 } }),
                expect.objectContaining({ attributes: expect.objectContaining({ italic: true }) }),
                expect.objectContaining({ insert: '\n', attributes: expect.objectContaining({ list: 'bullet' }) }),
            ])
        )
        // Literal markdown markers must not survive in the rendered text.
        expect(decodeContent(savedBuffer)).not.toContain('## Summary')
        expect(decodeContent(savedBuffer)).not.toContain('- First point')
    })

    test('keeps later patch edits aligned when markdown conversion changes length', async () => {
        let savedBuffer = null
        const file = {
            exists: jest.fn(async () => [true]),
            download: jest.fn(async () => [encodePlainContent('AAA\nBBB')]),
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

        const result = await service.applyPatchEditsToStorage('project-1', 'note-1', [
            { type: 'replace_text', find: 'AAA', replaceWith: '## Heading' },
            { type: 'replace_text', find: 'BBB', replaceWith: 'CCC' },
        ])

        expect(result.success).toBe(true)
        // The second (plain) edit still lands on BBB even though the first edit's
        // markdown conversion shortened the inserted text relative to the raw markdown.
        expect(decodeContent(savedBuffer)).toBe('Heading\n\nCCC')
        expect(decodeDelta(savedBuffer)).toEqual(
            expect.arrayContaining([expect.objectContaining({ insert: '\n', attributes: { header: 2 } })])
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

    test('persists a feed when content is appended directly to storage', async () => {
        let savedBuffer = null
        const file = {
            exists: jest.fn(async () => [true]),
            download: jest.fn(async () => [encodePlainContent('# Karsten memory\n\n')]),
            save: jest.fn(async buffer => {
                savedBuffer = buffer
            }),
        }
        const noteDoc = {
            update: jest.fn(async () => {}),
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({
                    id: 'note-1',
                    title: 'karsten memory',
                    extendedTitle: 'Karsten memory',
                    userId: 'user-1',
                    isPrivate: false,
                    isPublicFor: [0, 'user-1'],
                }),
            })),
        }
        const service = createService({
            enableFeeds: true,
            storage: {
                bucket: jest.fn(() => ({
                    file: jest.fn(() => file),
                })),
            },
            database: {
                doc: jest.fn(() => noteDoc),
            },
        })
        const createNoteFeedSpy = jest.spyOn(service, 'createNoteFeed').mockResolvedValue({
            feedId: 'feed-1',
            feed: { id: 'feed-1' },
        })
        const persistNoteUpdateFeedSpy = jest.spyOn(service, 'persistNoteUpdateFeed').mockResolvedValue(true)

        await service.addContentToStorage('project-1', 'note-1', '2026-03-11: Prefers short summaries\n', {
            uid: 'assistant-1',
            displayName: 'Assistant',
        })

        expect(decodeContent(savedBuffer)).toBe('2026-03-11: Prefers short summaries\n# Karsten memory\n\n')
        expect(createNoteFeedSpy).toHaveBeenCalledWith(
            'updated',
            expect.objectContaining({
                noteId: 'note-1',
                projectId: 'project-1',
                feedUser: expect.objectContaining({ uid: 'assistant-1' }),
            })
        )
        expect(persistNoteUpdateFeedSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'project-1',
                noteId: 'note-1',
                feedUser: expect.objectContaining({ uid: 'assistant-1' }),
                feedData: expect.objectContaining({ feedId: 'feed-1' }),
            })
        )
    })
})

describe('NoteService feed persistence', () => {
    test('refreshes the feed object name from a renamed note while keeping the update action', () => {
        const historicalAction = { entryText: 'changed note title • From Old note name to New note name' }
        const batch = {
            feedObjects: { 'note-1': { type: 'note', name: 'Old note name' } },
            historicalActions: [historicalAction],
        }
        const generateNoteObjectModel = jest.fn((lastChangeDate, note, noteId) => ({
            type: 'note',
            lastChangeDate,
            noteId,
            name: note.extendedTitle || note.title,
        }))

        seedCurrentNoteFeedObject(
            batch,
            { title: 'new note name', extendedTitle: 'New note name' },
            'note-1',
            123,
            generateNoteObjectModel
        )

        expect(batch.feedObjects['note-1']).toEqual({
            type: 'note',
            lastChangeDate: 123,
            noteId: 'note-1',
            name: 'New note name',
        })
        expect(batch.historicalActions).toEqual([historicalAction])
    })

    test('loads project users before creating note feeds so notifications have recipients', async () => {
        const createNoteCreatedFeed = jest.fn(async () => {})
        const createNoteFollowedFeed = jest.fn(async () => {})
        jest.doMock('../Feeds/notesFeeds', () => ({
            createNoteCreatedFeed,
            createNoteFollowedFeed,
        }))
        const globalState = require('../GlobalState/globalState')
        const loadFeedsGlobalStateSpy = jest.spyOn(globalState, 'loadFeedsGlobalState')
        const noteSet = jest.fn(async () => {})
        const projectGet = jest.fn(async () => ({
            exists: true,
            data: () => ({
                userIds: ['user-1', 'user-2'],
                name: 'Project',
            }),
        }))
        const service = createService({
            enableFeeds: true,
            database: {
                collection: jest.fn(() => ({
                    doc: jest.fn(() => ({
                        set: noteSet,
                    })),
                })),
                doc: jest.fn(path => ({
                    get: path === 'projects/project-1' ? projectGet : jest.fn(async () => ({ exists: false })),
                })),
                batch: jest.fn(() => ({
                    set: jest.fn(),
                    commit: jest.fn(async () => {}),
                })),
            },
        })

        await service.persistNote(
            {
                note: {
                    id: 'note-1',
                    title: 'assistant note',
                    extendedTitle: 'Assistant note',
                    userId: 'user-1',
                    isPublicFor: [0],
                    stickyData: { days: 0 },
                },
                noteContent: Buffer.alloc(0),
                feedData: { feedId: 'feed-1' },
                noteId: 'note-1',
                success: true,
            },
            {
                projectId: 'project-1',
                feedUser: { uid: 'assistant-1', displayName: 'Anna' },
            }
        )

        expect(loadFeedsGlobalStateSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ uid: 'assistant-1' }),
            expect.objectContaining({ id: 'project-1', userIds: ['user-1', 'user-2'] }),
            [],
            null
        )
        expect(createNoteCreatedFeed).toHaveBeenCalledWith(
            'project-1',
            expect.objectContaining({ id: 'note-1' }),
            'note-1',
            expect.anything(),
            expect.objectContaining({ uid: 'assistant-1' }),
            true
        )
        expect(createNoteFollowedFeed).toHaveBeenCalled()
        jest.dontMock('../Feeds/notesFeeds')
    })
})
