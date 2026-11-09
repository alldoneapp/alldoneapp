'use strict'

const { moveNoteToDifferentProject, persistNoteMoveFeed } = require('./moveNoteToDifferentProject')

test('moves note metadata and Yjs content while preserving its ID', async () => {
    const sourceData = { id: 'note-1', projectId: 'project-a', extendedTitle: 'Meeting' }
    const sourceRef = {
        get: jest.fn(async () => ({ exists: true, data: () => sourceData })),
        update: jest.fn(async () => {}),
        delete: jest.fn(async () => {}),
    }
    const targetRef = {
        get: jest.fn(async () => ({ exists: false })),
        set: jest.fn(async () => {}),
    }
    const database = {
        doc: jest.fn(path => (path.includes('project-a') ? sourceRef : targetRef)),
    }
    const sourceFile = {
        exists: jest.fn(async () => [true]),
        copy: jest.fn(async () => {}),
    }
    const storage = {
        bucket: jest.fn(() => ({ file: jest.fn(() => sourceFile) })),
    }
    const copyChat = jest.fn(async () => {})
    const copyInnerFeeds = jest.fn(async () => {})

    const result = await moveNoteToDifferentProject({
        database,
        storage,
        sourceProjectId: 'project-a',
        targetProjectId: 'project-b',
        noteId: 'note-1',
        editorId: 'user-1',
        editorName: 'Ada',
        notesBucketName: 'notescontentprod',
        copyChat,
        copyInnerFeeds,
    })

    expect(result).toMatchObject({ moved: true, noteId: 'note-1', targetProjectId: 'project-b' })
    expect(sourceFile.copy).toHaveBeenCalledWith('gs://notescontentprod/notesData/project-b/note-1')
    expect(targetRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'note-1', projectId: 'project-b', lastEditorId: 'user-1' })
    )
    expect(sourceRef.update).toHaveBeenCalledWith(expect.objectContaining({ movingToOtherProjectId: 'project-b' }))
    expect(copyChat).toHaveBeenCalled()
    expect(copyInnerFeeds).toHaveBeenCalled()
    expect(sourceRef.delete).toHaveBeenCalled()
})

test('treats a retry after the source was deleted as an already completed move', async () => {
    const database = {
        doc: jest.fn(path => ({
            get: jest.fn(async () => ({ exists: path.includes('project-b') })),
        })),
    }

    await expect(
        moveNoteToDifferentProject({
            database,
            sourceProjectId: 'project-a',
            targetProjectId: 'project-b',
            noteId: 'note-1',
            notesBucketName: 'notescontentprod',
        })
    ).resolves.toMatchObject({ moved: false, reason: 'already_moved', noteId: 'note-1' })
})

test('makes a linked private note readable to the mover in the target project', async () => {
    const sourceRef = {
        get: jest.fn(async () => ({
            exists: true,
            data: () => ({ isPublicFor: ['source-only'], readerIds: ['source-only'] }),
        })),
        update: jest.fn(async () => {}),
        delete: jest.fn(async () => {}),
    }
    const targetRef = { get: jest.fn(async () => ({ exists: false })), set: jest.fn(async () => {}) }
    const database = { doc: jest.fn(path => (path.includes('project-a') ? sourceRef : targetRef)) }

    await moveNoteToDifferentProject({
        database,
        storage: { bucket: () => ({ file: () => ({ exists: async () => [false] }) }) },
        sourceProjectId: 'project-a',
        targetProjectId: 'project-b',
        targetProjectUserIds: ['actor'],
        noteId: 'note-1',
        editorId: 'actor',
        notesBucketName: 'notescontentprod',
        copyChat: async () => {},
        copyInnerFeeds: async () => {},
    })

    expect(targetRef.set.mock.calls[0][0]).toEqual(expect.objectContaining({ isPublicFor: ['actor'] }))
    expect(targetRef.set.mock.calls[0][0]).not.toHaveProperty('readerIds')
})

