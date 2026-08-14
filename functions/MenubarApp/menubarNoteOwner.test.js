'use strict'

const { __private__ } = require('./menubarApp')

const { resolveMenubarNoteOwnerId, getMenubarAssistantActor } = __private__

// AT-2194. The Mac menubar meeting-notes flow already acts as an assistant when it writes the
// feed entry ("… has created the note"), so the note itself belongs to that assistant too, with
// the human kept as creator and follower.
//
// The assistant that owns the note is the one that ACTUALLY produced it: the user's default
// assistant, which transcribes and summarises the meeting (the Mac app stamps
// "Transcribed by <name>" into the note body). It keeps ownership no matter which project the
// note is filed into.
//
// An earlier follow-up scoped this resolution to the note's project so the owner id would be
// found by the notes list. That fixed an "Unknown" owner chip in the wrong layer — it handed
// authorship to a project assistant that did none of the work, and left the note body crediting
// a different assistant than the owner avatar. The real gap was a missing cross-project
// assistant fallback in `findNoteOwnerInProject`; these tests pin the ownership semantics that
// fix restores.
describe('resolveMenubarNoteOwnerId', () => {
    test('hands ownership to the assistant that produced the note', () => {
        const actor = { assistantId: 'assistant-1', assistantProjectId: 'note-project' }
        expect(resolveMenubarNoteOwnerId(actor, 'user-1')).toBe('assistant-1')
    })

    test('hands ownership to a global assistant', () => {
        const actor = { assistantId: 'assistant-global', assistantProjectId: 'globalProject' }
        expect(resolveMenubarNoteOwnerId(actor, 'user-1')).toBe('assistant-global')
    })

    test('keeps ownership with an assistant from another project than the note', () => {
        // The production shape of note dsSHRqBYKPJsw4S3hpAa: "Anna Alldone" lives in the user's
        // default project and the note was filed into "JTL Software - Project Juno". Anna
        // transcribed it, so Anna owns it — the client resolves assistants across projects.
        const actor = { assistantId: 'anna', assistantProjectId: 'default-project' }
        expect(resolveMenubarNoteOwnerId(actor, 'user-1')).toBe('anna')
    })

    test('falls back to the acting user when no assistant could be resolved', () => {
        // getMenubarAssistantActor returns assistantId: null together with an
        // `anna-menubar` placeholder feed user when nothing resolves.
        expect(resolveMenubarNoteOwnerId({ assistantId: null }, 'user-1')).toBe('user-1')
        expect(resolveMenubarNoteOwnerId({}, 'user-1')).toBe('user-1')
        expect(resolveMenubarNoteOwnerId(undefined, 'user-1')).toBe('user-1')
    })

    test('treats a blank or non-string assistant id as unresolved', () => {
        expect(resolveMenubarNoteOwnerId({ assistantId: '   ' }, 'user-1')).toBe('user-1')
        expect(resolveMenubarNoteOwnerId({ assistantId: 42 }, 'user-1')).toBe('user-1')
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

        const actor = await getMenubarAssistantActor(db, {})

        // The placeholder still drives the feed entry's display name...
        expect(actor.feedUser.uid).toBe('anna-menubar')
        expect(actor.assistantId).toBeNull()
        // ...but it is not a real assistant document, so owning a note with it would
        // render an unresolvable avatar and a phantom entry in the owner filter.
        expect(resolveMenubarNoteOwnerId(actor, 'user-1')).toBe('user-1')
        expect(resolveMenubarNoteOwnerId(actor, 'user-1')).not.toBe('anna-menubar')
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

    test("uses the default project's assistant — the one that actually processes the note", async () => {
        // Both projects have an assistant configured. The default project's wins, because that
        // is the assistant that transcribed the meeting; the note project's assistant did
        // nothing and must not be credited with the work.
        const db = buildDb(
            {
                'assistants/note-project/items/note-project-assistant': { displayName: 'JTL Assistant' },
                'assistants/default-project/items/default-assistant': { displayName: 'Anna Alldone' },
            },
            { 'note-project': 'note-project-assistant', 'default-project': 'default-assistant' }
        )

        const actor = await getMenubarAssistantActor(db, { defaultProjectId: 'default-project' })

        expect(actor.assistantId).toBe('default-assistant')
        expect(actor.assistantProjectId).toBe('default-project')
        expect(actor.feedUser.displayName).toBe('Anna Alldone')
        expect(resolveMenubarNoteOwnerId(actor, 'user-1')).toBe('default-assistant')
    })

    test('owns the note with the default project assistant even when filed into another project', async () => {
        // The exact production shape: the default project's assistant is a project-scoped copy
        // (not a global one) and the note lands in a project it does not belong to. It still
        // owns the note; the client resolves it across projects.
        const db = buildDb(
            { 'assistants/default-project/items/default-assistant': { displayName: 'Anna Alldone' } },
            { 'default-project': 'default-assistant' }
        )

        const actor = await getMenubarAssistantActor(db, { defaultProjectId: 'default-project' })

        expect(actor.assistantId).toBe('default-assistant')
        expect(actor.assistantProjectId).toBe('default-project')
        expect(resolveMenubarNoteOwnerId(actor, 'user-1')).toBe('default-assistant')
    })

    test('falls back to the global default assistant', async () => {
        const db = buildDb({}, {}, { id: 'global-anna', data: { displayName: 'Anna Alldone' } })

        const actor = await getMenubarAssistantActor(db, { defaultProjectId: 'default-project' })

        expect(actor.assistantId).toBe('global-anna')
        expect(actor.assistantProjectId).toBe('globalProject')
        expect(resolveMenubarNoteOwnerId(actor, 'user-1')).toBe('global-anna')
    })

    test("uses the user's stored default assistant when the default project has none", async () => {
        const db = buildDb({ 'assistants/globalProject/items/user-default': { displayName: 'Lenny' } }, {})

        const actor = await getMenubarAssistantActor(db, {
            defaultProjectId: 'default-project',
            defaultAssistantId: 'user-default',
        })

        expect(actor.assistantId).toBe('user-default')
        expect(actor.assistantProjectId).toBe('globalProject')
    })
})
