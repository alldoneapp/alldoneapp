'use strict'

const { __private__ } = require('./menubarApp')

const {
    buildNotePushDocId,
    buildLegacyNotePushDocId,
    normalizeNoteMove,
    resolveMenubarNotePrivacy,
    getMenubarAssistantActor,
    decodeNoteAttachments,
    rewriteMarkdownAttachmentUrls,
} = __private__

describe('menubar note idempotency', () => {
    test('deduplicates retries within the same project', () => {
        expect(buildNotePushDocId('user-1', 'meeting-1', 'project-a')).toBe(
            buildNotePushDocId('user-1', 'meeting-1', 'project-a')
        )
    })

    test('allows the same meeting to be filed in another project', () => {
        expect(buildNotePushDocId('user-1', 'meeting-1', 'project-a')).not.toBe(
            buildNotePushDocId('user-1', 'meeting-1', 'project-b')
        )
    })

    test('keeps the legacy key available for existing saves', () => {
        expect(buildLegacyNotePushDocId('user-1', 'meeting-1')).not.toBe(
            buildNotePushDocId('user-1', 'meeting-1', 'project-a')
        )
    })

    test('validates an explicit move of the existing note', () => {
        expect(normalizeNoteMove({ noteId: 'note-1', sourceProjectId: 'project-a' })).toEqual({
            noteId: 'note-1',
            sourceProjectId: 'project-a',
        })
        expect(() => normalizeNoteMove({ noteId: '', sourceProjectId: 'project-a' })).toThrow('move noteId is invalid')
    })
})

describe('menubar note privacy', () => {
    test('maps private notes to owner-only visibility', () => {
        expect(resolveMenubarNotePrivacy('user-1', true)).toEqual({
            isPrivate: true,
            isPublicFor: ['user-1'],
        })
    })

    test('keeps omitted or false privacy project-wide', () => {
        expect(resolveMenubarNotePrivacy('user-1', false)).toEqual({
            isPrivate: false,
            isPublicFor: [0, 'user-1'],
        })
        expect(resolveMenubarNotePrivacy('user-1')).toEqual({
            isPrivate: false,
            isPublicFor: [0, 'user-1'],
        })
    })
})

describe('menubar feed actor', () => {
    test("uses the default project's assistant rather than the signed-in user", async () => {
        const db = {
            doc: jest.fn(path => ({
                path,
                get: jest.fn(async () => ({
                    exists: path.startsWith('projects/'),
                    data: () => ({ assistantId: 'assistant-1' }),
                })),
            })),
            getAll: jest.fn(async () => [
                { exists: true, data: () => ({ displayName: 'Anna', photoURL50: 'anna.png' }) },
                { exists: false },
            ]),
        }

        // Resolves from the user's default project, not the project the note lands in.
        await expect(getMenubarAssistantActor(db, { defaultProjectId: 'default-project' })).resolves.toMatchObject({
            assistantId: 'assistant-1',
            feedUser: {
                uid: 'assistant-1',
                displayName: 'Anna',
                photoURL: 'anna.png',
                noteCreatedEntryText: 'has created the note',
            },
        })
    })
})

describe('menubar note attachments', () => {
    const attachment = {
        reference: 'Meeting screenshot 1.jpg',
        fileName: 'Meeting screenshot 1.jpg',
        mimeType: 'image/jpeg',
        dataBase64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
    }

    test('decodes a screenshot referenced by the transcript', () => {
        const result = decodeNoteAttachments([attachment], '# Meeting\n\n![Screenshot](<Meeting screenshot 1.jpg>)')

        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({
            reference: attachment.reference,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
        })
        expect(result[0].data).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    })

    test('rejects attachment paths outside the transcript directory', () => {
        expect(() =>
            decodeNoteAttachments([{ ...attachment, reference: '../secret.jpg' }], '![Screenshot](<../secret.jpg>)')
        ).toThrow('attachment reference is invalid')
    })

    test('rewrites only uploaded screenshot targets', () => {
        const url = 'https://firebasestorage.googleapis.com/uploaded.jpg?token=abc'
        const content = ['![Uploaded](<Meeting screenshot 1.jpg>)', '![Missing](<Meeting screenshot 2.jpg>)'].join('\n')

        expect(rewriteMarkdownAttachmentUrls(content, [{ reference: attachment.reference, url }])).toBe(
            [`![Uploaded](<${url}>)`, '![Missing](<Meeting screenshot 2.jpg>)'].join('\n')
        )
    })
})