test('attributes the move feed to the assistant', async () => {
    const set = jest.fn()
    const commit = jest.fn(async () => {})
    const database = {
        doc: jest.fn(path => ({ path })),
        batch: jest.fn(() => ({ set, commit })),
    }

    await persistNoteMoveFeed(database, {
        targetProjectId: 'project-b',
        noteId: 'note-1',
        movedNote: { isPublicFor: [0, 'user-1'], followersIds: ['user-1'] },
        feedUser: { uid: 'assistant-1', displayName: 'Anna' },
        sourceProjectName: 'Inbox',
        sourceProjectColor: '#123456',
    })

    expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringContaining('projectsInnerFeeds/project-b/notes/note-1/feeds/') }),
        expect.objectContaining({ creatorId: 'assistant-1', type: 74, projectName: 'Inbox' })
    )
    expect(set.mock.calls[0][1]).not.toHaveProperty('via')
    expect(commit).toHaveBeenCalled()
})

// MCP feed parity: contacts and moves
describe('a note update_note moves', () => {
    function noteMoveDatabase({ failFeed = false } = {}) {
        const writes = []
        const sourceRef = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({ id: 'note-1', isPublicFor: [0, 'user-1'], followersIds: ['user-1'] }),
            })),
            update: jest.fn(async () => {}),
            delete: jest.fn(async () => {}),
        }
        const targetRef = { get: jest.fn(async () => ({ exists: false })), set: jest.fn(async () => {}) }
        const database = {
            doc: jest.fn(path => {
                if (path === 'noteItems/project-a/notes/note-1') return sourceRef
                if (path === 'noteItems/project-b/notes/note-1') return targetRef
                return { path }
            }),
            batch: jest.fn(() => ({
                set: (ref, data) => writes.push({ path: ref.path, data }),
                commit: jest.fn(async () => {
                    if (failFeed) throw new Error('feed store down')
                }),
            })),
        }
        return { database, writes, sourceRef }
    }
    const toolMove = (database, extra) =>
        moveNoteToDifferentProject({
            database,
            storage: { bucket: () => ({ file: () => ({ exists: async () => [false] }) }) },
            sourceProjectId: 'project-a',
            targetProjectId: 'project-b',
            noteId: 'note-1',
            editorId: 'user-1',
            notesBucketName: 'notescontentprod',
            copyChat: async () => {},
            copyInnerFeeds: async () => {},
            ...extra,
        })

    test('writes the "moved from" entry with the MCP actor', async () => {
        const { database, writes } = noteMoveDatabase()

        await toolMove(database, {
            feedUser: { uid: 'user-1', via: 'mcp', viaClient: 'Codex' },
            sourceProjectName: 'Inbox',
            sourceProjectColor: '#123456',
            moveFeedBestEffort: true,
        })

        const innerFeed = writes.find(write => write.path.startsWith('projectsInnerFeeds/project-b/notes/note-1/'))
        expect(innerFeed.data).toMatchObject({
            type: 74,
            creatorId: 'user-1',
            projectName: 'Inbox',
            projectColor: '#123456',
            changeDirection: 'from',
            isPublicFor: [0, 'user-1'],
            via: 'mcp',
            viaClient: 'Codex',
        })
    })

    test('a failing entry is logged and the move completes when the caller asked for best effort', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const { database, sourceRef } = noteMoveDatabase({ failFeed: true })

        await expect(
            toolMove(database, { feedUser: { uid: 'user-1' }, moveFeedBestEffort: true })
        ).resolves.toMatchObject({ moved: true })
        expect(sourceRef.delete).toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith(
            'Note move: failed to write the moved-note feed',
            expect.objectContaining({ error: 'feed store down' })
        )
        warn.mockRestore()
    })

    test('every other caller still fails the move on a failing entry', async () => {
        const { database, sourceRef } = noteMoveDatabase({ failFeed: true })

        await expect(toolMove(database, { feedUser: { uid: 'user-1' } })).rejects.toThrow('feed store down')
        expect(sourceRef.delete).not.toHaveBeenCalled()
    })
})
