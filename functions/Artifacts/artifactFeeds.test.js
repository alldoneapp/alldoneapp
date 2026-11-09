// The Updates entries of artifacts (artifactFeeds.js), written through the real feed fan-out
// (Feeds/globalFeedsHelper.js) into an in-memory Admin Firestore.

function createFeedFirestore() {
    const documents = new Map()
    const writes = []
    const normalize = path => String(path).replace(/^\/+/, '')
    const snapshot = path => ({
        id: path.split('/').pop(),
        ref: { path },
        exists: documents.has(path),
        data: () => (documents.has(path) ? JSON.parse(JSON.stringify(documents.get(path))) : undefined),
    })
    const apply = (path, data, options = {}) => {
        const base = options.merge && documents.has(path) ? documents.get(path) : {}
        documents.set(path, { ...base, ...JSON.parse(JSON.stringify(data)) })
    }
    const db = {
        documents,
        writes,
        failCommits: false,
        doc(rawPath) {
            const path = normalize(rawPath)
            return { path, id: path.split('/').pop(), get: async () => snapshot(path) }
        },
        collection(rawPath) {
            const prefix = `${normalize(rawPath)}/`
            return {
                get: async () => ({
                    docs: [...documents.keys()]
                        .filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
                        .map(snapshot),
                }),
            }
        },
        batch() {
            const operations = []
            return {
                set(ref, data, options) {
                    operations.push(() => {
                        writes.push({ path: ref.path, data, options })
                        apply(ref.path, data, options)
                    })
                },
                update(ref, data) {
                    operations.push(() => apply(ref.path, data, { merge: true }))
                },
                delete(ref) {
                    operations.push(() => documents.delete(ref.path))
                },
                async commit() {
                    if (db.failCommits) throw new Error('commit failed')
                    operations.forEach(operation => operation())
                },
            }
        },
        seed(path, data) {
            documents.set(path, JSON.parse(JSON.stringify(data)))
        },
        reset() {
            documents.clear()
            writes.length = 0
            db.failCommits = false
        },
    }
    return db
}

const mockFeedDb = createFeedFirestore()
jest.mock('firebase-admin', () => ({ firestore: () => mockFeedDb }))
jest.mock('../GAnalytics/GAnalytics', () => ({ logEvent: jest.fn() }))

const {
    describeArtifactEvent,
    reconcileArtifactFeedObjectsPrivacy,
    recordArtifactDeletedFeed,
    recordArtifactHistoryFeed,
    recordArtifactMetadataFeeds,
    resolveArtifactFeedActor,
} = require('./artifactFeeds')
const {
    buildArtifactDeletionStamp,
    buildArtifactFeedId,
    generateArtifactObjectModel,
    getArtifactFeedReaders,
    isArtifactDeletionStampOnly,
} = require('./artifactFeedModel')

const PROJECT_ID = 'p1'
const ARTIFACT_ID = 'a1'
// 9 November 2026, noon UTC: the day card lives under 09112026.
const NOW = Date.UTC(2026, 10, 9, 12)
const DAY = '09112026'
const MEMBERS = ['owner', 'teammate']

const PUBLIC_ARTIFACT = {
    title: 'Sales dashboard',
    kind: 'web',
    userId: 'owner',
    isPrivate: false,
    isPublicFor: [0, 'owner'],
    followersIds: ['owner'],
    currentVersionId: 'v1',
    lastEditorId: 'owner',
}
const PRIVATE_ARTIFACT = {
    ...PUBLIC_ARTIFACT,
    isPrivate: true,
    isPublicFor: ['owner'],
    followersIds: ['owner', 'teammate'],
}

const paths = () => mockFeedDb.writes.map(write => write.path)
const read = path => mockFeedDb.documents.get(path)
const feedId = key => buildArtifactFeedId(ARTIFACT_ID, key)

function recordVersion(event, artifact = PUBLIC_ARTIFACT, historyId = 'version-v2') {
    return recordArtifactHistoryFeed({
        db: mockFeedDb,
        projectId: PROJECT_ID,
        artifactId: ARTIFACT_ID,
        artifact,
        historyId,
        event: { type: 'version', date: NOW, actorId: 'owner', versionNumber: 2, ...event },
        projectUserIds: MEMBERS,
    })
}

