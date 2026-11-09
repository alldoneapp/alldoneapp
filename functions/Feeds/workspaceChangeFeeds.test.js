jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))

const mockProccessFeed = jest.fn(async () => {})
const mockLoadFeedObject = jest.fn(async () => undefined)
const mockInsertFollowers = jest.fn()
let mockFeedCounter = 0
jest.mock('./globalFeedsHelper', () => {
    const { getActorChannelFields } = jest.requireActual('../shared/mcpActor')
    return {
        generateCurrentDateObject: () => ({ currentDateFormated: '09112026', currentMilliseconds: 1000 }),
        generateFeedModel: ({ feedType, lastChangeDate, entryText, feedUser, objectId, isPublicFor }) => {
            const feed = { type: feedType, lastChangeDate, creatorId: feedUser.uid, objectId, isPublicFor }
            Object.assign(feed, getActorChannelFields(feedUser))
            if (entryText) feed.entryText = entryText
            mockFeedCounter += 1
            return { feed, feedId: `feed${mockFeedCounter}` }
        },
        loadFeedObject: (...args) => mockLoadFeedObject(...args),
        proccessFeed: (...args) => mockProccessFeed(...args),
        insertFollowersUserToFeedChain: (...args) => mockInsertFollowers(...args),
    }
})
const mockLoadState = jest.fn(async () => {})
jest.mock('../shared/contactUpdateHelper', () => ({
    loadFeedsStateForContactWrite: (...args) => mockLoadState(...args),
}))
const mockTryAddFollower = jest.fn(async () => {})
jest.mock('../Followers/followerHelper', () => ({ tryAddFollower: (...args) => mockTryAddFollower(...args) }))
const mockCommit = jest.fn(async () => {})
jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({ commit: mockCommit })),
}))

const {
    describeAssistantChanges,
    describeAssistantTaskChange,
    resolveFeedUser,
    writeAssistantChangeFeeds,
    writeAssistantCreatedFeeds,
    writeAssistantTaskFeed,
    writeContactStatusesAddedFeed,
    writeProjectAssistantChangedFeed,
    writeProjectCreatedFeed,
} = require('./workspaceChangeFeeds')

const USER = 'user-1'
const fakeDb = (docs = {}) => ({
    doc: path => ({
        path,
        get: async () => ({ exists: path in docs, data: () => docs[path] }),
    }),
})
const db = fakeDb({
    [`users/${USER}`]: { displayName: 'Karsten Wysk' },
    'projects/p1': { name: 'Alldone Growth', userIds: [USER] },
    'assistants/p1/items/a1': { displayName: 'Growth Lead', photoURL50: 'lead.png' },
})
const mcp = { mcpClient: 'Claude' }

const writtenEntries = () =>
    mockProccessFeed.mock.calls.map(call => ({
        objectId: call[3],
        objectsType: call[4],
        feedObject: call[5],
        feed: call[7],
        actor: call[8],
    }))

beforeEach(() => {
    jest.clearAllMocks()
    mockLoadFeedObject.mockImplementation(async () => undefined)
})

