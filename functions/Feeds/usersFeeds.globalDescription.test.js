'use strict'

// MCP feed parity: contacts and moves. The entry update_user_description writes for the global
// description: the REAL helper, so the text a member reads is pinned, not a mock's arguments.

jest.mock('firebase-admin', () => {
    const firestore = () => ({
        doc: docPath => ({
            path: docPath.replace(/^\//, ''),
            get: async () => ({ exists: false, data: () => undefined }),
        }),
    })
    firestore.FieldValue = { delete: () => 'delete' }
    return { firestore }
})
jest.mock('../GAnalytics/GAnalytics', () => ({ logEvent: jest.fn() }))
jest.mock('../Firestore/generalFirestoreCloud', () => ({ getId: () => 'feed-1' }))

const { createUserDescriptionChangedFeed, createUserGlobalDescriptionChangedFeed } = require('./usersFeeds')

function innerFeed(batch) {
    return batch.set.mock.calls.find(
        ([ref]) => ref.path === 'projectsInnerFeeds/project-home/users/user-1/feeds/feed-1'
    )[1]
}

test('says it is the global description, with the actor marker', async () => {
    const batch = { set: jest.fn(), followersIds: { 'user-1': ['user-1'] } }
    await createUserGlobalDescriptionChangedFeed(
        'project-home',
        'user-1',
        'Head of sales',
        '',
        batch,
        { uid: 'user-1', via: 'mcp', viaClient: 'Claude' },
        false
    )

    expect(innerFeed(batch)).toMatchObject({
        type: 561,
        objectId: 'user-1',
        entryText: 'changed global description • From Unknown to Head of sales',
        via: 'mcp',
        viaClient: 'Claude',
    })
})

test('the project description keeps its own text', async () => {
    const batch = { set: jest.fn(), followersIds: { 'user-1': ['user-1'] } }
    await createUserDescriptionChangedFeed('project-home', 'user-1', 'New', 'Old', batch, { uid: 'user-1' }, false)

    expect(innerFeed(batch).entryText).toBe('changed description • From Old to New')
})