beforeEach(() => {
    mockFeedDb.reset()
})

describe('what an artifact event says in Updates', () => {
    it('names every change a member, an assistant or an MCP client makes', () => {
        const text = event => describeArtifactEvent(event)?.entryText
        expect(describeArtifactEvent({ type: 'created' })).toEqual({
            feedType: 'FEED_ARTIFACT_CREATED',
            entryText: 'created artifact',
        })
        expect(describeArtifactEvent({ type: 'version', versionNumber: 3, changeSummary: 'Adds Q3' })).toEqual({
            feedType: 'FEED_ARTIFACT_VERSION_SAVED',
            entryText: 'saved version 3 • Adds Q3',
        })
        expect(text({ type: 'version', versionNumber: 3 })).toBe('saved version 3')
        expect(text({ type: 'restored', versionNumber: 1 })).toBe('restored version 1')
        expect(text({ type: 'renamed', from: 'Sales', to: 'Sales 2026' })).toBe(
            'renamed artifact • From Sales to Sales 2026'
        )
        expect(text({ type: 'made_private' })).toBe('made artifact private')
        expect(text({ type: 'shared' })).toBe('shared artifact with the project')
        expect(text({ type: 'public_link_on' })).toBe('switched the public link on')
        expect(text({ type: 'public_link_off' })).toBe('switched the public link off')
        expect(text({ type: 'public_link_changed' })).toBe('replaced the public link with a new one')
        expect(text({ type: 'data_access_on' })).toBe('switched live project data on')
        expect(text({ type: 'data_access_off' })).toBe('switched live project data off')
    })

    it('shows a description change with both texts, shortened', () => {
        const describe = (fromDescription, toDescription) =>
            describeArtifactEvent({ type: 'description' }, { fromDescription, toDescription }).entryText
        expect(describe('Monthly', 'Weekly')).toBe('changed artifact description • From Monthly to Weekly')
        expect(describe('', 'Weekly')).toBe('added artifact description • Weekly')
        expect(describe('Monthly', '')).toBe('removed artifact description')
        expect(describe('', `Line one\n${'x'.repeat(80)}`)).toBe(
            `added artifact description • Line one ${'x'.repeat(41)}...`
        )
    })

    it('says nothing about what nobody decided', () => {
        expect(describeArtifactEvent({ type: 'link_rotated' })).toBeNull()
        expect(describeArtifactEvent({ type: 'link_reset' })).toBeNull()
        expect(describeArtifactEvent({ type: 'public_link_withdrawn' })).toBeNull()
    })

    it('names the user, with the MCP client that acted in their name, or the assistant', () => {
        expect(resolveArtifactFeedActor({ actorId: 'owner' })).toEqual({ uid: 'owner', id: 'owner' })
        expect(resolveArtifactFeedActor({ actorId: 'owner', via: 'mcp', viaClient: 'Codex' })).toEqual({
            uid: 'owner',
            id: 'owner',
            via: 'mcp',
            viaClient: 'Codex',
        })
        expect(resolveArtifactFeedActor({ actorId: 'owner', assistantId: 'anna' })).toEqual({
            uid: 'anna',
            id: 'anna',
        })
        // An MCP client has no assistant of its own; the user acted.
        expect(resolveArtifactFeedActor({ actorId: 'owner', assistantId: 'anna', via: 'mcp' })).toMatchObject({
            uid: 'owner',
            via: 'mcp',
        })
        expect(resolveArtifactFeedActor({ actorId: '' })).toBeNull()
    })
})

