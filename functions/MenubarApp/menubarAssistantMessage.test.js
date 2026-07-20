'use strict'

const { __private__ } = require('./menubarApp')

const {
    buildAssistantMessageDocId,
    decodeAssistantMessageAttachment,
    decodeAssistantMessageImage,
    isOwnedMacAppTopic,
    normalizeMenubarConversationTarget,
    normalizeAssistantThreadMessage,
    resolveMenubarConversationTarget,
    resolveMenubarAssistantThread,
    toMillis,
} = __private__

const PNG_BASE64 = Buffer.from('fake-png-bytes').toString('base64')

describe('menubar assistant message idempotency', () => {
    test('deduplicates retries of the same requestId', () => {
        expect(buildAssistantMessageDocId('user-1', 'ask-abc')).toBe(buildAssistantMessageDocId('user-1', 'ask-abc'))
    })

    test('separates users and requests', () => {
        expect(buildAssistantMessageDocId('user-1', 'ask-abc')).not.toBe(
            buildAssistantMessageDocId('user-2', 'ask-abc')
        )
        expect(buildAssistantMessageDocId('user-1', 'ask-abc')).not.toBe(
            buildAssistantMessageDocId('user-1', 'ask-def')
        )
    })
})

describe('menubar assistant message image validation', () => {
    test('image is optional', () => {
        expect(decodeAssistantMessageImage(undefined)).toBeNull()
        expect(decodeAssistantMessageImage(null)).toBeNull()
    })

    test('accepts a valid jpeg and derives a file name', () => {
        const image = decodeAssistantMessageImage({ mimeType: 'image/jpeg', dataBase64: PNG_BASE64 })
        expect(image.mimeType).toBe('image/jpeg')
        expect(image.fileName).toMatch(/^screenshot-\d+\.jpg$/)
        expect(image.data.equals(Buffer.from('fake-png-bytes'))).toBe(true)
    })

    test('accepts a valid png', () => {
        const image = decodeAssistantMessageImage({ mimeType: 'image/png', dataBase64: PNG_BASE64 })
        expect(image.fileName).toMatch(/\.png$/)
    })

    test('rejects unsupported mime types', () => {
        expect(() => decodeAssistantMessageImage({ mimeType: 'image/webp', dataBase64: PNG_BASE64 })).toThrow(
            'image mimeType is not supported'
        )
    })

    test('rejects malformed base64', () => {
        expect(() => decodeAssistantMessageImage({ mimeType: 'image/jpeg', dataBase64: 'not base64!!' })).toThrow(
            'image dataBase64 is invalid'
        )
        expect(() => decodeAssistantMessageImage({ mimeType: 'image/jpeg', dataBase64: '' })).toThrow(
            'image dataBase64 is invalid'
        )
    })

    test('rejects oversized images with a 413-mapped code', () => {
        const big = Buffer.alloc(5000001).toString('base64')
        let caught
        try {
            decodeAssistantMessageImage({ mimeType: 'image/jpeg', dataBase64: big })
        } catch (error) {
            caught = error
        }
        expect(caught).toBeDefined()
        expect(caught.code).toBe('IMAGE_TOO_LARGE')
    })
})

