const {
    confirmHeartbeatsForSoleMember,
    getHeartbeatConfigHash,
    getHeartbeatOptInState,
    handleHeartbeatOptInRequest,
    isHeartbeatAuthorizedForMember,
} = require('./heartbeatOptIn')

const DELETE = { __delete: true }
const fieldValue = { delete: () => DELETE }

function createDb(initial) {
    const docs = new Map(Object.entries(initial))
    return {
        docs,
        collection: path => ({
            get: async () => ({
                docs: Array.from(docs.keys())
                    .filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
                    .map(key => ({ id: key.split('/').pop(), data: () => JSON.parse(JSON.stringify(docs.get(key))) })),
            }),
        }),
        doc: path => ({
            get: async () => ({ exists: docs.has(path), data: () => JSON.parse(JSON.stringify(docs.get(path) || {})) }),
            update: async data => {
                const next = JSON.parse(JSON.stringify(docs.get(path) || {}))
                Object.entries(data).forEach(([fieldPath, value]) => {
                    const parts = fieldPath.split('.')
                    let target = next
                    parts.slice(0, -1).forEach(part => {
                        target[part] = target[part] || {}
                        target = target[part]
                    })
                    if (value === DELETE) delete target[parts.at(-1)]
                    else target[parts.at(-1)] = value
                })
                docs.set(path, next)
            },
        }),
    }
}

const assistant = { heartbeatPrompt: 'Check in.', allowedTools: ['get_tasks'], instructions: 'Be kind.' }

