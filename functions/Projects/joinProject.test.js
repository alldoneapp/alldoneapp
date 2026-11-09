const { handleJoinProjectRequest, guideHasRoom, MAX_USERS_IN_GUIDES } = require('./joinProject')

// A small in-memory Firestore: documents by path, equality / array-contains queries and
// transactions that apply their writes only when the callback succeeds.
function createFakeDb(initialDocs) {
    const docs = new Map(Object.entries(JSON.parse(JSON.stringify(initialDocs))))
    let generatedIds = 0

    const docRef = path => ({
        _kind: 'doc',
        path,
        id: path.split('/').pop(),
        get: async () => snapshotOf(path),
    })
    const snapshotOf = path => ({
        exists: docs.has(path),
        id: path.split('/').pop(),
        ref: docRef(path),
        data: () => (docs.has(path) ? JSON.parse(JSON.stringify(docs.get(path))) : undefined),
    })
    const query = (collectionPath, filters = [], max = Infinity) => ({
        _kind: 'query',
        where: (field, op, value) => query(collectionPath, [...filters, { field, op, value }], max),
        limit: count => query(collectionPath, filters, count),
        get: async () => {
            const matches = [...docs.keys()]
                .filter(
                    path =>
                        path.startsWith(`${collectionPath}/`) && !path.slice(collectionPath.length + 1).includes('/')
                )
                .filter(path =>
                    filters.every(({ field, op, value }) => {
                        const fieldValue = docs.get(path)[field]
                        if (op === '==') return fieldValue === value
                        if (op === 'array-contains') return Array.isArray(fieldValue) && fieldValue.includes(value)
                        throw new Error(`unsupported op ${op}`)
                    })
                )
                .slice(0, max)
            return { docs: matches.map(snapshotOf), empty: matches.length === 0 }
        },
    })

    const db = {
        docs,
        doc: docRef,
        collection: path => ({
            ...query(path),
            doc: id => docRef(`${path}/${id || `generated-${++generatedIds}`}`),
        }),
        runTransaction: async callback => {
            const writes = []
            const tx = {
                get: ref => ref.get(),
                update: (ref, data) => writes.push(['update', ref.path, data]),
                set: (ref, data) => writes.push(['set', ref.path, data]),
                delete: ref => writes.push(['delete', ref.path]),
            }
            const result = await callback(tx)
            for (const [kind, path, data] of writes) {
                if (kind === 'delete') docs.delete(path)
                else if (kind === 'set') docs.set(path, JSON.parse(JSON.stringify(data)))
                else {
                    if (!docs.has(path)) throw new Error(`NOT_FOUND: ${path}`)
                    docs.set(path, { ...docs.get(path), ...JSON.parse(JSON.stringify(data)) })
                }
            }
            return result
        },
    }
    return db
}

const NOW = 1_800_000_000_000
const deps = { now: () => NOW, generateSortIndex: () => 42 }

const call = (db, uid, data, token = {}) =>
    handleJoinProjectRequest(db, { auth: uid ? { uid, token } : null, data }, deps)

const user = extra => ({ projectIds: [], guideProjectIds: [], templateProjectIds: [], invitedProjectIds: [], ...extra })

function baseDocs(extra = {}) {
    return {
        'roles/administrator': { userId: 'admin' },
        'users/owner': user({ projectIds: ['private-project', 'link-project', 'restricted-project'] }),
        'users/invitee': user({ invitedProjectIds: ['private-project'] }),
        'users/stranger': user(),
        'users/admin': user(),
        'users/creator': user({ projectIds: ['template'], templateProjectIds: ['template'] }),
        'projects/private-project': {
            name: 'Private',
            color: '#111',
            isShared: 2,
            userIds: ['owner'],
            creatorId: 'owner',
        },
        'projectsWorkstreams/private-project/workstreams/ws@default': { userIds: ['owner'] },
        'projects/link-project': { name: 'Link', isShared: 0, userIds: ['owner'], creatorId: 'owner' },
        'projects/restricted-project': { name: 'Restricted', isShared: 1, userIds: ['owner'], creatorId: 'owner' },
        'projects/template': {
            name: 'Course',
            color: '#222',
            isTemplate: true,
            isShared: 0,
            templateCreatorId: 'creator',
            userIds: ['creator'],
            guideProjectIds: ['guide-1'],
            globalAssistantIds: ['global-assistant'],
            assistantId: 'template-assistant',
        },
        'projects/guide-1': {
            name: 'Course 1',
            isShared: 0,
            parentTemplateId: 'template',
            userIds: ['creator', 'admin', 'member-1'],
            creatorId: 'creator',
        },
        'users/member-1': user({ projectIds: ['guide-1'], guideProjectIds: ['guide-1'] }),
        ...extra,
    }
}