describe('an entry in Updates', () => {
    it('is written to the project, the followers, the artifact history and the day card', async () => {
        await expect(recordVersion({ changeSummary: 'Adds Q3', via: 'mcp', viaClient: 'Claude' })).resolves.toBe(1)

        const id = feedId('version-v2')
        expect(read(`feedsStore/${PROJECT_ID}/all/${id}`)).toEqual({
            type: 'FEED_ARTIFACT_VERSION_SAVED',
            lastChangeDate: NOW,
            creatorId: 'owner',
            objectId: ARTIFACT_ID,
            isPublicFor: [0, 'owner'],
            entryText: 'saved version 2 • Adds Q3',
            via: 'mcp',
            viaClient: 'Claude',
        })
        expect(read(`feedsStore/${PROJECT_ID}/owner/feeds/followed/${id}`)).toBeTruthy()
        expect(read(`projectsInnerFeeds/${PROJECT_ID}/artifacts/${ARTIFACT_ID}/feeds/${id}`)).toBeTruthy()
        expect(read(`projectsFeeds/${PROJECT_ID}/${DAY}/${ARTIFACT_ID}`)).toEqual({
            type: 'artifact',
            lastChangeDate: NOW,
            artifactId: ARTIFACT_ID,
            name: 'Sales dashboard',
            kind: 'web',
            userId: 'owner',
            isPublicFor: [0, 'owner'],
            isDeleted: false,
        })
        // The user hears of what their MCP client did, like everybody else.
        expect(paths()).toEqual(
            expect.arrayContaining([`feedsCount/${PROJECT_ID}/owner/followed`, `feedsCount/${PROJECT_ID}/teammate/all`])
        )
        expect(read(`feedsCount/${PROJECT_ID}/teammate/all`).artifacts[ARTIFACT_ID][id].feed.entryText).toBe(
            'saved version 2 • Adds Q3'
        )
    })

    it('never copies the title into the member-readable last states', async () => {
        await recordVersion({})
        expect(paths().filter(path => path.startsWith('feedsObjectsLastStates/'))).toEqual([])
    })

    it('does not notify the user of their own change in the app', async () => {
        await recordVersion({})
        expect(paths().filter(path => path.startsWith('feedsCount/'))).toEqual([
            `feedsCount/${PROJECT_ID}/teammate/all`,
        ])
    })

    it('of a private artifact is readable, delivered and announced to its owner only', async () => {
        await recordVersion({ assistantId: 'anna' }, PRIVATE_ARTIFACT)

        const id = feedId('version-v2')
        expect(read(`feedsStore/${PROJECT_ID}/all/${id}`)).toMatchObject({
            creatorId: 'anna',
            isPublicFor: ['owner'],
        })
        expect(read(`projectsFeeds/${PROJECT_ID}/${DAY}/${ARTIFACT_ID}`).isPublicFor).toEqual(['owner'])
        const teammatePaths = paths().filter(path => path.includes('/teammate/'))
        expect(teammatePaths).toEqual([])
        // The assistant made it, so its owner is told.
        expect(paths()).toContain(`feedsCount/${PROJECT_ID}/owner/followed`)
    })

    it('is the same entry when the same event is written again', async () => {
        await recordVersion({})
        const first = [...mockFeedDb.documents.keys()].sort()
        await recordVersion({})
        expect([...mockFeedDb.documents.keys()].sort()).toEqual(first)
        expect(first.filter(path => path.startsWith(`feedsStore/${PROJECT_ID}/all/`))).toEqual([
            `feedsStore/${PROJECT_ID}/all/${feedId('version-v2')}`,
        ])
    })

    it('is not written into a database other than the Admin SDK one', async () => {
        const other = createFeedFirestore()
        await expect(
            recordArtifactHistoryFeed({
                db: other,
                projectId: PROJECT_ID,
                artifactId: ARTIFACT_ID,
                artifact: PUBLIC_ARTIFACT,
                historyId: 'version-v2',
                event: { type: 'version', date: NOW, actorId: 'owner', versionNumber: 2 },
            })
        ).resolves.toBe(0)
        expect(other.writes).toEqual([])
        expect(mockFeedDb.writes).toEqual([])
    })

    it('never fails the artifact write when it cannot be stored', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        mockFeedDb.failCommits = true
        await expect(recordVersion({})).resolves.toBe(0)
        expect(warn).toHaveBeenCalledWith('[artifacts] Could not write the Updates entry', expect.any(Object))
        warn.mockRestore()
    })

    it('reads the project members when the caller has none at hand', async () => {
        mockFeedDb.seed(`projects/${PROJECT_ID}`, { userIds: MEMBERS })
        await recordArtifactHistoryFeed({
            db: mockFeedDb,
            projectId: PROJECT_ID,
            artifactId: ARTIFACT_ID,
            artifact: PUBLIC_ARTIFACT,
            historyId: '1-abc',
            event: { type: 'public_link_off', date: NOW, actorId: 'owner' },
        })
        expect(paths()).toContain(`feedsCount/${PROJECT_ID}/teammate/all`)
    })
})

