/**
 * AT-2450 — the client half of project-scoped skills.
 *
 * Every read and write here is authorized by firestore.rules on the PATH it
 * targets, so the path a call builds is the security-relevant behaviour: send a
 * project skill to `assistantSkills/globalProject/items` and it is either
 * rejected (a normal user) or silently written into the curated catalog (the
 * administrator). This file had no test coverage at all before.
 */
import store from '../../../redux/store'
import { getDb, globalWatcherUnsub, runHttpsCallableFunction } from '../firestore'
import {
    approveAssistantSkillImport,
    deleteAssistantSkill,
    dismissAssistantSkillImport,
    getAssistantSkills,
    getGlobalAssistantSkills,
    importAssistantSkillsFromRepo,
    isGlobalSkillCatalog,
    updateAssistantSkill,
    uploadAssistantSkillBundleFile,
    uploadNewAssistantSkill,
    watchAssistantSkills,
    watchPendingSkillImports,
} from './assistantSkillsFirestore'

jest.mock('../../../redux/store', () => ({ getState: jest.fn(), dispatch: jest.fn() }))
jest.mock('../firestore', () => ({
    getDb: jest.fn(),
    getId: jest.fn(() => 'generated-id'),
    globalWatcherUnsub: {},
    runHttpsCallableFunction: jest.fn(() => Promise.resolve({ data: {} })),
}))
jest.mock('../../../redux/actions', () => ({ startLoadingData: jest.fn(), stopLoadingData: jest.fn() }))

const USER_ID = 'user-1'
const PROJECT_ID = 'project-abc'

// Records every path the code under test touches, which is what these assertions
// are really about.
let docPaths
let collectionPaths
let docHandles
let queryHandle
let unsubscribeSentinel

const makeSnapshot = (docs = []) => ({ docs, forEach: callback => docs.forEach(callback) })

beforeEach(() => {
    jest.clearAllMocks()
    docPaths = []
    collectionPaths = []
    docHandles = []
    store.getState.mockReturnValue({ loggedUser: { uid: USER_ID } })

    unsubscribeSentinel = jest.fn()
    queryHandle = {
        orderBy: jest.fn(() => queryHandle),
        where: jest.fn(() => queryHandle),
        get: jest.fn(() => Promise.resolve(makeSnapshot())),
        onSnapshot: jest.fn(() => unsubscribeSentinel),
    }

    getDb.mockReturnValue({
        doc: jest.fn(path => {
            docPaths.push(path)
            const handle = {
                path,
                set: jest.fn(() => Promise.resolve()),
                update: jest.fn(() => Promise.resolve()),
                delete: jest.fn(() => Promise.resolve()),
                get: jest.fn(() => Promise.resolve({ exists: false, data: () => undefined })),
                onSnapshot: jest.fn(),
            }
            docHandles.push(handle)
            return handle
        }),
        collection: jest.fn(path => {
            collectionPaths.push(path)
            return queryHandle
        }),
    })
})

const handleFor = path => docHandles.find(handle => handle.path === path)

describe('isGlobalSkillCatalog', () => {
    it('treats an omitted project id as the global catalog so existing callers are unchanged', () => {
        expect(isGlobalSkillCatalog(undefined)).toBe(true)
        expect(isGlobalSkillCatalog('globalProject')).toBe(true)
        expect(isGlobalSkillCatalog(PROJECT_ID)).toBe(false)
    })
})

describe('reads target the catalog they were asked for', () => {
    it('reads the global catalog by default', async () => {
        await getGlobalAssistantSkills()
        expect(collectionPaths).toEqual(['assistantSkills/globalProject/items'])
    })

    it("reads a project's own catalog when given a project id", async () => {
        await getAssistantSkills(PROJECT_ID)
        expect(collectionPaths).toEqual([`assistantSkills/${PROJECT_ID}/items`])
    })

    it('watches the catalog it was pointed at', () => {
        watchAssistantSkills(PROJECT_ID, 'watcher-key', jest.fn())
        expect(collectionPaths).toEqual([`assistantSkills/${PROJECT_ID}/items`])
        // The unsubscribe has to be the one Firestore handed back, or `unwatch`
        // leaves a live listener behind on every project switch.
        expect(globalWatcherUnsub['watcher-key']).toBe(unsubscribeSentinel)
    })

    it('merges the built-in skills into the global catalog only', async () => {
        const globalSkills = await getAssistantSkills('globalProject')
        expect(globalSkills.some(skill => skill.source?.type === 'builtin')).toBe(true)

        // A project does not own the built-ins and cannot edit them, so showing
        // them in its catalog would offer an edit that always fails.
        const projectSkills = await getAssistantSkills(PROJECT_ID)
        expect(projectSkills).toEqual([])
    })
})