describe('joinProjectSecondGen: accepting an invitation', () => {
    it('adds an invitee named by uid and consumes the invitation', async () => {
        const db = createFakeDb(
            baseDocs({
                'projectsInvitation/private-project/invitations/inv': {
                    userEmail: 'invitee@example.com',
                    inviterId: 'owner',
                    userId: 'invitee',
                },
            })
        )

        const result = await call(db, 'invitee', { projectId: 'private-project' })

        expect(result).toMatchObject({
            projectId: 'private-project',
            joinedVia: 'invitation',
            addedUserIds: ['invitee'],
            previousUserIds: ['owner'],
            isGuide: false,
        })
        expect(db.docs.get('projects/private-project').userIds).toEqual(['owner', 'invitee'])
        expect(db.docs.get('users/invitee')).toMatchObject({
            projectIds: ['private-project'],
            invitedProjectIds: [],
            lastEditionDate: NOW,
            lastEditorId: 'invitee',
        })
        expect(db.docs.get('projectsWorkstreams/private-project/workstreams/ws@default').userIds).toEqual([
            'owner',
            'invitee',
        ])
        expect(db.docs.has('projectsInvitation/private-project/invitations/inv')).toBe(false)
    })

    it('matches an invitation by the verified email of the caller, never an unverified one', async () => {
        const docs = baseDocs({
            'projectsInvitation/private-project/invitations/inv': {
                userEmail: 'New.Person@Example.com',
                inviterId: 'owner',
                userId: null,
            },
        })

        const unverified = createFakeDb(docs)
        await expect(
            call(unverified, 'stranger', { projectId: 'private-project' }, { email: 'new.person@example.com' })
        ).rejects.toMatchObject({ code: 'permission-denied' })
        expect(unverified.docs.get('projects/private-project').userIds).toEqual(['owner'])

        const verified = createFakeDb(docs)
        const result = await call(
            verified,
            'stranger',
            { projectId: 'private-project' },
            { email: 'new.person@example.com', email_verified: true }
        )
        expect(result.joinedVia).toBe('invitation')
        expect(verified.docs.get('projects/private-project').userIds).toEqual(['owner', 'stranger'])
        expect(verified.docs.has('projectsInvitation/private-project/invitations/inv')).toBe(false)
    })

    it('refuses a private project without an invitation and writes nothing', async () => {
        const db = createFakeDb(
            baseDocs({
                'projectsInvitation/private-project/invitations/inv': { userEmail: 'x@example.com', userId: 'invitee' },
            })
        )
        const before = JSON.stringify([...db.docs])

        await expect(
            call(db, 'stranger', { projectId: 'private-project' }, { email: 'x@example.com', email_verified: false })
        ).rejects.toMatchObject({ code: 'permission-denied' })
        expect(JSON.stringify([...db.docs])).toBe(before)
    })

    it('requires a signed-in caller and a project id', async () => {
        const db = createFakeDb(baseDocs())
        await expect(call(db, null, { projectId: 'link-project' })).rejects.toMatchObject({ code: 'unauthenticated' })
        await expect(call(db, 'stranger', { projectId: '../users/x' })).rejects.toMatchObject({
            code: 'invalid-argument',
        })
        await expect(call(db, 'stranger', { projectId: 'missing' })).rejects.toMatchObject({ code: 'not-found' })
    })
})

describe('joinProjectSecondGen: projects shared with link', () => {
    it('lets anyone join a project shared "With link"', async () => {
        const db = createFakeDb(baseDocs())
        const result = await call(db, 'stranger', { projectId: 'link-project' })
        expect(result.joinedVia).toBe('link')
        expect(db.docs.get('projects/link-project').userIds).toEqual(['owner', 'stranger'])
        expect(db.docs.get('users/stranger').projectIds).toEqual(['link-project'])
    })

    it('never lets a link visitor join a restricted project (it can only be copied)', async () => {
        const db = createFakeDb(baseDocs())
        await expect(call(db, 'stranger', { projectId: 'restricted-project' })).rejects.toMatchObject({
            code: 'permission-denied',
        })
    })

    it('answers an existing member without adding anything', async () => {
        const db = createFakeDb(baseDocs())
        const result = await call(db, 'owner', { projectId: 'restricted-project' })
        expect(result).toMatchObject({ joinedVia: 'member', addedUserIds: [] })
        expect(db.docs.get('projects/restricted-project').userIds).toEqual(['owner'])
    })
})

