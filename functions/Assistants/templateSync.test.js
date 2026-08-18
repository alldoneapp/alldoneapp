jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))
jest.mock(
    'firebase-admin/firestore',
    () => ({
        FieldValue: { delete: jest.fn(() => '__DELETE__') },
    }),
    { virtual: true }
)

const admin = require('firebase-admin')
const { syncDerivedAssistant, buildSyncActivityText } = require('./templateSync')

/**
 * Records every write so a test can assert on what the sync ANNOUNCED, not only on
 * what it wrote to the assistant doc. The silent-review bug (AT-2358) was invisible
 * in the assistant doc — it was correct there — and only observable as a missing
 * feed.
 */
function buildDb() {
    const feedWrites = []
    const batch = {
        set: jest.fn((ref, data) => feedWrites.push({ path: ref.path, data })),
        commit: jest.fn(async () => {}),
    }
    const db = {
        collection: jest.fn(() => ({ doc: jest.fn(() => ({ id: 'feed-1' })) })),
        doc: jest.fn(path => ({ path })),
        batch: jest.fn(() => batch),
    }
    admin.firestore.mockReturnValue(db)
    return { feedWrites }
}

function buildDerivedDoc(localAssistant) {
    const updates = []
    return {
        updates,
        doc: {
            ref: {
                path: 'assistants/project-1/items/assistant-1',
                update: jest.fn(async patch => updates.push(patch)),
            },
            data: () => localAssistant,
        },
    }
}

const TEMPLATE_BASE = {
    uid: 'template-1',
    displayName: 'Anna Alldone',
    temperature: 0.7,
    lastEditionDate: 1000,
}

describe('template sync activity feed (AT-2358)', () => {
    beforeEach(() => jest.clearAllMocks())

    // One logical sync activity fans out to both the object's inner feed and the
    // project-wide feed store, so count the inner-feed write to mean "one event".
    const syncFeeds = feedWrites =>
        feedWrites.filter(
            write =>
                write.data &&
                write.data.type === 'FEED_ASSISTANT_TEMPLATE_SYNCED' &&
                write.path.startsWith('projectsInnerFeeds/')
        )

    const feedStoreWrites = feedWrites => feedWrites.filter(write => write.path && write.path.startsWith('feedsStore/'))

    it('announces a sync that applied nothing because every change conflicted', async () => {
        const { feedWrites } = buildDb()
        // Local instructions diverge from the snapshot, so the template's new
        // instructions cannot be applied -> conflict, empty patch.
        const { doc, updates } = buildDerivedDoc({
            ...TEMPLATE_BASE,
            instructions: 'locally edited instructions',
            templateSyncSnapshot: { displayName: 'Anna Alldone', temperature: 0.7, instructions: 'old template' },
            copiedFromTemplateAssistantId: 'template-1',
        })

        await syncDerivedAssistant(
            doc,
            { ...TEMPLATE_BASE, instructions: 'old template' },
            { ...TEMPLATE_BASE, instructions: 'new template instructions' }
        )

        expect(updates[0].templateSyncStatus).toBe('needs_review')
        expect(updates[0].templateSyncConflicts).toHaveLength(1)

        const feeds = syncFeeds(feedWrites)
        expect(feeds).toHaveLength(1)
        expect(feeds[0].data.entryText).toContain('1 template change waiting for review')
        expect(feedStoreWrites(feedWrites)).toHaveLength(1)
        // The old wording would have claimed a successful sync of nothing.
        expect(feeds[0].data.entryText).not.toContain('synced 0')
    })

    it('stays silent when a template edit changes nothing for the derived assistant', async () => {
        const { feedWrites } = buildDb()
        const snapshot = { displayName: 'Anna Alldone', temperature: 0.7 }
        const { doc } = buildDerivedDoc({
            ...TEMPLATE_BASE,
            templateSyncSnapshot: snapshot,
            copiedFromTemplateAssistantId: 'template-1',
        })

        // Only lastEditionDate moved, which is a local field and never part of
        // template state.
        await syncDerivedAssistant(doc, TEMPLATE_BASE, { ...TEMPLATE_BASE, lastEditionDate: 2000 })

        expect(syncFeeds(feedWrites)).toHaveLength(0)
    })

    it('still announces a clean sync that applied changes', async () => {
        const { feedWrites } = buildDb()
        const { doc, updates } = buildDerivedDoc({
            ...TEMPLATE_BASE,
            templateSyncSnapshot: { displayName: 'Anna Alldone', temperature: 0.7 },
            copiedFromTemplateAssistantId: 'template-1',
        })

        await syncDerivedAssistant(doc, TEMPLATE_BASE, { ...TEMPLATE_BASE, temperature: 0.2 })

        expect(updates[0].temperature).toBe(0.2)
        expect(updates[0].templateSyncStatus).toBe('synced')
        const feeds = syncFeeds(feedWrites)
        expect(feeds).toHaveLength(1)
        expect(feeds[0].data.entryText).toContain('automatically synced 1 assistant setting')
        expect(feeds[0].data.entryText).not.toContain('need review')
        // The project-wide feed store must receive it too, or the activity is only
        // visible from inside the assistant — the very thing AT-2358 is about.
        expect(feedStoreWrites(feedWrites)).toHaveLength(1)
    })
})

describe('buildSyncActivityText', () => {
    it('describes a review-only sync without claiming a successful sync', () => {
        // Rendered as "{assistant name} has 1 template change waiting for review …"
        expect(buildSyncActivityText(0, 1, 'assistant setting')).toBe(
            'has 1 template change waiting for review — open the assistant to choose which version to keep'
        )
    })

    it('pluralises reviews', () => {
        expect(buildSyncActivityText(0, 3, 'assistant setting')).toContain('3 template changes waiting for review')
        expect(buildSyncActivityText(3, 3, 'assistant setting')).toContain('3 template changes need review')
    })

    it('combines applied changes with pending reviews', () => {
        const text = buildSyncActivityText(2, 1, 'assistant setting')
        expect(text).toContain('automatically synced 2 assistant settings from the template')
        expect(text).toContain('1 template change needs review')
    })

    it('omits the review clause when nothing conflicts', () => {
        expect(buildSyncActivityText(1, 0, 'template task setting')).toBe(
            'automatically synced 1 template task setting from the template'
        )
    })
})