describe('menubar assistant message attachment validation', () => {
    test('attachment is optional', () => {
        expect(decodeAssistantMessageAttachment(undefined)).toBeNull()
        expect(decodeAssistantMessageAttachment(null)).toBeNull()
    })

    test('accepts a file and preserves its metadata', () => {
        const attachment = decodeAssistantMessageAttachment({
            fileName: 'brief.pdf',
            mimeType: 'application/pdf',
            dataBase64: PNG_BASE64,
        })
        expect(attachment.fileName).toBe('brief.pdf')
        expect(attachment.mimeType).toBe('application/pdf')
        expect(attachment.data.equals(Buffer.from('fake-png-bytes'))).toBe(true)
    })

    test('sanitizes path separators from the file name', () => {
        const attachment = decodeAssistantMessageAttachment({
            fileName: '../folder\\brief.pdf',
            mimeType: 'application/pdf',
            dataBase64: PNG_BASE64,
        })
        expect(attachment.fileName).toBe('.._folder_brief.pdf')
    })

    test('rejects invalid metadata and malformed base64', () => {
        expect(() =>
            decodeAssistantMessageAttachment({
                fileName: '',
                mimeType: 'application/pdf',
                dataBase64: PNG_BASE64,
            })
        ).toThrow('attachment fileName is required')
        expect(() =>
            decodeAssistantMessageAttachment({
                fileName: 'brief.pdf',
                mimeType: 'not-a-mime',
                dataBase64: PNG_BASE64,
            })
        ).toThrow('attachment mimeType is invalid')
        expect(() =>
            decodeAssistantMessageAttachment({
                fileName: 'brief.pdf',
                mimeType: 'application/pdf',
                dataBase64: 'not base64!!',
            })
        ).toThrow('attachment dataBase64 is invalid')
    })

    test('rejects oversized attachments with a 413-mapped code', () => {
        const big = Buffer.alloc(10000001).toString('base64')
        let caught
        try {
            decodeAssistantMessageAttachment({
                fileName: 'large.pdf',
                mimeType: 'application/pdf',
                dataBase64: big,
            })
        } catch (error) {
            caught = error
        }
        expect(caught).toBeDefined()
        expect(caught.code).toBe('ATTACHMENT_TOO_LARGE')
    })
})