describe('metadata edits from the update trigger', () => {
    const record = (after, before = PUBLIC_ARTIFACT) =>
        recordArtifactMetadataFeeds({
            db: mockFeedDb,
            projectId: PROJECT_ID,
            artifactId: ARTIFACT_ID,
            before,
            after,
            eventId: 'event-1',
            now: NOW,
        })

    beforeEach(() => mockFeedDb.seed(`projects/${PROJECT_ID}`, { userIds: MEMBERS }))

    it('write one entry per change, keyed by the trigger event like the history entries', async () => {
        await expect(
            record({
                ...PUBLIC_ARTIFACT,
                title: 'Sales 2026',
                description: 'Weekly',
                lastEditorId: 'teammate',
            })
        ).resolves.toBe(2)
        expect(read(`feedsStore/${PROJECT_ID}/all/${feedId('event-1-renamed')}`)).toMatchObject({
            type: 'FEED_ARTIFACT_TITLE_CHANGED',
            entryText: 'renamed artifact • From Sales dashboard to Sales 2026',
            creatorId: 'teammate',
            lastChangeDate: NOW,
        })
        expect(read(`feedsStore/${PROJECT_ID}/all/${feedId('event-1-description')}`)).toMatchObject({
            type: 'FEED_ARTIFACT_DESCRIPTION_CHANGED',
            entryText: 'added artifact description • Weekly',
        })
        // The card carries the new title.
        expect(read(`projectsFeeds/${PROJECT_ID}/${DAY}/${ARTIFACT_ID}`).name).toBe('Sales 2026')
    })

    it('make a change of audience readable only by the new audience', async () => {
        await record({ ...PUBLIC_ARTIFACT, isPrivate: true, isPublicFor: ['owner'] })
        expect(read(`feedsStore/${PROJECT_ID}/all/${feedId('event-1-made_private')}`)).toMatchObject({
            type: 'FEED_ARTIFACT_PRIVACY_CHANGED',
            entryText: 'made artifact private',
            isPublicFor: ['owner'],
        })
    })

    it('name the assistant or the MCP client that made the edit, for that edition only', async () => {
        await record({
            ...PUBLIC_ARTIFACT,
            title: 'By Anna',
            lastEditionDate: 50,
            lastEditorAssistant: { assistantId: 'anna', editionDate: 50 },
        })
        expect(read(`feedsStore/${PROJECT_ID}/all/${feedId('event-1-renamed')}`).creatorId).toBe('anna')

        mockFeedDb.reset()
        mockFeedDb.seed(`projects/${PROJECT_ID}`, { userIds: MEMBERS })
        await record({
            ...PUBLIC_ARTIFACT,
            title: 'By Claude',
            lastEditionDate: 60,
            lastEditorVia: { via: 'mcp', viaClient: 'Claude', editionDate: 60 },
            lastEditorAssistant: { assistantId: 'anna', editionDate: 50 },
        })
        expect(read(`feedsStore/${PROJECT_ID}/all/${feedId('event-1-renamed')}`)).toMatchObject({
            creatorId: 'owner',
            via: 'mcp',
            viaClient: 'Claude',
        })
    })

    it('write nothing for a version, which has its own entry, or for bookkeeping', async () => {
        await expect(record({ ...PUBLIC_ARTIFACT, title: 'New', currentVersionId: 'v2' })).resolves.toBe(0)
        await expect(record({ ...PUBLIC_ARTIFACT, readerIds: ['owner'], commentsData: { amount: 1 } })).resolves.toBe(0)
        expect(mockFeedDb.writes).toEqual([])
    })
})

