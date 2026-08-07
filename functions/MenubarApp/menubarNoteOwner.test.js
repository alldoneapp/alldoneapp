'use strict'

const { __private__ } = require('./menubarApp')

const { resolveMenubarNoteOwnerId, getMenubarAssistantActor } = __private__

// AT-2194 follow-up. The Mac menubar meeting-notes flow already acts as the user's
// default assistant when it writes the feed entry ("Anna has created the note"), but
// the note itself was still owned by the signed-in human, so meeting notes showed the
// human's avatar in the notes list and were grouped under the human in the owner
// filter. These tests pin the ownership contract and, most importantly, the fallback:
// an unresolvable assistant must leave the previous behaviour untouched.
describe('resolveMenubarNoteOwnerId', () => {
    test('hands ownership to the resolved assistant', () => {
        expect(resolveMenubarNoteOwnerId({ assistantId: 'assistant-1' }, 'user-1')).toBe('assistant-1')
    })

    test('falls back to the acting user when no assistant could be resolved', () => {
        // getMenubarAssistantActor returns assistantId: null together with an
        // `anna-menubar` placeholder feed user when nothing resolves.
        expect(resolveMenubarNoteOwnerId({ assistantId: null }, 'user-1')).toBe('user-1')
        expect(resolveMenubarNoteOwnerId({}, 'user-1')).toBe('user-1')
        expect(resolveMenubarNoteOwnerId(undefined, 'user-1')).toBe('user-1')
    })

    test('treats a blank assistant id as unresolved rather than owning the note with it', () => {
        expect(resolveMenubarNoteOwnerId({ assistantId: '   ' }, 'user-1')).toBe('user-1')
        expect(resolveMenubarNoteOwnerId({ assistantId: 42 }, 'user-1')).toBe('user-1')
    })

    test('never assigns the anna-menubar placeholder as the owner', async () => {
        // A db where nothing resolves: no default project, no default assistant.
        const db = {
            doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
            getAll: async () => [{ exists: false }],
            collection: () => ({
                where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
            }),
        }

        const actor = await getMenubarAssistantActor(db, {})

        // The placeholder still drives the feed entry's display name...
        expect(actor.feedUser.uid).toBe('anna-menubar')
        expect(actor.assistantId).toBeNull()
        // ...but it is not a real assistant document, so owning a note with it would
        // render an unresolvable avatar and a phantom entry in the owner filter.
        expect(resolveMenubarNoteOwnerId(actor, 'user-1')).toBe('user-1')
        expect(resolveMenubarNoteOwnerId(actor, 'user-1')).not.toBe('anna-menubar')
    })

    test('assigns the real assistant once one resolves', async () => {
        const db = {
            doc: jest.fn(path => ({
                path,
                get: jest.fn(async () => ({
                    exists: path.startsWith('projects/'),
                    data: () => ({ assistantId: 'assistant-1' }),
                })),
            })),
            getAll: jest.fn(async () => [
                { exists: true, id: 'assistant-1', data: () => ({ displayName: 'Anna' }) },
                { exists: false },
            ]),
        }

        const actor = await getMenubarAssistantActor(db, { defaultProjectId: 'default-project' })

        expect(resolveMenubarNoteOwnerId(actor, 'user-1')).toBe('assistant-1')
    })
})
