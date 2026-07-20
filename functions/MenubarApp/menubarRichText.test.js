'use strict'

const { extractMenubarObjectLinks, resolveMenubarRichTextLinks } = require('./menubarRichText')

describe('menubar rich text object links', () => {
    test('extracts supported alldone.app object URLs and ignores other hosts', () => {
        const text = [
            'See https://my.alldone.app/projects/project-1/tasks/task-1/chat,',
            '[the note](https://my.alldone.app/projects/project-1/notes/note-1/editor)',
            'and https://example.com/projects/project-1/tasks/task-2',
        ].join(' ')

        expect(extractMenubarObjectLinks(text, 'https://my.alldone.app')).toEqual([
            expect.objectContaining({ kind: 'task', objectId: 'task-1' }),
            expect.objectContaining({ kind: 'note', objectId: 'note-1' }),
        ])
    })

    test('resolves accessible object titles and preserves exact URLs', async () => {
        const docs = {
            'projects/project-1': { userIds: ['user-1'] },
            'items/project-1/tasks/task-1': { extendedName: '**Finish report**' },
            'noteItems/project-1/notes/note-1': { extendedTitle: 'Launch notes' },
        }
        const db = {
            doc: path => ({
                get: async () => ({
                    exists: !!docs[path],
                    data: () => docs[path],
                }),
            }),
        }
        const taskUrl = 'https://my.alldone.app/projects/project-1/tasks/task-1/chat'
        const noteUrl = 'https://my.alldone.app/projects/project-1/notes/note-1/editor'

        await expect(
            resolveMenubarRichTextLinks(db, `${taskUrl} ${noteUrl}`, 'user-1', 'https://my.alldone.app')
        ).resolves.toEqual([
            { kind: 'task', title: 'Finish report', url: taskUrl },
            { kind: 'note', title: 'Launch notes', url: noteUrl },
        ])
    })

    test('does not resolve links from projects the user cannot access', async () => {
        const db = {
            doc: () => ({
                get: async () => ({ exists: true, data: () => ({ userIds: ['other-user'] }) }),
            }),
        }
        const url = 'https://my.alldone.app/projects/private-project/tasks/task-1'
        await expect(resolveMenubarRichTextLinks(db, url, 'user-1', 'https://my.alldone.app')).resolves.toEqual([])
    })

    test('does not reveal the title of a private linked object', async () => {
        const docs = {
            'projects/project-1': { userIds: ['user-1'] },
            'items/project-1/tasks/private-task': {
                extendedName: 'Private roadmap',
                isPrivate: true,
                userId: 'other-user',
                isPublicFor: ['other-user'],
            },
        }
        const db = {
            doc: path => ({
                get: async () => ({
                    exists: !!docs[path],
                    data: () => docs[path],
                }),
            }),
        }
        const url = 'https://my.alldone.app/projects/project-1/tasks/private-task/chat'

        await expect(resolveMenubarRichTextLinks(db, url, 'user-1', 'https://my.alldone.app')).resolves.toEqual([])
    })
})