describe('joinProjectSecondGen: guides and templates', () => {
    it('lets only the template creator or the administrator join a guide directly', async () => {
        const db = createFakeDb(
            baseDocs({ 'projects/guide-1': { ...baseDocs()['projects/guide-1'], userIds: ['member-1'] } })
        )

        await expect(call(db, 'stranger', { projectId: 'guide-1' })).rejects.toMatchObject({
            code: 'permission-denied',
        })
        const creatorResult = await call(db, 'creator', { projectId: 'guide-1' })
        expect(creatorResult).toMatchObject({ joinedVia: 'guide_owner', isGuide: true, templateId: 'template' })
        expect(db.docs.get('users/creator').guideProjectIds).toEqual(['guide-1'])
        const adminResult = await call(db, 'admin', { projectId: 'guide-1' })
        expect(adminResult.joinedVia).toBe('guide_owner')
        expect(db.docs.get('projects/guide-1').userIds).toEqual(['member-1', 'creator', 'admin'])
    })

    it('places a template visitor into the last guide when it has room', async () => {
        const db = createFakeDb(baseDocs())

        const result = await call(db, 'stranger', { projectId: 'template', startGuide: true })

        expect(result).toMatchObject({
            projectId: 'guide-1',
            requestedProjectId: 'template',
            joinedVia: 'template_guide',
            addedUserIds: ['stranger'],
            previousUserIds: ['creator', 'admin', 'member-1'],
            isNewGuide: false,
            templateId: 'template',
        })
        expect(db.docs.get('projects/guide-1').userIds).toEqual(['creator', 'admin', 'member-1', 'stranger'])
        expect(db.docs.get('users/stranger')).toMatchObject({ projectIds: ['guide-1'], guideProjectIds: ['guide-1'] })
        // The visitor never becomes a member of the template itself.
        expect(db.docs.get('projects/template').userIds).toEqual(['creator'])
    })

    it('creates a new guide with the creator and the administrator when the last one is full', async () => {
        const fullGuideUserIds = ['creator', 'admin', ...Array.from({ length: MAX_USERS_IN_GUIDES }, (_, i) => `u${i}`)]
        const db = createFakeDb(
            baseDocs({ 'projects/guide-1': { ...baseDocs()['projects/guide-1'], userIds: fullGuideUserIds } })
        )

        const result = await call(db, 'stranger', {
            projectId: 'template',
            startGuide: true,
            timezone: 'Europe/Berlin',
        })

        expect(result).toMatchObject({
            joinedVia: 'template_guide',
            isNewGuide: true,
            addedUserIds: ['stranger', 'creator', 'admin'],
            previousUserIds: [],
        })
        const guide = db.docs.get(`projects/${result.projectId}`)
        expect(guide).toMatchObject({
            name: 'Course 2',
            color: '#222',
            creatorId: 'creator',
            parentTemplateId: 'template',
            isTemplate: false,
            userIds: ['stranger', 'creator', 'admin'],
            globalAssistantIds: ['global-assistant'],
            workstreamIds: [],
            sortIndexByUser: { creator: 42, stranger: 42 },
            assistantId: `${result.projectId}template-assistant`,
        })
        expect(guide.goalMilestonesConfig.timezone).toBe('Europe/Berlin')
        expect(db.docs.get('projects/template').guideProjectIds).toEqual(['guide-1', result.projectId])
        for (const uid of ['stranger', 'creator', 'admin']) {
            expect(db.docs.get(`users/${uid}`).guideProjectIds).toContain(result.projectId)
            expect(db.docs.get(`users/${uid}`).projectIds).toContain(result.projectId)
        }
    })

    it('returns the guide a visitor already belongs to instead of adding them twice', async () => {
        const db = createFakeDb(baseDocs())
        const result = await call(db, 'member-1', { projectId: 'template', startGuide: true })
        expect(result).toMatchObject({ projectId: 'guide-1', joinedVia: 'member', addedUserIds: [] })
        expect(db.docs.get('projects/guide-1').userIds).toEqual(['creator', 'admin', 'member-1'])
    })

    it('refuses a private template to a non-member', async () => {
        const db = createFakeDb(baseDocs({ 'projects/template': { ...baseDocs()['projects/template'], isShared: 2 } }))
        await expect(call(db, 'stranger', { projectId: 'template', startGuide: true })).rejects.toMatchObject({
            code: 'permission-denied',
        })
        expect(db.docs.get('projects/guide-1').userIds).toEqual(['creator', 'admin', 'member-1'])
    })

    it('adds the administrator to the template itself', async () => {
        const db = createFakeDb(baseDocs())
        const result = await call(db, 'admin', { projectId: 'template', startGuide: true })
        expect(result).toMatchObject({ projectId: 'template', joinedVia: 'administrator', addedUserIds: ['admin'] })
        expect(db.docs.get('projects/template').userIds).toEqual(['creator', 'admin'])
        expect(db.docs.get('users/admin').templateProjectIds).toEqual(['template'])
    })

    it('never makes a template visitor a member of the template itself', async () => {
        const db = createFakeDb(baseDocs())
        await expect(call(db, 'stranger', { projectId: 'template' })).rejects.toMatchObject({
            code: 'permission-denied',
        })
        expect(db.docs.get('projects/template').userIds).toEqual(['creator'])
    })

    it('lets an invitee of a template join the template itself', async () => {
        const db = createFakeDb(
            baseDocs({
                'projectsInvitation/template/invitations/inv': { userEmail: 's@example.com', userId: 'stranger' },
            })
        )
        const result = await call(db, 'stranger', { projectId: 'template' })
        expect(result).toMatchObject({ projectId: 'template', joinedVia: 'invitation', addedUserIds: ['stranger'] })
        expect(db.docs.get('users/stranger').templateProjectIds).toEqual(['template'])
    })

    it('counts the creator and the administrator outside the guide size limit', () => {
        const members = Array.from({ length: MAX_USERS_IN_GUIDES - 1 }, (_, i) => `u${i}`)
        expect(guideHasRoom({ userIds: [...members, 'creator', 'admin'] }, 'creator', 'admin')).toBe(true)
        expect(guideHasRoom({ userIds: [...members, 'u-last', 'creator', 'admin'] }, 'creator', 'admin')).toBe(false)
        expect(guideHasRoom(null, 'creator', 'admin')).toBe(false)
    })
})

