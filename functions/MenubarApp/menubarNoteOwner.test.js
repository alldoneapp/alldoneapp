'use strict'

const { __private__ } = require('./menubarApp')

const { resolveMenubarNoteOwnerId, getMenubarAssistantActor } = __private__

// AT-2194 follow-up. The Mac menubar meeting-notes flow already acts as an assistant when it
// writes the feed entry ("… has created the note"), so the note itself should belong to that
// assistant too, with the human kept as creator and follower.
//
// The production regression these tests pin: assistants live per project
// (`assistants/{projectId}/items`) plus a shared `assistants/globalProject/items` pool, and a
// client resolves a note owner against the *note project's* users/assistants plus that global
// pool only. The menubar used to always resolve the user's DEFAULT project assistant, so a
// meeting note filed into any other project was owned by an id nothing in that project could
// resolve — the notes list rendered the literal "Unknown" owner chip.
describe('resolveMenubarNoteOwnerId', () => {
    const NOTE_PROJECT = 'note-project'

    test('hands ownership to an assistant that lives in the note project', () => {
        const actor = { assistantId: 'assistant-1', assistantProjectId: NOTE_PROJECT }
        expect(resolveMenubarNoteOwnerId(actor, 'user-1', NOTE_PROJECT)).toBe('assistant-1')
    })

    test('hands ownership to a global assistant, which resolves in every project', () => {
        const actor = { assistantId: 'assistant-global', assistantProjectId: 'globalProject' }
        expect(resolveMenubarNoteOwnerId(actor, 'user-1', NOTE_PROJECT)).toBe('assistant-global')
    })

    test('never owns a note with an assistant from a different project', () => {
        // The AT-2194 production bug: default-project assistant, note filed elsewhere.
        const actor = { assistantId: 'assistant-of-other-project', assistantProjectId: 'default-project' }
        expect(resolveMenubarNoteOwnerId(actor, 'user-1', NOTE_PROJECT)).toBe('user-1')
    })

    test('falls back to the acting user when the note project is unknown', () => {
        const actor = { assistantId: 'assistant-1', assistantProjectId: 'some-project' }
        expect(resolveMenubarNoteOwnerId(actor, 'user-1', '')).toBe('user-1')
        expect(resolveMenubarNoteOwnerId(actor, 'user-1', undefined)).toBe('user-1')
    })

    test('falls back to the acting user when no assistant could be resolved', () => {
        // getMenubarAssistantActor returns assistantId: null together with an
        // `anna-menubar` placeholder feed user when nothing resolves.
        expect(resolveMenubarNoteOwnerId({ assistantId: null }, 'user-1', NOTE_PROJECT)).toBe('user-1')
        expect(resolveMenubarNoteOwnerId({}, 'user-1', NOTE_PROJECT)).toBe('user-1')
        expect(resolveMenubarNoteOwnerId(undefined, 'user-1', NOTE_PROJECT)).toBe('user-1')
    })

    test('treats a blank assistant id as unresolved rather than owning the note with it', () => {
        expect(resolveMenubarNoteOwnerId({ assistantId: '   ' }, 'user-1', NOTE_PROJECT)).toBe('user-1')
        expect(resolveMenubarNoteOwnerId({ assistantId: 42 }, 'user-1', NOTE_PROJECT)).toBe('user-1')
    })

    test('never assigns the anna-menubar placeholder as the owner', async () => {
        // A db where nothing resolves: no default project, no default assistant.
        const db = {
            doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
            getAll: async () => [{ exists: false }, { exists: false }],
            collection: () => ({
                where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
            }),
        }

        const actor = await getMenubarAssistantActor(db, {}, { targetProjectId: NOTE_PROJECT })

        // The placeholder still drives the feed entry's display name...
        expect(actor.feedUser.uid).toBe('anna-menubar')
        expect(actor.assistantId).toBeNull()
        // ...but it is not a real assistant document, so owning a note with it would
        // render an unresolvable avatar and a phantom entry in the owner filter.
        expect(resolveMenubarNoteOwnerId(actor, 'user-1', NOTE_PROJECT)).toBe('user-1')
        expect(resolveMenubarNoteOwnerId(actor, 'user-1', NOTE_PROJECT)).not.toBe('anna-menubar')
    })
})

