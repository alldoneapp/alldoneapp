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
    expect(commit).toHaveBeenCalled()
})