describe('joinProjectSecondGen: declining an invitation', () => {
    it("removes only the caller's invitation and never adds a membership", async () => {
        const db = createFakeDb(
            baseDocs({
                'projectsInvitation/private-project/invitations/mine': {
                    userEmail: 'i@example.com',
                    userId: 'invitee',
                },
                'projectsInvitation/private-project/invitations/other': { userEmail: 'o@example.com', userId: 'other' },
            })
        )
        await expect(call(db, 'invitee', { projectId: 'private-project', decline: true })).resolves.toEqual({
            projectId: 'private-project',
            declinedInvitations: 1,
        })
        expect(db.docs.has('projectsInvitation/private-project/invitations/mine')).toBe(false)
        expect(db.docs.has('projectsInvitation/private-project/invitations/other')).toBe(true)
        expect(db.docs.get('users/invitee')).toMatchObject({ invitedProjectIds: [], projectIds: [] })
        expect(db.docs.get('projects/private-project').userIds).toEqual(['owner'])
    })
})

describe('joinProjectSecondGen: preview for the invitation popup', () => {
    it('shows an invitee the private project it cannot read yet, and nobody else', async () => {
        const db = createFakeDb(
            baseDocs({
                'projectsInvitation/private-project/invitations/inv': { userEmail: 'i@example.com', userId: 'invitee' },
            })
        )
        await expect(call(db, 'invitee', { projectId: 'private-project', preview: true })).resolves.toEqual({
            project: {
                id: 'private-project',
                name: 'Private',
                color: '#111',
                isShared: 2,
                isTemplate: false,
                parentTemplateId: '',
            },
            access: 'invitation',
        })
        await expect(call(db, 'stranger', { projectId: 'private-project', preview: true })).rejects.toMatchObject({
            code: 'permission-denied',
        })
        // The preview writes nothing.
        expect(db.docs.get('projects/private-project').userIds).toEqual(['owner'])
    })

    it('tells a link visitor that a restricted project cannot be joined', async () => {
        const db = createFakeDb(baseDocs())
        const preview = await call(db, 'stranger', { projectId: 'restricted-project', preview: true })
        expect(preview.access).toBeNull()
        expect((await call(db, 'stranger', { projectId: 'link-project', preview: true })).access).toBe('link')
    })
})
