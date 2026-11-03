const {
    SPECIALIST_ALLOWED_TOOLS,
    buildSpecialistInstructions,
    normalizeSpecialistCatalog,
    syncAlldoneTeamSpecialists,
} = require('./alldoneTeamSpecialists')

const connor = {
    id: 'story',
    persona: 'Connor Consultant',
    product: 'Story Builder',
    summary: 'Creates videos, product demos and slides with AI voiceover.',
    family: 'story',
    avatarUrl: 'https://alldone.team/connor_consultant.webp',
    pageUrl: 'https://alldone.team/connor-consultant/story-builder',
    intro: 'You are Connor Consultant, the storytelling specialist.',
    guide: 'Propose a storyline first.',
    mcpUrl: 'https://alldone.team/mcp',
}
const judy = { ...connor, id: 'judy', persona: 'Judy Job', product: 'Job Radar', family: 'judy', avatarUrl: null }

/** An in-memory Firestore with exactly the calls the sync makes. */
function buildDb(initial = {}) {
    const docs = new Map(Object.entries(initial))
    const ref = path => ({
        id: path.split('/').pop(),
        path,
        get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
        set: async data => docs.set(path, data),
        update: async patch =>
            docs.set(
                path,
                Object.entries(patch).reduce((doc, [key, value]) => {
                    const [first, ...rest] = key.split('.')
                    if (!rest.length) return { ...doc, [key]: value }
                    return { ...doc, [first]: { ...(doc[first] || {}), [rest.join('.')]: value } }
                }, docs.get(path))
            ),
    })
    return {
        docs,
        doc: path => ref(path),
        collection: base => ({
            doc: id => ref(`${base}/${id}`),
            where: (field, op, value) => ({
                get: async () => ({
                    docs: [...docs.entries()]
                        .filter(
                            ([path, data]) => path.startsWith(`${base}/`) && data.externalSource?.provider === value
                        )
                        .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data, ref: ref(path) })),
                }),
            }),
        }),
    }
}

const fetchCatalog = specialists =>
    jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ version: 'v1', specialists }) }))

const CONNOR_PATH = 'assistants/globalProject/items/alldone-team-story'

describe('alldone.team specialist catalog', () => {
    it('keeps only complete entries whose MCP server is alldone.team', () => {
        const entries = normalizeSpecialistCatalog({
            specialists: [
                connor,
                { ...connor, id: 'evil', mcpUrl: 'https://evil.example/mcp' },
                { ...connor, id: 'Bad Id' },
                { ...connor, id: 'nointro', intro: '' },
                { ...connor },
            ],
        })
        expect(entries.map(entry => entry.id)).toEqual(['story'])
    })

    it('drops an avatar that is not https', () => {
        expect(
            normalizeSpecialistCatalog({ specialists: [{ ...connor, avatarUrl: 'http://x/a.png' }] })[0].avatarUrl
        ).toBe(null)
    })

    it('speaks as the persona, then explains the alldone.app channel, then gives the guide', () => {
        const instructions = buildSpecialistInstructions(normalizeSpecialistCatalog({ specialists: [connor] })[0])
        expect(instructions.startsWith(connor.intro)).toBe(true)
        expect(instructions).toContain('Gold')
        expect(instructions).toMatch(/STORY BUILDER GUIDE\nPropose a storyline first\.$/)
    })
})

