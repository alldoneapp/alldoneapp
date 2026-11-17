import { ANNA_TARGET_MISSING, ANNA_TARGET_PROJECT_UNAVAILABLE, resolveAnnaActivityPath } from './annaActivityNavigation'

let mockState
let mockDocs
let mockReads
jest.mock('../../redux/store', () => ({ getState: () => mockState }))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../utils/backends/firestore', () => ({
    getDb: () => ({
        doc: path => ({
            get: async () => {
                mockReads.push(path)
                const value = mockDocs[path]
                if (value instanceof Error) throw value
                return { exists: value !== undefined, data: () => value }
            },
        }),
    }),
}))

const codeError = code => Object.assign(new Error(code), { code })

beforeEach(() => {
    mockState = {
        loggedUser: { uid: 'u1' },
        loggedUserProjectsMap: { p1: { id: 'p1', index: 0 }, p2: { id: 'p2', index: 3 } },
    }
    mockDocs = {}
    mockReads = []
})

describe('resolveAnnaActivityPath (AT-2906)', () => {
    it.each([
        ['/projects/p1/tasks/t1/properties', 'items/p1/tasks/t1'],
        ['/projects/p1/tasks/t1/chat', 'items/p1/tasks/t1'],
        ['/projects/p2/goals/g1/chat', 'goals/p2/items/g1'],
        ['/projects/p1/notes/n1/editor', 'noteItems/p1/notes/n1'],
        ['/projects/p2/contacts/c1/properties', 'projectsContacts/p2/contacts/c1'],
    ])('opens %s once the object exists', async (path, doc) => {
        mockDocs[doc] = { id: 'x' }
        expect(await resolveAnnaActivityPath(path)).toEqual({ path })
        expect(mockReads).toEqual([doc])
    })

    it('reports a deleted object instead of letting the route land on "All projects"', async () => {
        expect(await resolveAnnaActivityPath('/projects/p1/tasks/gone/properties')).toEqual({
            error: ANNA_TARGET_MISSING,
        })
    })

    it('treats an object the user may no longer read like a missing one', async () => {
        mockDocs['noteItems/p1/notes/private'] = codeError('permission-denied')
        expect(await resolveAnnaActivityPath('/projects/p1/notes/private/editor')).toEqual({
            error: ANNA_TARGET_MISSING,
        })
    })

    it('does not block on a check that is not an answer (offline, transient)', async () => {
        mockDocs['items/p1/tasks/t1'] = codeError('unavailable')
        expect(await resolveAnnaActivityPath('/projects/p1/tasks/t1/properties')).toEqual({
            path: '/projects/p1/tasks/t1/properties',
        })
    })

    it('reports a project this session cannot open, without reading anything', async () => {
        expect(await resolveAnnaActivityPath('/projects/left/tasks/t1/properties')).toEqual({
            error: ANNA_TARGET_PROJECT_UNAVAILABLE,
        })
        mockState.loggedUserProjectsMap.p1.index = -1
        expect(await resolveAnnaActivityPath('/projects/p1/tasks/t1/properties')).toEqual({
            error: ANNA_TARGET_PROJECT_UNAVAILABLE,
        })
        expect(mockReads).toEqual([])
    })

    describe('a thread opened by its chat object', () => {
        it.each([
            ['tasks', 'items/p1/tasks/o1', '/projects/p1/tasks/o1/chat'],
            ['goals', 'goals/p1/items/o1', '/projects/p1/goals/o1/chat'],
            ['notes', 'noteItems/p1/notes/o1', '/projects/p1/notes/o1/editor'],
            ['contacts', 'projectsContacts/p1/contacts/o1', '/projects/p1/contacts/o1/properties'],
        ])('opens the %s object it belongs to', async (type, doc, expected) => {
            mockDocs['chatObjects/p1/chats/o1'] = { type }
            mockDocs[doc] = { id: 'o1' }
            expect(await resolveAnnaActivityPath('/projects/p1/chats/o1/chat')).toEqual({ path: expected })
        })

        it('keeps a topic on its own chat', async () => {
            mockDocs['chatObjects/p1/chats/topic1'] = { type: 'topics' }
            expect(await resolveAnnaActivityPath('/projects/p1/chats/topic1/chat')).toEqual({
                path: '/projects/p1/chats/topic1/chat',
            })
        })

        it('reports a thread whose object was deleted', async () => {
            mockDocs['chatObjects/p1/chats/o1'] = { type: 'tasks' }
            expect(await resolveAnnaActivityPath('/projects/p1/chats/o1/chat')).toEqual({ error: ANNA_TARGET_MISSING })
        })

        it('reports a deleted thread', async () => {
            expect(await resolveAnnaActivityPath('/projects/p1/chats/gone/chat')).toEqual({
                error: ANNA_TARGET_MISSING,
            })
        })

        it("opens the logged user's chats for a thread the workspace has no view for", async () => {
            mockDocs['chatObjects/p1/chats/u2'] = { type: 'users' }
            expect(await resolveAnnaActivityPath('/projects/p1/chats/u2/chat')).toEqual({
                path: '/projects/p1/user/u1/chats/followed',
            })
        })
    })

    it('passes through paths it does not know', async () => {
        expect(await resolveAnnaActivityPath('/projects/p1/user/u1/updates/followed')).toEqual({
            path: '/projects/p1/user/u1/updates/followed',
        })
        expect(mockReads).toEqual([])
    })
})