describe('describeAssistantChanges', () => {
    it('writes one entry per changed field, in the app texts', () => {
        const entries = describeAssistantChanges(
            {
                displayName: 'Growth Lead',
                description: 'Finds customers',
                instructions: 'Old',
                model: 'MODEL_GPT6_SOL',
                temperature: 'TEMPERATURE_NORMAL',
                realtimeVoice: 'marin',
                delegationToolDescriptionManual: '',
                allowedTools: ['web_search', 'get_notes'],
                photoURL50: 'old.png',
            },
            {
                displayName: 'Growth Captain',
                description: 'Finds paying customers',
                instructions: 'New',
                model: 'MODEL_GPT6_LUNA',
                temperature: 'TEMPERATURE_HIGH',
                realtimeVoice: 'cedar',
                delegationToolDescriptionManual: 'Ask me about growth',
                allowedTools: ['web_search', 'artifacts'],
                photoURL50: 'new.png',
                photoURL: 'new.png',
            }
        )
        expect(entries.map(entry => [entry.feedType, entry.entryText])).toEqual([
            ['FEED_ASSISTANT_NAME_CHANGED', 'changed assistant name • From Growth Lead to Growth Captain'],
            [
                'FEED_ASSISTANT_DESCRIPTION_CHANGED',
                'changed assistant description • From Finds customers to Finds paying customers',
            ],
            ['FEED_ASSISTANT_PICTURE_CHANGED', ''],
            ['FEED_ASSISTANT_INSTRUCTIONS_CHANGED', 'changed assistant instructions • From Old to New'],
            ['FEED_ASSISTANT_MODEL_CHANGED', 'changed assistant model • From GPT 6.1 Sol to GPT 6 Luna'],
            ['FEED_ASSISTANT_TEMPERATURE_CHANGED', 'changed assistant temperature • From 0.7 to 1'],
            ['FEED_ASSISTANT_VOICE_CHANGED', 'changed assistant voice • From marin to cedar'],
            [
                'FEED_ASSISTANT_DELEGATION_DESCRIPTION_CHANGED',
                'changed how other assistants see this assistant • From (empty) to Ask me about growth',
            ],
            ['FEED_ASSISTANT_TOOLS_CHANGED', 'changed assistant tools • switched on artifacts; switched off get_notes'],
        ])
        const picture = entries.find(entry => entry.feedType === 'FEED_ASSISTANT_PICTURE_CHANGED')
        expect(picture.feedFields).toEqual({ newPhotoURL: 'new.png', oldPhotoURL: 'old.png' })
        expect(picture.feedObject).toEqual({ photoURL: 'new.png' })
    })

    it('writes nothing when nothing an entry describes changed', () => {
        const assistant = { displayName: 'A', instructions: 'x', lastEditionDate: 1 }
        expect(describeAssistantChanges(assistant, { ...assistant, lastEditionDate: 2, lastEditorId: 'u' })).toEqual([])
    })

    it('names a scheduled task and what changed in it', () => {
        expect(describeAssistantTaskChange({ kind: 'created', taskName: 'Daily discovery' })).toEqual({
            feedType: 'FEED_ASSISTANT_TASK_CREATED',
            entryText: 'created scheduled task • Daily discovery',
        })
        expect(
            describeAssistantTaskChange({ kind: 'changed', taskName: 'Daily discovery', changes: ['prompt', 'paused'] })
        ).toEqual({
            feedType: 'FEED_ASSISTANT_TASK_CHANGED',
            entryText: 'changed scheduled task Daily discovery • prompt, paused',
        })
    })
})

describe('resolveFeedUser', () => {
    it('is the user marked with the MCP client over MCP, and the assistant when an assistant acts', async () => {
        await expect(resolveFeedUser({ db, userId: USER, projectId: 'p1', context: mcp })).resolves.toMatchObject({
            uid: USER,
            via: 'mcp',
            viaClient: 'Claude',
        })
        const assistant = await resolveFeedUser({ db, userId: USER, projectId: 'p1', context: { assistantId: 'a1' } })
        expect(assistant).toMatchObject({ uid: 'a1', displayName: 'Growth Lead', photoURL: 'lead.png' })
        expect(assistant.via).toBeUndefined()
    })
})