describe('syncAlldoneTeamSpecialists', () => {
    const now = 1793700000000

    it('creates a template per specialist with its own app as a managed MCP server', async () => {
        const db = buildDb({ 'roles/administrator': { userId: 'admin-1' } })
        const result = await syncAlldoneTeamSpecialists({ db, fetchImpl: fetchCatalog([connor, judy]), now })

        expect(result.created).toEqual(['alldone-team-story', 'alldone-team-judy'])
        const template = db.docs.get(CONNOR_PATH)
        expect(template).toMatchObject({
            displayName: 'Connor Consultant',
            description: connor.summary,
            photoURL50: connor.avatarUrl,
            creatorId: 'admin-1',
            lastEditionDate: now,
            isDefault: false,
            allowedTools: SPECIALIST_ALLOWED_TOOLS,
            externalSource: { provider: 'alldone.team', appId: 'story', family: 'story', available: true },
        })
        expect(template.mcpServers).toEqual([
            {
                id: 'alldone-team-story',
                label: 'Story Builder (alldone.team)',
                url: 'https://alldone.team/mcp',
                transport: 'http',
                authType: 'alldone_app',
                appIds: ['story'],
                enabled: true,
                managedBy: 'alldone.team',
            },
        ])
        expect(template.allowedTools).toContain('mcp_servers')
    })

    it('writes nothing when the catalog has not changed', async () => {
        const db = buildDb({ 'roles/administrator': { userId: 'admin-1' } })
        await syncAlldoneTeamSpecialists({ db, fetchImpl: fetchCatalog([connor]), now })
        const before = db.docs.get(CONNOR_PATH)

        const result = await syncAlldoneTeamSpecialists({ db, fetchImpl: fetchCatalog([connor]), now: now + 1 })

        expect(result.unchanged).toEqual(['alldone-team-story'])
        expect(db.docs.get(CONNOR_PATH)).toBe(before)
    })

    it('rewrites only the catalog fields and keeps what the administrator set', async () => {
        const db = buildDb({ 'roles/administrator': { userId: 'admin-1' } })
        await syncAlldoneTeamSpecialists({ db, fetchImpl: fetchCatalog([connor]), now })
        const own = { id: 'linear', url: 'https://mcp.linear.app/mcp', authType: 'oauth' }
        db.docs.set(CONNOR_PATH, {
            ...db.docs.get(CONNOR_PATH),
            model: 'MODEL_GPT6_LUNA',
            allowedTools: ['create_task'],
            mcpServers: [...db.docs.get(CONNOR_PATH).mcpServers, own],
        })

        const result = await syncAlldoneTeamSpecialists({
            db,
            fetchImpl: fetchCatalog([{ ...connor, intro: 'You are Connor, now even better.' }]),
            now: now + 1,
        })

        expect(result.updated).toEqual(['alldone-team-story'])
        const template = db.docs.get(CONNOR_PATH)
        expect(template.instructions.startsWith('You are Connor, now even better.')).toBe(true)
        expect(template.model).toBe('MODEL_GPT6_LUNA')
        // The specialist cannot work without its MCP tools, so they come back; the rest stays.
        expect(template.allowedTools).toEqual(['create_task', 'mcp_servers'])
        expect(template.mcpServers.map(server => server.id)).toEqual(['alldone-team-story', 'linear'])
        expect(template.lastEditionDate).toBe(now + 1)
    })

    it('marks a specialist alldone.team no longer offers as unavailable instead of deleting it', async () => {
        const db = buildDb({ 'roles/administrator': { userId: 'admin-1' } })
        await syncAlldoneTeamSpecialists({ db, fetchImpl: fetchCatalog([connor, judy]), now })

        const result = await syncAlldoneTeamSpecialists({ db, fetchImpl: fetchCatalog([connor]), now: now + 1 })

        expect(result.retired).toEqual(['alldone-team-judy'])
        expect(db.docs.get('assistants/globalProject/items/alldone-team-judy').externalSource).toMatchObject({
            appId: 'judy',
            available: false,
        })
    })

    it('changes nothing when the catalog cannot be read', async () => {
        const db = buildDb({ 'roles/administrator': { userId: 'admin-1' } })
        const fetchImpl = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))

        await expect(syncAlldoneTeamSpecialists({ db, fetchImpl, now })).rejects.toThrow('503')
        await expect(syncAlldoneTeamSpecialists({ db, fetchImpl: fetchCatalog([]), now })).rejects.toThrow(
            'no usable entries'
        )
        expect([...db.docs.keys()]).toEqual(['roles/administrator'])
    })
})