describe('a deletion', () => {
    const remove = artifact =>
        recordArtifactDeletedFeed({
            db: mockFeedDb,
            projectId: PROJECT_ID,
            artifactId: ARTIFACT_ID,
            artifact,
            now: NOW,
        })

    beforeEach(() => mockFeedDb.seed(`projects/${PROJECT_ID}`, { userIds: MEMBERS }))

    it('is named after whoever stamped it and marks the card deleted', async () => {
        const stamp = buildArtifactDeletionStamp({ userId: 'teammate', now: NOW - 5 })
        await expect(remove({ ...PUBLIC_ARTIFACT, deletedBy: stamp })).resolves.toBe(1)
        expect(read(`feedsStore/${PROJECT_ID}/all/${feedId('deleted')}`)).toMatchObject({
            type: 'FEED_ARTIFACT_DELETED',
            entryText: 'deleted artifact',
            creatorId: 'teammate',
            lastChangeDate: NOW,
        })
        expect(read(`projectsFeeds/${PROJECT_ID}/${DAY}/${ARTIFACT_ID}`)).toMatchObject({
            isDeleted: true,
            name: 'Sales dashboard',
        })
    })

    it('ignores a stamp left behind by a delete that never happened', async () => {
        const stale = buildArtifactDeletionStamp({ userId: 'teammate', now: NOW - 24 * 60 * 60 * 1000 })
        await expect(remove({ ...PUBLIC_ARTIFACT, deletedBy: stale })).resolves.toBe(0)
        expect(read(`feedsStore/${PROJECT_ID}/all/${feedId('deleted')}`)).toBeUndefined()
    })

    it('by an MCP client or an assistant names them', async () => {
        await remove({
            ...PUBLIC_ARTIFACT,
            deletedBy: buildArtifactDeletionStamp({
                userId: 'owner',
                actorChannel: { via: 'mcp', viaClient: 'Codex' },
                now: NOW - 5,
            }),
        })
        expect(read(`feedsStore/${PROJECT_ID}/all/${feedId('deleted')}`)).toMatchObject({
            creatorId: 'owner',
            via: 'mcp',
            viaClient: 'Codex',
        })
        mockFeedDb.reset()
        mockFeedDb.seed(`projects/${PROJECT_ID}`, { userIds: MEMBERS })
        await remove({
            ...PUBLIC_ARTIFACT,
            deletedBy: buildArtifactDeletionStamp({ userId: 'owner', assistantId: 'anna', now: NOW - 5 }),
        })
        expect(read(`feedsStore/${PROJECT_ID}/all/${feedId('deleted')}`).creatorId).toBe('anna')
    })

    it('without a stamp gets no entry rather than a guessed deleter', async () => {
        await expect(remove(PUBLIC_ARTIFACT)).resolves.toBe(0)
        expect(mockFeedDb.writes).toEqual([])
    })
})

describe('the day cards after a change of audience', () => {
    const innerFeed = (id, lastChangeDate) =>
        mockFeedDb.seed(`projectsInnerFeeds/${PROJECT_ID}/artifacts/${ARTIFACT_ID}/feeds/${id}`, {
            lastChangeDate,
            isPublicFor: [0, 'owner'],
        })
    const reconcile = (before, after) =>
        reconcileArtifactFeedObjectsPrivacy({
            db: mockFeedDb,
            projectId: PROJECT_ID,
            artifactId: ARTIFACT_ID,
            before,
            after,
        })

    it('follow the artifact on every day it has entries for', async () => {
        const yesterday = NOW - 24 * 60 * 60 * 1000
        innerFeed('f1', NOW)
        innerFeed('f2', NOW + 1000)
        innerFeed('f3', yesterday)
        mockFeedDb.seed(`projectsFeeds/${PROJECT_ID}/${DAY}/${ARTIFACT_ID}`, {
            type: 'artifact',
            isPublicFor: [0, 'owner'],
        })
        mockFeedDb.seed(`projectsFeeds/${PROJECT_ID}/08112026/${ARTIFACT_ID}`, {
            type: 'artifact',
            isPublicFor: [0, 'owner'],
        })

        await expect(reconcile(PUBLIC_ARTIFACT, PRIVATE_ARTIFACT)).resolves.toBe(2)
        expect(read(`projectsFeeds/${PROJECT_ID}/${DAY}/${ARTIFACT_ID}`)).toEqual({
            type: 'artifact',
            isPublicFor: ['owner'],
        })
        expect(read(`projectsFeeds/${PROJECT_ID}/08112026/${ARTIFACT_ID}`).isPublicFor).toEqual(['owner'])
    })

    it('never creates a card that was not there, and leave everything alone when the audience stayed', async () => {
        innerFeed('f1', NOW)
        await expect(reconcile(PUBLIC_ARTIFACT, PRIVATE_ARTIFACT)).resolves.toBe(0)
        expect(read(`projectsFeeds/${PROJECT_ID}/${DAY}/${ARTIFACT_ID}`)).toBeUndefined()

        mockFeedDb.seed(`projectsFeeds/${PROJECT_ID}/${DAY}/${ARTIFACT_ID}`, {
            type: 'artifact',
            isPublicFor: [0, 'owner'],
        })
        await expect(reconcile(PUBLIC_ARTIFACT, { ...PUBLIC_ARTIFACT, title: 'Renamed' })).resolves.toBe(0)
        expect(read(`projectsFeeds/${PROJECT_ID}/${DAY}/${ARTIFACT_ID}`).isPublicFor).toEqual([0, 'owner'])
    })
})