describe('getMenubarAssistantActor', () => {
    /**
     * @param assistantsByPath e.g. { 'assistants/p1/items/a1': { displayName: 'A' } }
     * @param projectAssistantIds e.g. { p1: 'a1' }
     */
    const buildDb = (assistantsByPath, projectAssistantIds, globalDefault) => ({
        doc: path => ({
            path,
            get: async () => {
                const projectId = path.startsWith('projects/') ? path.slice('projects/'.length) : null
                const assistantId = projectId ? projectAssistantIds[projectId] : undefined
                return {
                    exists: Boolean(assistantId),
                    id: projectId,
                    data: () => (assistantId ? { assistantId } : {}),
                }
            },
        }),
        getAll: async (...refs) =>
            refs.map(ref => {
                const data = assistantsByPath[ref.path]
                return {
                    exists: Boolean(data),
                    id: ref.path.split('/').pop(),
                    data: () => data || {},
                }
            }),
        collection: () => ({
            where: () => ({
                limit: () => ({
                    get: async () => ({
                        docs: globalDefault ? [{ id: globalDefault.id, data: () => globalDefault.data }] : [],
                    }),
                }),
            }),
        }),
    })

    test('prefers the assistant of the project the note lands in', async () => {
        const db = buildDb(
            {
                'assistants/note-project/items/note-project-assistant': { displayName: 'JTL Assistant' },
                'assistants/default-project/items/default-assistant': { displayName: 'Anna Alldone' },
            },
            { 'note-project': 'note-project-assistant', 'default-project': 'default-assistant' }
        )

        const actor = await getMenubarAssistantActor(
            db,
            { defaultProjectId: 'default-project' },
            { targetProjectId: 'note-project' }
        )

        expect(actor.assistantId).toBe('note-project-assistant')
        expect(actor.assistantProjectId).toBe('note-project')
        expect(actor.feedUser.displayName).toBe('JTL Assistant')
        expect(resolveMenubarNoteOwnerId(actor, 'user-1', 'note-project')).toBe('note-project-assistant')
    })

    test('does not leak the default project assistant into another project', async () => {
        // The exact production shape: the note project has no assistant configured, and the
        // default project's assistant is a project-scoped copy (not a global one).
        const db = buildDb(
            { 'assistants/default-project/items/default-assistant': { displayName: 'Anna Alldone' } },
            { 'default-project': 'default-assistant' }
        )

        const actor = await getMenubarAssistantActor(
            db,
            { defaultProjectId: 'default-project' },
            { targetProjectId: 'note-project' }
        )

        expect(actor.assistantId).toBeNull()
        // ...so the human keeps the note instead of an owner nobody can resolve.
        expect(resolveMenubarNoteOwnerId(actor, 'user-1', 'note-project')).toBe('user-1')
    })

    test('falls back to the global default assistant, which is resolvable everywhere', async () => {
        const db = buildDb({}, {}, { id: 'global-anna', data: { displayName: 'Anna Alldone' } })

        const actor = await getMenubarAssistantActor(
            db,
            { defaultProjectId: 'default-project' },
            { targetProjectId: 'note-project' }
        )

        expect(actor.assistantId).toBe('global-anna')
        expect(actor.assistantProjectId).toBe('globalProject')
        expect(resolveMenubarNoteOwnerId(actor, 'user-1', 'note-project')).toBe('global-anna')
    })

    test("uses the user's global default assistant when the note project has none", async () => {
        const db = buildDb({ 'assistants/globalProject/items/user-default': { displayName: 'Lenny' } }, {})

        const actor = await getMenubarAssistantActor(
            db,
            { defaultProjectId: 'default-project', defaultAssistantId: 'user-default' },
            { targetProjectId: 'note-project' }
        )

        expect(actor.assistantId).toBe('user-default')
        expect(actor.assistantProjectId).toBe('globalProject')
    })

    test('keeps the default-project behaviour for the chat flows that pass no target project', async () => {
        const db = buildDb(
            { 'assistants/default-project/items/default-assistant': { displayName: 'Anna Alldone' } },
            { 'default-project': 'default-assistant' }
        )

        const actor = await getMenubarAssistantActor(db, { defaultProjectId: 'default-project' })

        expect(actor.assistantId).toBe('default-assistant')
        expect(actor.assistantProjectId).toBe('default-project')
    })
})