describe('writes target the catalog they were asked for', () => {
    it('creates a project skill under that project', async () => {
        await uploadNewAssistantSkill({ name: 'a', displayName: 'A', uid: 'skill-1' }, PROJECT_ID)
        expect(docPaths).toContain(`assistantSkills/${PROJECT_ID}/items/skill-1`)
    })

    it('creates a global skill when no project is given, exactly as before', async () => {
        await uploadNewAssistantSkill({ name: 'a', displayName: 'A', uid: 'skill-1' })
        expect(docPaths).toContain('assistantSkills/globalProject/items/skill-1')
    })

    it('stamps the creator as the logged user, which the security rule pins on create', async () => {
        await uploadNewAssistantSkill({ name: 'a', displayName: 'A', uid: 'skill-1' }, PROJECT_ID)
        const stored = handleFor(`assistantSkills/${PROJECT_ID}/items/skill-1`).set.mock.calls[0][0]
        expect(stored.creatorId).toBe(USER_ID)
        expect(stored.lastEditorId).toBe(USER_ID)
        expect(stored.uid).toBeUndefined()
    })

    it('never sends creatorId in an update, because the rule freezes it', async () => {
        // A stale or rewritten creatorId would have the whole update rejected.
        await updateAssistantSkill({ uid: 'skill-1', name: 'a', creatorId: 'someone-else' }, PROJECT_ID)
        const patch = handleFor(`assistantSkills/${PROJECT_ID}/items/skill-1`).update.mock.calls[0][0]
        expect(patch).not.toHaveProperty('creatorId')
        expect(patch.lastEditorId).toBe(USER_ID)
    })

    it('deletes from the catalog it was given', async () => {
        await deleteAssistantSkill('skill-1', PROJECT_ID)
        expect(docPaths).toContain(`assistantSkills/${PROJECT_ID}/items/skill-1`)
        expect(handleFor(`assistantSkills/${PROJECT_ID}/items/skill-1`).delete).toHaveBeenCalled()
    })
})

describe('callables carry the project they are writing to', () => {
    it('sends the project id with a bundle upload', async () => {
        await uploadAssistantSkillBundleFile('skill-1', 1, 'scripts/run.py', 'AA==', PROJECT_ID)
        expect(runHttpsCallableFunction).toHaveBeenCalledWith(
            'uploadAssistantSkillFile',
            expect.objectContaining({ projectId: PROJECT_ID, skillId: 'skill-1' }),
            expect.anything()
        )
    })

    it('defaults a bundle upload to the global catalog', async () => {
        await uploadAssistantSkillBundleFile('skill-1', 1, 'scripts/run.py', 'AA==')
        expect(runHttpsCallableFunction).toHaveBeenCalledWith(
            'uploadAssistantSkillFile',
            expect.objectContaining({ projectId: 'globalProject' }),
            expect.anything()
        )
    })

    it('sends the project id with a repository import', async () => {
        await importAssistantSkillsFromRepo('owner/repo', null, 'job-1', PROJECT_ID)
        expect(runHttpsCallableFunction).toHaveBeenCalledWith(
            'importAssistantSkillsFromRepo',
            expect.objectContaining({ projectId: PROJECT_ID, repoUrl: 'owner/repo' }),
            expect.anything()
        )
    })
})

describe('import staging stays where each catalog can query it', () => {
    it("leaves the administrator's staging area on the flat collection", () => {
        // It holds live documents in production; moving it would strand them.
        watchPendingSkillImports('watcher-key', jest.fn())
        expect(collectionPaths).toEqual(['assistantSkillImports'])
    })

    it('stages a project import under that project', () => {
        watchPendingSkillImports('watcher-key', jest.fn(), PROJECT_ID)
        expect(collectionPaths).toEqual([`assistantSkillImports/${PROJECT_ID}/items`])
    })

    it('approves a project import into the project catalog and marks the project staging doc', async () => {
        await approveAssistantSkillImport(
            { uid: 'import-1', name: 'imported', proposedSkillId: 'skill-9' },
            [],
            PROJECT_ID
        )
        expect(docPaths).toContain(`assistantSkills/${PROJECT_ID}/items/skill-9`)
        expect(docPaths).toContain(`assistantSkillImports/${PROJECT_ID}/items/import-1`)
    })

    it('version-bumps in place when the project already has a skill of that name', async () => {
        await approveAssistantSkillImport(
            { uid: 'import-1', name: 'imported' },
            [{ uid: 'existing-skill', name: 'imported', version: 3 }],
            PROJECT_ID
        )
        const patch = handleFor(`assistantSkills/${PROJECT_ID}/items/existing-skill`).update.mock.calls[0][0]
        expect(patch.version).toBe(4)
    })

    it('dismisses a project import from the project staging area', async () => {
        await dismissAssistantSkillImport('import-1', PROJECT_ID)
        expect(docPaths).toContain(`assistantSkillImports/${PROJECT_ID}/items/import-1`)
    })

    it('dismisses a global import from the flat collection, unchanged', async () => {
        await dismissAssistantSkillImport('import-1')
        expect(docPaths).toContain('assistantSkillImports/import-1')
    })
})