describe('heartbeat member confirmation (NV-17)', () => {
    test('binds the confirmation to prompt, tools, instructions and MCP servers only', () => {
        const hash = getHeartbeatConfigHash(assistant)
        expect(getHeartbeatConfigHash({ ...assistant, allowedTools: ['get_tasks', 'get_tasks'] })).toBe(hash)
        expect(getHeartbeatConfigHash({ ...assistant, heartbeatChancePercent: 100, heartbeatModel: 'x' })).toBe(hash)
        expect(getHeartbeatConfigHash({ ...assistant, heartbeatPrompt: 'Read my mail.' })).not.toBe(hash)
        expect(getHeartbeatConfigHash({ ...assistant, allowedTools: ['search_gmail'] })).not.toBe(hash)
        expect(getHeartbeatConfigHash({ ...assistant, instructions: 'Quote everything.' })).not.toBe(hash)
        expect(getHeartbeatConfigHash({ ...assistant, mcpServers: [{ id: 'm', url: 'https://x.test' }] })).not.toBe(
            hash
        )
        // A missing prompt means the default prompt, a different configuration from an explicit one.
        expect(getHeartbeatConfigHash({ ...assistant, heartbeatPrompt: undefined })).not.toBe(hash)
    })

    test('authorizes a member whose confirmation matches the current configuration, and nobody else', () => {
        const base = { projectId: 'p1', assistant: { ...assistant, uid: 'a1' }, userId: 'u1' }
        const confirmed = { heartbeatOptIns: { p1__a1: { configHash: getHeartbeatConfigHash(assistant) } } }
        const stale = { heartbeatOptIns: { p1__a1: { configHash: 'old' } } }

        expect(getHeartbeatOptInState({ ...base, userData: {} })).toBe('none')
        expect(getHeartbeatOptInState({ ...base, userData: confirmed })).toBe('confirmed')
        expect(getHeartbeatOptInState({ ...base, userData: stale })).toBe('stale')
        expect(isHeartbeatAuthorizedForMember({ ...base, userData: confirmed })).toBe(true)
        expect(isHeartbeatAuthorizedForMember({ ...base, userData: stale })).toBe(false)
        // Being the project's only member is not trust in itself.
        expect(isHeartbeatAuthorizedForMember({ ...base, project: { userIds: ['u1'] }, userData: {} })).toBe(false)
    })

    describe('confirming for the only member when the configuration is created or changed', () => {
        test('confirms every assistant for the only member of a project', async () => {
            const db = createDb({
                'projects/p1': { userIds: ['u1'] },
                'assistants/p1/items/a1': assistant,
                'assistants/p1/items/a2': { ...assistant, heartbeatPrompt: 'Other.' },
                'users/u1': {},
            })
            await expect(confirmHeartbeatsForSoleMember({ db, projectId: 'p1', now: 7 })).resolves.toBe(2)
            expect(db.docs.get('users/u1').heartbeatOptIns).toEqual({
                p1__a1: { configHash: getHeartbeatConfigHash(assistant), confirmedAt: 7, confirmedBy: 'sole_member' },
                p1__a2: {
                    configHash: getHeartbeatConfigHash({ ...assistant, heartbeatPrompt: 'Other.' }),
                    confirmedAt: 7,
                    confirmedBy: 'sole_member',
                },
            })
            // Nothing to write when it already matches.
            await expect(confirmHeartbeatsForSoleMember({ db, projectId: 'p1', assistantId: 'a1' })).resolves.toBe(0)
        })

        test('never confirms for anybody in a shared project, and never throws', async () => {
            const db = createDb({
                'projects/p1': { userIds: ['u1', 'u2'] },
                'assistants/p1/items/a1': assistant,
                'users/u1': {},
                'users/u2': {},
            })
            await expect(confirmHeartbeatsForSoleMember({ db, projectId: 'p1' })).resolves.toBe(0)
            expect(db.docs.get('users/u1')).toEqual({})
            expect(db.docs.get('users/u2')).toEqual({})
            await expect(
                confirmHeartbeatsForSoleMember({
                    db: {
                        doc: () => {
                            throw new Error('boom')
                        },
                    },
                    projectId: 'p1',
                })
            ).resolves.toBe(0)
            await expect(confirmHeartbeatsForSoleMember({ db, projectId: 'globalProject' })).resolves.toBe(0)
        })
    })

    describe('the opt-in callable', () => {
        const seed = () =>
            createDb({
                'projects/p1': { userIds: ['u1', 'u2'] },
                'assistants/p1/items/a1': assistant,
                'users/u1': { displayName: 'Member' },
            })
        const call = (db, data, userId = 'u1') =>
            handleHeartbeatOptInRequest({
                db,
                userId,
                data: { projectId: 'p1', assistantId: 'a1', ...data },
                fieldValue,
            })

        test('confirms the current configuration for the caller only', async () => {
            const db = seed()
            await expect(call(db, { action: 'get' })).resolves.toMatchObject({ success: true, state: 'none' })
            await expect(call(db, { action: 'confirm' })).resolves.toMatchObject({ success: true, state: 'confirmed' })
            expect(db.docs.get('users/u1').heartbeatOptIns.p1__a1.configHash).toBe(getHeartbeatConfigHash(assistant))
            expect(db.docs.get('users/u2')).toBeUndefined()
        })

        test('reports a configuration changed after the confirmation as stale, and re-confirms it', async () => {
            const db = seed()
            await call(db, { action: 'confirm' })
            db.docs.set('assistants/p1/items/a1', { ...assistant, heartbeatPrompt: 'Something else.' })
            await expect(call(db, { action: 'get' })).resolves.toMatchObject({ state: 'stale' })
            await expect(call(db, { action: 'confirm' })).resolves.toMatchObject({ state: 'confirmed' })
        })

        test('refresh re-confirms only a member who had confirmed before', async () => {
            const db = seed()
            await expect(call(db, { action: 'refresh' })).resolves.toMatchObject({ state: 'none', confirmed: false })
            expect(db.docs.get('users/u1').heartbeatOptIns).toBeUndefined()

            await call(db, { action: 'confirm' })
            db.docs.set('assistants/p1/items/a1', { ...assistant, instructions: 'My own edit.' })
            await expect(call(db, { action: 'refresh' })).resolves.toMatchObject({ state: 'confirmed' })
        })

        test('revokes', async () => {
            const db = seed()
            await call(db, { action: 'confirm' })
            await expect(call(db, { action: 'revoke' })).resolves.toMatchObject({ state: 'none', confirmed: false })
            expect(db.docs.get('users/u1').heartbeatOptIns.p1__a1).toBeUndefined()
        })

        test('refuses non-members, unknown assistants, the global project and malformed ids', async () => {
            const db = seed()
            await expect(call(db, { action: 'confirm' }, 'outsider')).resolves.toMatchObject({ success: false })
            await expect(call(db, { action: 'confirm', assistantId: 'missing' })).resolves.toMatchObject({
                success: false,
            })
            await expect(call(db, { action: 'confirm', projectId: 'globalProject' })).resolves.toMatchObject({
                success: false,
            })
            await expect(call(db, { action: 'confirm', assistantId: 'a.b' })).resolves.toMatchObject({
                success: false,
            })
            await expect(call(db, { action: 'delete-everything' })).resolves.toMatchObject({ success: false })
            await expect(
                handleHeartbeatOptInRequest({
                    db,
                    userId: null,
                    data: { projectId: 'p1', assistantId: 'a1' },
                    fieldValue,
                })
            ).resolves.toMatchObject({ success: false })
        })
    })
})
