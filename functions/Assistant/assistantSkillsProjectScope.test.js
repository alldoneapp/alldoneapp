/**
 * AT-2450 — a normal user may add skills for their own project's assistants.
 *
 * The two boundaries this suite exists to hold:
 *   1. the administrator's curated `globalProject` catalog is still
 *      administrator-only for writes, and
 *   2. a project catalog is reachable by that project's members and by nobody
 *      else — in particular not by a member of a different project.
 *
 * Plus the runtime half, which is the part with no UI to notice it going wrong:
 * a project's skills must actually reach that project's assistants.
 */
const admin = require('firebase-admin')

jest.mock('firebase-admin', () => {
    const userGet = jest.fn()
    const roleGet = jest.fn()
    const collectionGet = jest.fn()
    const getAll = jest.fn()
    const doc = jest.fn(path => ({ path, get: path === 'roles/administrator' ? roleGet : userGet }))
    const collection = jest.fn(path => ({ path, get: () => collectionGet(path) }))
    return {
        __mocks: { userGet, roleGet, collectionGet, getAll, doc, collection },
        firestore: jest.fn(() => ({ doc, collection, getAll })),
        storage: jest.fn(() => ({ bucket: jest.fn(() => ({})) })),
    }
})

const {
    requireSkillWriteAccess,
    requireSkillAdministrator,
    isProjectMember,
    isGlobalSkillCatalog,
    getSkillsCollectionPath,
    getSkillStoragePrefix,
    loadProjectSkills,
    mergeSkillsByName,
    loadEnabledSkillsForAssistant,
} = require('./assistantSkills')

const { userGet, roleGet, collectionGet, getAll } = admin.__mocks

const ADMIN_ID = 'admin-user'
const MEMBER_ID = 'member-user'
const OUTSIDER_ID = 'outsider-user'
const PROJECT_ID = 'project-abc'
const OTHER_PROJECT_ID = 'project-xyz'

const skillDoc = (id, data) => ({ id, data: () => data })

// A Firestore QuerySnapshot only has to expose forEach for the code under test.
const snapshotOf = docs => ({ forEach: callback => docs.forEach(callback) })

const asUser = (userId, userData) => {
    userGet.mockImplementation(() => {
        if (userData === null) return Promise.resolve({ exists: false })
        return Promise.resolve({ exists: true, data: () => userData })
    })
    return userId
}

