const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const {
    MAX_HISTORY_TEXT_CHARS,
    buildMetadataHistoryEvents,
    mapArtifactHistoryEvent,
    recordMetadataHistory,
} = require('./artifactHistory')

const BEFORE = {
    title: 'Sales',
    description: 'Monthly',
    isPrivate: false,
    currentVersionId: 'v1',
    lastEditorId: 'owner',
}

describe('artifact history from metadata edits', () => {
    it('records a rename with both titles, a new description and a change of audience', () => {
        const events = buildMetadataHistoryEvents(
            BEFORE,
            { ...BEFORE, title: 'Sales 2026', description: 'Weekly', isPrivate: true, lastEditorId: 'teammate' },
            5
        )
        expect(events).toEqual([
            { type: 'renamed', date: 5, actorId: 'teammate', from: 'Sales', to: 'Sales 2026' },
            { type: 'description', date: 5, actorId: 'teammate' },
            { type: 'made_private', date: 5, actorId: 'teammate' },
        ])
        expect(buildMetadataHistoryEvents({ ...BEFORE, isPrivate: true }, BEFORE, 5)).toEqual([
            { type: 'shared', date: 5, actorId: 'owner' },
        ])
    })

    it('records nothing for a version write, which has its own entry, or for bookkeeping', () => {
        expect(buildMetadataHistoryEvents(BEFORE, { ...BEFORE, title: 'New', currentVersionId: 'v2' })).toEqual([])
        expect(
            buildMetadataHistoryEvents(BEFORE, {
                ...BEFORE,
                readerIds: ['owner'],
                commentsData: { amount: 2 },
                serveSecret: 'x',
            })
        ).toEqual([])
        expect(buildMetadataHistoryEvents(null, BEFORE)).toEqual([])
    })

    it('keeps long titles short', () => {
        const [event] = buildMetadataHistoryEvents(BEFORE, { ...BEFORE, title: 'x'.repeat(500) })
        expect(event.to).toHaveLength(MAX_HISTORY_TEXT_CHARS)
    })

    it('writes one entry per change under the trigger event, so a redelivery does not duplicate it', async () => {
        const db = new KnowledgeFirestoreDouble()
        const write = () =>
            recordMetadataHistory({
                db,
                projectId: 'p',
                artifactId: 'a',
                before: BEFORE,
                after: { ...BEFORE, title: 'Renamed' },
                eventId: 'event-1',
                now: 9,
            })
        await expect(write()).resolves.toBe(1)
        await expect(write()).resolves.toBe(1)
        const entries = [...db.documents.keys()].filter(path => path.startsWith('artifactItems/p/artifacts/a/history/'))
        expect(entries).toEqual(['artifactItems/p/artifacts/a/history/event-1-renamed'])
        await expect(
            recordMetadataHistory({ db, projectId: 'p', artifactId: 'a', before: BEFORE, after: BEFORE, eventId: 'e2' })
        ).resolves.toBe(0)
    })

    it('maps a stored entry with defaults', () => {
        expect(mapArtifactHistoryEvent('h1', { type: 'version', date: 3, versionNumber: 2 })).toEqual({
            id: 'h1',
            type: 'version',
            date: 3,
            actorId: '',
            assistantId: null,
            versionId: null,
            versionNumber: 2,
            source: '',
            changeSummary: '',
            from: '',
            to: '',
        })
    })
})
