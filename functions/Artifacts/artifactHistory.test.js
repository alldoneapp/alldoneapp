const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const {
    MAX_HISTORY_TEXT_CHARS,
    buildLastEditorAssistant,
    buildMetadataHistoryEvents,
    getLastEditorAssistantId,
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

describe('artifact history of what an MCP client did', () => {
    const MCP_STAMP = { via: 'mcp', viaClient: 'Codex', editionDate: 2000 }

    it('labels a metadata edit stamped with that very edition', () => {
        const events = buildMetadataHistoryEvents(
            BEFORE,
            { ...BEFORE, title: 'Q3 sales', lastEditionDate: 2000, lastEditorVia: MCP_STAMP },
            2000
        )
        expect(events).toEqual([expect.objectContaining({ type: 'renamed', via: 'mcp', viaClient: 'Codex' })])
    })

    it('does not label a later edit the app made without clearing the stamp', () => {
        const events = buildMetadataHistoryEvents(
            { ...BEFORE, lastEditorVia: MCP_STAMP },
            { ...BEFORE, title: 'Q4 sales', lastEditionDate: 3000, lastEditorVia: MCP_STAMP },
            3000
        )
        expect(events).toHaveLength(1)
        expect(events[0]).not.toHaveProperty('via')
    })

    it('keeps the marker when an entry is read back, and only a known client', () => {
        expect(
            mapArtifactHistoryEvent('e1', { type: 'version', actorId: 'owner', via: 'mcp', viaClient: 'Claude' })
        ).toEqual(expect.objectContaining({ via: 'mcp', viaClient: 'Claude' }))
        expect(mapArtifactHistoryEvent('e2', { type: 'version', via: 'mcp', viaClient: '<b>x</b>' })).toEqual(
            expect.objectContaining({ via: 'mcp' })
        )
        expect(
            mapArtifactHistoryEvent('e2', { type: 'version', via: 'mcp', viaClient: '<b>x</b>' })
        ).not.toHaveProperty('viaClient')
        expect(mapArtifactHistoryEvent('e3', { type: 'version', actorId: 'owner' })).not.toHaveProperty('via')
    })
})

describe('artifact history of what an assistant tool did in the user name', () => {
    const ASSISTANT_STAMP = { assistantId: 'anna', editionDate: 4000 }

    it('names the assistant of an edit stamped with that very edition', () => {
        const events = buildMetadataHistoryEvents(
            BEFORE,
            { ...BEFORE, title: 'Q3 sales', lastEditionDate: 4000, lastEditorAssistant: ASSISTANT_STAMP },
            4000
        )
        expect(events).toEqual([
            { type: 'renamed', date: 4000, actorId: 'owner', assistantId: 'anna', from: 'Sales', to: 'Q3 sales' },
        ])
    })

    it('does not name it for a later edit the app made', () => {
        const [event] = buildMetadataHistoryEvents(
            BEFORE,
            { ...BEFORE, title: 'Q4 sales', lastEditionDate: 5000, lastEditorAssistant: ASSISTANT_STAMP },
            5000
        )
        expect(event).not.toHaveProperty('assistantId')
    })

    it('stamps an assistant, never an MCP client', () => {
        expect(buildLastEditorAssistant('anna', null, 7)).toEqual({ assistantId: 'anna', editionDate: 7 })
        expect(buildLastEditorAssistant('anna', { via: 'mcp' }, 7)).toBeNull()
        expect(buildLastEditorAssistant(null, null, 7)).toBeNull()
        expect(
            getLastEditorAssistantId({
                lastEditionDate: 7,
                lastEditorAssistant: { assistantId: 'anna', editionDate: 7 },
            })
        ).toBe('anna')
    })
})