describe('assistant skills project scoping (AT-2450)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        roleGet.mockResolvedValue({ exists: true, data: () => ({ userId: ADMIN_ID }) })
        userGet.mockResolvedValue({ exists: true, data: () => ({ projectIds: [PROJECT_ID] }) })
        collectionGet.mockResolvedValue(snapshotOf([]))
    })

    describe('isGlobalSkillCatalog', () => {
        it('treats a missing project id as the global catalog, so an old caller keeps its behaviour', () => {
            expect(isGlobalSkillCatalog(undefined)).toBe(true)
            expect(isGlobalSkillCatalog('')).toBe(true)
            expect(isGlobalSkillCatalog(null)).toBe(true)
            expect(isGlobalSkillCatalog('globalProject')).toBe(true)
        })

        it('treats any real project id as a project catalog', () => {
            expect(isGlobalSkillCatalog(PROJECT_ID)).toBe(false)
        })
    })

    describe('requireSkillWriteAccess — the global catalog', () => {
        it('still admits the administrator', async () => {
            await expect(requireSkillWriteAccess(ADMIN_ID, 'globalProject')).resolves.toBeUndefined()
        })

        it('refuses a normal user, even one who is a member of some project', async () => {
            await expect(requireSkillWriteAccess(MEMBER_ID, 'globalProject')).rejects.toMatchObject({
                code: 'permission-denied',
            })
        })

        it('refuses a normal user when no project id is supplied at all', async () => {
            // The pre-AT-2450 call shape. It must not become a way in.
            await expect(requireSkillWriteAccess(MEMBER_ID, undefined)).rejects.toMatchObject({
                code: 'permission-denied',
            })
        })

        it('refuses everyone when no administrator is configured', async () => {
            roleGet.mockResolvedValue({ exists: false })
            await expect(requireSkillWriteAccess(ADMIN_ID, 'globalProject')).rejects.toMatchObject({
                code: 'permission-denied',
            })
        })
    })

    describe('requireSkillWriteAccess — a project catalog', () => {
        it('admits a member of that project', async () => {
            asUser(MEMBER_ID, { projectIds: [PROJECT_ID] })
            await expect(requireSkillWriteAccess(MEMBER_ID, PROJECT_ID)).resolves.toBeUndefined()
        })

        it('refuses a member of a DIFFERENT project', async () => {
            asUser(OUTSIDER_ID, { projectIds: [OTHER_PROJECT_ID] })
            await expect(requireSkillWriteAccess(OUTSIDER_ID, PROJECT_ID)).rejects.toMatchObject({
                code: 'permission-denied',
            })
        })

        it('refuses a user document that does not exist', async () => {
            asUser(OUTSIDER_ID, null)
            await expect(requireSkillWriteAccess(OUTSIDER_ID, PROJECT_ID)).rejects.toMatchObject({
                code: 'permission-denied',
            })
        })

        it('does not consult the administrator role at all', async () => {
            asUser(MEMBER_ID, { projectIds: [PROJECT_ID] })
            await requireSkillWriteAccess(MEMBER_ID, PROJECT_ID)
            expect(roleGet).not.toHaveBeenCalled()
        })

        it('admits the administrator only when they are also a member', async () => {
            // Being the administrator is not membership: the global catalog is the
            // administrator's, a project is its members'.
            asUser(ADMIN_ID, { projectIds: [OTHER_PROJECT_ID] })
            await expect(requireSkillWriteAccess(ADMIN_ID, PROJECT_ID)).rejects.toMatchObject({
                code: 'permission-denied',
            })
        })
    })

    describe('isProjectMember mirrors the four lists firestore.rules checks', () => {
        it.each(['projectIds', 'guideProjectIds', 'templateProjectIds', 'archivedProjectIds'])(
            'accepts membership held in %s',
            async field => {
                asUser(MEMBER_ID, { [field]: [PROJECT_ID] })
                await expect(isProjectMember(MEMBER_ID, PROJECT_ID)).resolves.toBe(true)
            }
        )

        it('rejects when the field is present but not a list', async () => {
            asUser(MEMBER_ID, { projectIds: PROJECT_ID })
            await expect(isProjectMember(MEMBER_ID, PROJECT_ID)).resolves.toBe(false)
        })

        it('rejects a missing user id or project id rather than reading anything', async () => {
            await expect(isProjectMember(null, PROJECT_ID)).resolves.toBe(false)
            await expect(isProjectMember(MEMBER_ID, null)).resolves.toBe(false)
            expect(userGet).not.toHaveBeenCalled()
        })
    })

    describe('requireSkillAdministrator is unchanged', () => {
        it('still admits the administrator and refuses everyone else', async () => {
            await expect(requireSkillAdministrator(ADMIN_ID)).resolves.toBeUndefined()
            await expect(requireSkillAdministrator(MEMBER_ID)).rejects.toMatchObject({ code: 'permission-denied' })
        })
    })

    describe('storage isolation', () => {
        it('scopes a bundle to the catalog that owns it', () => {
            expect(getSkillStoragePrefix(PROJECT_ID, 'skill1', 1)).toBe(`assistantSkills/${PROJECT_ID}/skill1/1/`)
            expect(getSkillStoragePrefix(OTHER_PROJECT_ID, 'skill1', 1)).toBe(
                `assistantSkills/${OTHER_PROJECT_ID}/skill1/1/`
            )
        })

        it('never lets two projects share a prefix for the same skill id', () => {
            // The bundle is written before the skill document exists, so the prefix
            // is the only thing isolating one project's files from another's.
            expect(getSkillStoragePrefix(PROJECT_ID, 'skill1', 1)).not.toBe(
                getSkillStoragePrefix(OTHER_PROJECT_ID, 'skill1', 1)
            )
        })

        it('files an omitted project id under the global catalog', () => {
            expect(getSkillStoragePrefix(undefined, 'skill1', 2)).toBe('assistantSkills/globalProject/skill1/2/')
        })
    })

    describe('getSkillsCollectionPath', () => {
        it('keys the catalog on the owning project', () => {
            expect(getSkillsCollectionPath(PROJECT_ID)).toBe(`assistantSkills/${PROJECT_ID}/items`)
            expect(getSkillsCollectionPath()).toBe('assistantSkills/globalProject/items')
        })
    })

    describe('loadProjectSkills', () => {
        it('reads the project catalog and stamps each uid', async () => {
            collectionGet.mockResolvedValue(
                snapshotOf([skillDoc('s1', { name: 'deploy-runbook', body: 'x', enabled: true })])
            )
            await expect(loadProjectSkills(PROJECT_ID)).resolves.toEqual([
                { uid: 's1', name: 'deploy-runbook', body: 'x', enabled: true },
            ])
            expect(collectionGet).toHaveBeenCalledWith(`assistantSkills/${PROJECT_ID}/items`)
        })

        it('never reads anything for the global catalog', async () => {
            // Global skills are opt-in per assistant; returning them here would make
            // every global skill unconditionally active.
            await expect(loadProjectSkills('globalProject')).resolves.toEqual([])
            expect(collectionGet).not.toHaveBeenCalled()
        })

        it('drops disabled skills', async () => {
            collectionGet.mockResolvedValue(
                snapshotOf([
                    skillDoc('s1', { name: 'kept', enabled: true }),
                    skillDoc('s2', { name: 'switched-off', enabled: false }),
                ])
            )
            const skills = await loadProjectSkills(PROJECT_ID)
            expect(skills.map(skill => skill.name)).toEqual(['kept'])
        })

        it('drops a skill whose name could not be mounted', async () => {
            // `name` becomes a directory in the VM sandbox, so an invalid one is
            // dropped rather than sanitised.
            collectionGet.mockResolvedValue(
                snapshotOf([
                    skillDoc('s1', { name: '../escape', enabled: true }),
                    skillDoc('s2', { name: 'Has Spaces', enabled: true }),
                    skillDoc('s3', { name: 'fine-name', enabled: true }),
                ])
            )
            const skills = await loadProjectSkills(PROJECT_ID)
            expect(skills.map(skill => skill.name)).toEqual(['fine-name'])
        })
    })

    describe('mergeSkillsByName', () => {
        it('appends project skills after the catalog ones', () => {
            const merged = mergeSkillsByName([{ name: 'a' }], [{ name: 'b' }])
            expect(merged.map(skill => skill.name)).toEqual(['a', 'b'])
        })

        it('lets the curated catalog win a name collision', () => {
            // `name` is the identity `load_skill` resolves and the sandbox mount
            // directory, so a duplicate is a collision, not a preference.
            const catalog = [{ name: 'task-prioritization', body: 'curated' }]
            const project = [{ name: 'task-prioritization', body: 'project override' }]
            const merged = mergeSkillsByName(catalog, project)
            expect(merged).toHaveLength(1)
            expect(merged[0].body).toBe('curated')
        })

        it('collapses two project skills that share a name', () => {
            const merged = mergeSkillsByName(
                [],
                [
                    { name: 'dup', body: '1' },
                    { name: 'dup', body: '2' },
                ]
            )
            expect(merged).toHaveLength(1)
            expect(merged[0].body).toBe('1')
        })
    })

    describe('loadEnabledSkillsForAssistant', () => {
        const assistantDoc = data => ({ exists: true, data: () => data })

        it("adds the project's own skills to the assistant's enabled catalog skills", async () => {
            getAll.mockResolvedValue([{ exists: false }, assistantDoc({ enabledSkillIds: [] })])
            collectionGet.mockResolvedValue(snapshotOf([skillDoc('p1', { name: 'project-skill', enabled: true })]))

            const skills = await loadEnabledSkillsForAssistant(PROJECT_ID, 'assistant-1')
            expect(skills.map(skill => skill.name)).toEqual(['project-skill'])
        })

        it('makes a project skill available with no per-assistant enablement', async () => {
            // The whole point of the feature: adding a skill to a project is enough.
            getAll.mockResolvedValue([{ exists: false }, assistantDoc({})])
            collectionGet.mockResolvedValue(snapshotOf([skillDoc('p1', { name: 'project-skill', enabled: true })]))

            const skills = await loadEnabledSkillsForAssistant(PROJECT_ID, 'assistant-1')
            expect(skills.map(skill => skill.name)).toEqual(['project-skill'])
        })

        it('loads no project skills for an assistant resolved in the global project', async () => {
            getAll.mockResolvedValue([assistantDoc({ enabledSkillIds: [] }), { exists: false }])
            const skills = await loadEnabledSkillsForAssistant('globalProject', 'assistant-1')
            expect(skills).toEqual([])
            expect(collectionGet).not.toHaveBeenCalled()
        })

        it('returns nothing when the assistant does not exist, without reading the project catalog', async () => {
            getAll.mockResolvedValue([{ exists: false }, { exists: false }])
            await expect(loadEnabledSkillsForAssistant(PROJECT_ID, 'assistant-1')).resolves.toEqual([])
        })

        it('returns nothing when no assistant id is given', async () => {
            await expect(loadEnabledSkillsForAssistant(PROJECT_ID, undefined)).resolves.toEqual([])
            expect(getAll).not.toHaveBeenCalled()
        })
    })
})