describe('the trigger wiring in index.js', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8')
    const triggerBody = name => {
        const start = source.indexOf(`exports.${name} =`)
        const end = source.indexOf('\nexports.', start + 1)
        return source.slice(start, end)
    }

    it('writes the metadata entries and re-privatises entries and cards on every artifact update', () => {
        const update = triggerBody('onUpdateArtifactSecondGen')
        expect(update).toContain('recordArtifactMetadataFeeds(')
        expect(update).toContain("reconcileFeedPrivacy(event, 'artifacts')")
        expect(update).toContain('reconcileArtifactFeedObjectsPrivacy(')
        // The deleter's stamp is followed by the delete: nothing may be written back.
        expect(update.indexOf('if (isArtifactDeletionStampOnly(before, after)) return')).toBeLessThan(
            update.indexOf('synchronizeAccessProjection(')
        )
    })

    it('writes the deletion entry from the delete trigger', () => {
        expect(triggerBody('onDeleteArtifactSecondGen')).toContain('recordArtifactDeletedFeed(')
    })
})

describe('the shared feed model', () => {
    it('reads the audience from the artifact, falling back to its privacy flag', () => {
        expect(getArtifactFeedReaders({ isPublicFor: ['owner'] })).toEqual(['owner'])
        expect(getArtifactFeedReaders({ userId: 'owner', isPrivate: true })).toEqual(['owner'])
        expect(getArtifactFeedReaders({ userId: 'owner' })).toEqual([0, 'owner'])
        expect(generateArtifactObjectModel(1, { title: 'T', userId: 'o' }, 'a', { isDeleted: true })).toMatchObject({
            type: 'artifact',
            artifactId: 'a',
            name: 'T',
            isDeleted: true,
        })
    })

    it('keeps feed ids to characters a counter key can hold', () => {
        expect(buildArtifactFeedId('a-1_B', 'evt.1/2-renamed')).toBe('artifact_a-1_B_evt_1_2-renamed')
    })

    it('stamps a deletion with the actor, and recognises an update that only does that', () => {
        expect(buildArtifactDeletionStamp({ userId: 'u', now: 5 })).toEqual({ userId: 'u', date: 5 })
        expect(buildArtifactDeletionStamp({ userId: 'u', assistantId: 'anna', now: 5 })).toEqual({
            userId: 'u',
            date: 5,
            assistantId: 'anna',
        })
        expect(
            buildArtifactDeletionStamp({ userId: 'u', assistantId: 'anna', actorChannel: { via: 'mcp' }, now: 5 })
        ).toEqual({ userId: 'u', date: 5, via: 'mcp' })

        const stamped = { ...PUBLIC_ARTIFACT, deletedBy: { userId: 'u', date: 5 } }
        expect(isArtifactDeletionStampOnly(PUBLIC_ARTIFACT, stamped)).toBe(true)
        expect(isArtifactDeletionStampOnly(PUBLIC_ARTIFACT, { ...stamped, title: 'x' })).toBe(false)
        expect(isArtifactDeletionStampOnly(PUBLIC_ARTIFACT, PUBLIC_ARTIFACT)).toBe(false)
    })
})