describe('writing entries', () => {
    it('writes every assistant change on the assistant, as the MCP user, in one batch', async () => {
        const written = await writeAssistantChangeFeeds({
            db,
            projectId: 'p1',
            assistantId: 'a1',
            before: { displayName: 'Growth Lead', model: 'MODEL_GPT6_SOL' },
            after: { displayName: 'Growth Captain', model: 'MODEL_GPT6_LUNA', photoURL50: '' },
            userId: USER,
            context: mcp,
        })
        expect(written).toBe(true)
        const entries = writtenEntries()
        expect(entries.map(entry => entry.feed.type)).toEqual([
            'FEED_ASSISTANT_NAME_CHANGED',
            'FEED_ASSISTANT_MODEL_CHANGED',
        ])
        entries.forEach(entry => {
            expect(entry).toMatchObject({ objectId: 'a1', objectsType: 'assistants' })
            expect(entry.feed).toMatchObject({ creatorId: USER, via: 'mcp', viaClient: 'Claude', isPublicFor: [0] })
        })
        expect(entries[0].feedObject).toMatchObject({ type: 'assistant', name: 'Growth Captain' })
        expect(mockLoadState).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', userId: USER }))
        expect(mockCommit).toHaveBeenCalledTimes(1)
    })

    it('puts the picture URLs on a picture entry, which the app renders as the two pictures', async () => {
        await writeAssistantChangeFeeds({
            db,
            projectId: 'p1',
            assistantId: 'a1',
            before: { photoURL50: 'old.png' },
            after: { photoURL50: 'new.png' },
            userId: USER,
            context: mcp,
        })
        const [entry] = writtenEntries()
        expect(entry.feed).toMatchObject({
            type: 'FEED_ASSISTANT_PICTURE_CHANGED',
            newPhotoURL: 'new.png',
            oldPhotoURL: 'old.png',
        })
        expect(entry.feed.entryText).toBeUndefined()
        expect(entry.feedObject.photoURL).toBe('new.png')
    })

    it('runs a caller-supplied actor lookup only when there is something to write', async () => {
        const getFeedUser = jest.fn(async () => ({ uid: 'a9', name: 'Anna' }))
        await writeAssistantChangeFeeds({
            db,
            projectId: 'p1',
            assistantId: 'a1',
            before: { displayName: 'A' },
            after: { displayName: 'A' },
            userId: USER,
            getFeedUser,
        })
        expect(getFeedUser).not.toHaveBeenCalled()
        await writeAssistantChangeFeeds({
            db,
            projectId: 'p1',
            assistantId: 'a1',
            before: { displayName: 'A' },
            after: { displayName: 'B' },
            userId: USER,
            getFeedUser,
        })
        expect(getFeedUser).toHaveBeenCalledTimes(1)
        expect(writtenEntries()[0].feed.creatorId).toBe('a9')
    })

    it('writes nothing for a global assistant, as the app does', async () => {
        await writeAssistantChangeFeeds({
            db,
            projectId: 'globalProject',
            assistantId: 'g1',
            before: { displayName: 'A' },
            after: { displayName: 'B' },
            userId: USER,
            context: mcp,
        })
        expect(mockProccessFeed).not.toHaveBeenCalled()
    })

    it('never fails the change: a broken feed write is logged and reported as not written', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        mockProccessFeed.mockRejectedValueOnce(new Error('feeds down'))
        const written = await writeAssistantChangeFeeds({
            db,
            projectId: 'p1',
            assistantId: 'a1',
            before: { displayName: 'A' },
            after: { displayName: 'B' },
            userId: USER,
            context: mcp,
        })
        expect(written).toBe(false)
        expect(warn).toHaveBeenCalledWith(
            '[workspace feeds] assistant change entry was not written',
            expect.objectContaining({ error: 'feeds down' })
        )
        warn.mockRestore()
    })

    it('a new assistant: "created assistant", its description, and the person who asked follows it', async () => {
        await writeAssistantCreatedFeeds({
            db,
            projectId: 'p1',
            assistantId: 'a2',
            assistant: { uid: 'a2', displayName: 'Scout', description: 'Finds leads', photoURL50: '' },
            userId: USER,
            context: { assistantId: 'a1' },
        })
        const entries = writtenEntries()
        expect(entries.map(entry => [entry.feed.type, entry.feed.entryText])).toEqual([
            ['FEED_ASSISTANT_CREATED', 'created assistant'],
            ['FEED_ASSISTANT_DESCRIPTION_CHANGED', 'changed assistant description • From (empty) to Finds leads'],
        ])
        // An assistant created it: the entries are the assistant's, the follow is the user's.
        expect(entries[0].feed.creatorId).toBe('a1')
        expect(mockTryAddFollower).toHaveBeenCalledWith(
            'p1',
            expect.objectContaining({
                followObjectsType: 'assistants',
                followObjectId: 'a2',
                feedUser: expect.objectContaining({ uid: USER }),
            }),
            expect.anything(),
            false
        )
        expect(mockInsertFollowers).toHaveBeenCalledWith(['a1'], 'a2', expect.anything())
    })

    it('scheduled tasks are entries on their assistant', async () => {
        await writeAssistantTaskFeed({
            db,
            projectId: 'p1',
            assistantId: 'a1',
            kind: 'changed',
            taskName: 'Daily discovery',
            changes: ['schedule'],
            userId: USER,
            context: mcp,
        })
        const [entry] = writtenEntries()
        expect(entry).toMatchObject({ objectId: 'a1', objectsType: 'assistants' })
        expect(entry.feed.entryText).toBe('changed scheduled task Daily discovery • schedule')
        expect(entry.feedObject).toMatchObject({ name: 'Growth Lead' })

        mockProccessFeed.mockClear()
        await writeAssistantTaskFeed({ db, projectId: 'p1', assistantId: 'a1', kind: 'changed', changes: [] })
        expect(mockProccessFeed).not.toHaveBeenCalled()
    })

    it('project entries: created, project assistant, contact statuses', async () => {
        await writeProjectCreatedFeed({
            db,
            projectId: 'p1',
            project: { name: 'Alldone Growth', color: '#123456' },
            userId: USER,
            context: mcp,
        })
        await writeProjectAssistantChangedFeed({
            db,
            projectId: 'p1',
            assistantName: 'Growth Lead',
            userId: USER,
            context: mcp,
        })
        await writeProjectAssistantChangedFeed({ db, projectId: 'p1', removed: true, userId: USER, context: mcp })
        await writeContactStatusesAddedFeed({
            db,
            projectId: 'p1',
            statusNames: ['Lead', 'Customer'],
            userId: USER,
            context: mcp,
        })
        await writeContactStatusesAddedFeed({ db, projectId: 'p1', statusNames: [], userId: USER, context: mcp })
        const entries = writtenEntries()
        expect(entries.map(entry => [entry.objectsType, entry.feed.type, entry.feed.entryText])).toEqual([
            ['projects', 29, 'created project'],
            ['projects', 'FEED_PROJECT_ASSISTANT_CHANGED', 'changed project assistant • Growth Lead'],
            ['projects', 'FEED_PROJECT_ASSISTANT_CHANGED', 'changed project assistant • removed the project assistant'],
            ['projects', 'FEED_PROJECT_CONTACT_STATUSES_ADDED', 'added contact statuses • Lead, Customer'],
        ])
        expect(entries[0].feedObject).toMatchObject({ type: 'project', name: 'Alldone Growth', projectId: 'p1' })
        entries.forEach(entry => expect(entry.objectId).toBe('p1'))
    })

    it('uses the stored feed object when the object already has one', async () => {
        mockLoadFeedObject.mockImplementation(async () => ({
            type: 'assistant',
            name: 'Growth Lead',
            isPublicFor: [0],
            photoURL: 'kept.png',
        }))
        await writeAssistantChangeFeeds({
            db,
            projectId: 'p1',
            assistantId: 'a1',
            before: { instructions: 'a' },
            after: { instructions: 'b' },
            userId: USER,
            context: mcp,
        })
        expect(writtenEntries()[0].feedObject).toMatchObject({ photoURL: 'kept.png', lastChangeDate: 1000 })
    })
})
