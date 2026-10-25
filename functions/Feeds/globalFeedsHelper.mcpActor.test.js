jest.mock('firebase-admin', () => {
    const firestore = () => ({ doc: path => ({ path }) })
    firestore.FieldValue = { delete: () => 'delete' }
    return { firestore }
})
jest.mock('../GAnalytics/GAnalytics', () => ({ logEvent: jest.fn() }))
jest.mock('../Firestore/generalFirestoreCloud', () => ({ getId: () => 'feed-1' }))

const { generateFeedModel, proccessFeed } = require('./globalFeedsHelper')

// What a feed an MCP client produced looks like, and who is told about it (shared/mcpActor.js).
describe('feeds written through MCP', () => {
    const runFeed = async (feed, feedCreator) => {
        const batch = { set: jest.fn(), followersIds: { 'task-1': ['user-1'] } }
        await proccessFeed(
            'project-1',
            '25102026',
            [],
            'task-1',
            'tasks',
            { type: 'task' },
            'feed-1',
            feed,
            feedCreator,
            batch,
            true,
            { feedCreator, project: { userIds: ['user-1', 'user-2'] } }
        )
        return batch.set.mock.calls
            .map(([ref]) => ref.path.replace(/^\//, ''))
            .filter(path => path.startsWith('feedsCount/'))
    }

    test('a feed carries the MCP marker of the user who wrote it', () => {
        const { feed } = generateFeedModel({
            feedType: 'FEED_TASK_CREATED',
            lastChangeDate: 1,
            entryText: 'created task',
            feedUser: { uid: 'user-1', via: 'mcp', viaClient: 'Codex' },
            objectId: 'task-1',
        })
        expect(feed).toEqual(expect.objectContaining({ creatorId: 'user-1', via: 'mcp', viaClient: 'Codex' }))

        const { feed: ownFeed } = generateFeedModel({
            feedType: 'FEED_TASK_CREATED',
            lastChangeDate: 1,
            feedUser: { uid: 'user-1' },
            objectId: 'task-1',
        })
        expect(ownFeed).not.toHaveProperty('via')
    })

    test("the user is notified of their MCP client's change as well as the others", async () => {
        const feed = { creatorId: 'user-1', isPublicFor: [0], via: 'mcp', viaClient: 'Codex' }
        expect(await runFeed(feed, { uid: 'user-1', via: 'mcp' })).toEqual([
            'feedsCount/project-1/user-1/followed',
            'feedsCount/project-1/user-2/all',
        ])
    })

    test('the user is not notified of their own change', async () => {
        const feed = { creatorId: 'user-1', isPublicFor: [0] }
        expect(await runFeed(feed, { uid: 'user-1' })).toEqual(['feedsCount/project-1/user-2/all'])
    })
})