describe('menubar assistant thread responses', () => {
    test('validates explicit cross-project conversation targets', () => {
        expect(
            normalizeMenubarConversationTarget({ projectId: 'project-2', objectId: 'task-9', objectType: 'tasks' })
        ).toEqual({ projectId: 'project-2', objectId: 'task-9', objectType: 'tasks' })
        expect(() =>
            normalizeMenubarConversationTarget({ projectId: 'project-2', objectId: 'task-9', objectType: 'unknown' })
        ).toThrow('target is invalid')
        expect(() =>
            normalizeMenubarConversationTarget({ projectId: '', objectId: 'task-9', objectType: 'tasks' })
        ).toThrow('target is invalid')
    })

    test('normalizes assistant loading comments without leaking app media tokens', () => {
        const imageToken =
            'O2TI5plHBf1QfdYhttps://example.com/full.jpgO2TI5plHBf1QfdYhttps://example.com/preview.jpgO2TI5plHBf1QfdYscreen.jpgO2TI5plHBf1QfdY0'
        const message = normalizeAssistantThreadMessage(
            'comment-1',
            {
                commentText: `**Looking at this** ${imageToken}`,
                creatorId: 'assistant-1',
                created: 1234,
                isThinking: true,
            },
            'assistant-1',
            'Anna',
            'user-1',
            'Karsten'
        )

        expect(message).toMatchObject({
            id: 'comment-1',
            role: 'assistant',
            authorName: 'Anna',
            createdAt: 1234,
            pending: true,
            richText: `**Looking at this** ${imageToken}`,
        })
        expect(message.text).toContain('Looking at this')
        expect(message.text).not.toContain('O2TI5plHBf1QfdY')
        expect(message.attachments).toEqual([
            expect.objectContaining({
                kind: 'image',
                fileName: 'screen.jpg',
                url: 'https://example.com/full.jpg',
                previewUrl: 'https://example.com/preview.jpg',
            }),
        ])
    })

    test('keeps user comments distinct from assistant comments', () => {
        const message = normalizeAssistantThreadMessage(
            'comment-2',
            { commentText: 'Hello Anna', creatorId: 'user-1', created: 50 },
            'assistant-1',
            'Anna',
            'user-1',
            'Karsten'
        )
        expect(message).toMatchObject({ role: 'user', authorName: 'Karsten', text: 'Hello Anna', pending: false })
    })

    test('only accepts Mac App topics owned by the authenticated user', () => {
        expect(isOwnedMacAppTopic('MacApp20260719user-1', { type: 'topics', creatorId: 'user-1' }, 'user-1')).toBe(true)
        expect(isOwnedMacAppTopic('MacApp20260719user-1', { type: 'topics', creatorId: 'other' }, 'user-1')).toBe(false)
        expect(isOwnedMacAppTopic('WhatsApp20260719user-1', { type: 'topics', creatorId: 'user-1' }, 'user-1')).toBe(
            false
        )
    })

    test('converts Firestore timestamps to milliseconds', () => {
        expect(toMillis({ seconds: 12, nanoseconds: 500000000 })).toBe(12500)
        expect(toMillis({ toMillis: () => 99 })).toBe(99)
    })

    test('resolves only an owned Mac App topic in the default project', async () => {
        const docs = {
            'projects/project-1': { userIds: ['user-1'], name: 'Project' },
            'chatObjects/project-1/chats/MacAppOwned': {
                id: 'MacAppOwned',
                type: 'topics',
                creatorId: 'user-1',
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

        const resolved = await resolveMenubarAssistantThread(
            db,
            'user-1',
            { defaultProjectId: 'project-1' },
            'MacAppOwned'
        )
        expect(resolved).toMatchObject({ projectId: 'project-1', chatId: 'MacAppOwned' })

        docs['chatObjects/project-1/chats/MacAppOwned'].creatorId = 'other-user'
        await expect(
            resolveMenubarAssistantThread(db, 'user-1', { defaultProjectId: 'project-1' }, 'MacAppOwned')
        ).resolves.toBeNull()
    })

    test('resolves a visible object thread in any project the user belongs to', async () => {
        const docs = {
            'projects/project-2': { userIds: ['user-1'], name: 'Second project' },
            'items/project-2/tasks/task-9': {
                assistantId: 'assistant-2',
                isAssistantEnabled: true,
            },
            'chatObjects/project-2/chats/task-9': {
                id: 'task-9',
                type: 'tasks',
                title: 'Important task',
                isPublicFor: [0],
            },
        }
        const db = {
            doc: path => ({
                get: async () => ({ exists: !!docs[path], data: () => docs[path] }),
            }),
        }

        await expect(
            resolveMenubarConversationTarget(db, 'user-1', {
                projectId: 'project-2',
                objectId: 'task-9',
                objectType: 'tasks',
            })
        ).resolves.toMatchObject({
            projectId: 'project-2',
            chatId: 'task-9',
            objectType: 'tasks',
            assistantId: 'assistant-2',
            assistantReplyEnabled: true,
            isAssistantThread: false,
        })

        docs['chatObjects/project-2/chats/task-9'].isPublicFor = ['other-user']
        await expect(
            resolveMenubarConversationTarget(db, 'user-1', {
                projectId: 'project-2',
                objectId: 'task-9',
                objectType: 'tasks',
            })
        ).resolves.toBeNull()
    })

    test('uses an explicit chat setting and suppresses regular replies for webhook tasks', async () => {
        const docs = {
            'projects/project-2': { userIds: ['user-1'], name: 'Second project' },
            'items/project-2/tasks/task-9': {
                assistantId: 'assistant-2',
                isAssistantEnabled: true,
                taskMetadata: { isWebhookTask: true },
            },
            'chatObjects/project-2/chats/task-9': {
                type: 'tasks',
                isPublicFor: [0],
                isAssistantEnabled: true,
            },
        }
        const db = {
            doc: path => ({
                get: async () => ({ exists: !!docs[path], data: () => docs[path] }),
            }),
        }

        await expect(
            resolveMenubarConversationTarget(db, 'user-1', {
                projectId: 'project-2',
                objectId: 'task-9',
                objectType: 'tasks',
            })
        ).resolves.toMatchObject({
            assistantId: 'assistant-2',
            assistantReplyEnabled: false,
        })

        docs['items/project-2/tasks/task-9'].taskMetadata.isWebhookTask = false
        docs['chatObjects/project-2/chats/task-9'].isAssistantEnabled = false
        await expect(
            resolveMenubarConversationTarget(db, 'user-1', {
                projectId: 'project-2',
                objectId: 'task-9',
                objectType: 'tasks',
            })
        ).resolves.toMatchObject({ assistantReplyEnabled: false })
    })
})
