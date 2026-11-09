'use strict'

// MCP feed parity: contacts and moves. The contact entries update_contact writes for the fields only
// the app could change before: the REAL feed helpers against an in-memory Firestore, so the type,
// the text, the audience and the actor marker are what a member's Updates list actually receives.

const fs = require('fs')
const path = require('path')

const mockDocs = new Map()
jest.mock('firebase-admin', () => {
    const normalize = docPath => docPath.replace(/^\//, '')
    const firestore = () => ({
        doc: docPath => ({
            path: normalize(docPath),
            get: async () => ({
                exists: mockDocs.has(normalize(docPath)),
                data: () => mockDocs.get(normalize(docPath)),
            }),
        }),
    })
    firestore.FieldValue = { delete: () => 'delete', arrayUnion: value => ({ arrayUnion: value }) }
    return { firestore }
})
jest.mock('../GAnalytics/GAnalytics', () => ({ logEvent: jest.fn() }))
let mockFeedCounter = 0
jest.mock('../Firestore/generalFirestoreCloud', () => ({ getId: () => `feed-${++mockFeedCounter}` }))

const {
    createContactNameChangedFeed,
    createContactPictureChangedFeed,
    createContactLinkedInChangedFeed,
    createContactStatusChangedFeed,
} = require('./contactsFeeds')
const serverConstants = require('./FeedsConstants')

const PROJECT_ID = 'project-1'
const CONTACT_ID = 'contact-1'
const MCP_ACTOR = { uid: 'user-1', displayName: 'Karsten', via: 'mcp', viaClient: 'Claude' }

function newBatch() {
    const writes = []
    return {
        writes,
        set: jest.fn((ref, data) => writes.push({ path: ref.path, data })),
        // The contact's own followers, as storeFollowersInBatch would have loaded them.
        followersIds: { [CONTACT_ID]: ['user-1'] },
    }
}

function innerFeeds(batch) {
    return batch.writes
        .filter(write => write.path.startsWith(`projectsInnerFeeds/${PROJECT_ID}/contacts/${CONTACT_ID}/feeds/`))
        .map(write => write.data)
}

function lastFeedObject(batch) {
    const writes = batch.writes.filter(
        write => write.path === `feedsObjectsLastStates/${PROJECT_ID}/contacts/${CONTACT_ID}`
    )
    return writes[writes.length - 1]?.data
}

beforeEach(() => {
    mockDocs.clear()
    mockDocs.set(`feedsObjectsLastStates/${PROJECT_ID}/contacts/${CONTACT_ID}`, {
        type: 'contact',
        name: 'Jane Doe',
        avatarUrl: 'https://old/photo50.png',
        contactId: CONTACT_ID,
        isPublicFor: [0],
    })
})

test('a name change uses the app type and text, and renames the feed object', async () => {
    const batch = newBatch()
    await createContactNameChangedFeed(PROJECT_ID, CONTACT_ID, 'Jane Smith', 'Jane Doe', batch, MCP_ACTOR, true)

    expect(innerFeeds(batch)).toEqual([
        expect.objectContaining({
            type: 47,
            entryText: 'changed name • From Jane Doe',
            creatorId: 'user-1',
            via: 'mcp',
            viaClient: 'Claude',
            isPublicFor: [0],
        }),
    ])
    expect(lastFeedObject(batch).name).toBe('Jane Smith')
})

test('a picture change carries both pictures for ContactPictureChangedFeed', async () => {
    const batch = newBatch()
    await createContactPictureChangedFeed(
        PROJECT_ID,
        CONTACT_ID,
        'https://new/photo.png',
        'https://ignored/photo.png',
        batch,
        MCP_ACTOR,
        true
    )

    const [feed] = innerFeeds(batch)
    expect(feed).toMatchObject({
        type: 42,
        newContactPhotoURL: 'https://new/photo.png',
        oldContactPhotoURL: 'https://old/photo50.png',
    })
    expect(feed).not.toHaveProperty('entryText')
    expect(lastFeedObject(batch).avatarUrl).toBe('https://new/photo.png')
})

test('a LinkedIn change and a status change get entries of their own', async () => {
    const batch = newBatch()
    await createContactLinkedInChangedFeed(
        PROJECT_ID,
        CONTACT_ID,
        'https://www.linkedin.com/in/jane',
        '',
        batch,
        MCP_ACTOR,
        true
    )
    await createContactStatusChangedFeed(PROJECT_ID, CONTACT_ID, 'Customer', '', batch, MCP_ACTOR, true)

    expect(innerFeeds(batch)).toEqual([
        expect.objectContaining({
            type: 'FEED_CONTACT_LINKEDIN_CHANGED',
            entryText: 'changed LinkedIn profile • From Unknown to https://www.linkedin.com/in/jane',
        }),
        expect.objectContaining({
            type: 'FEED_CONTACT_STATUS_CHANGED',
            entryText: 'changed contact status • From None to Customer',
        }),
    ])
})

test("a private contact's entry is as private as the contact", async () => {
    mockDocs.set(`feedsObjectsLastStates/${PROJECT_ID}/contacts/${CONTACT_ID}`, {
        type: 'contact',
        name: 'Jane Doe',
        contactId: CONTACT_ID,
        isPublicFor: ['user-1'],
    })
    const batch = newBatch()
    await createContactStatusChangedFeed(
        PROJECT_ID,
        CONTACT_ID,
        'Lead',
        'Customer',
        batch,
        { uid: 'assistant-1' },
        true
    )

    const [feed] = innerFeeds(batch)
    expect(feed.isPublicFor).toEqual(['user-1'])
    expect(feed).not.toHaveProperty('via')
})

test('the new contact types have the same value on the server and in the app', () => {
    const webConstants = fs.readFileSync(
        path.join(__dirname, '..', '..', 'components', 'Feeds', 'Utils', 'FeedsConstants.js'),
        'utf8'
    )
    const webValue = name => {
        const match = webConstants.match(new RegExp(`export const ${name} = ([^\\n]+)`))
        return match ? eval(match[1]) : undefined
    }
    for (const name of [
        'FEED_CONTACT_PICTURE_CHANGED',
        'FEED_CONTACT_NAME_CHANGED',
        'FEED_CONTACT_LINKEDIN_CHANGED',
        'FEED_CONTACT_STATUS_CHANGED',
    ]) {
        expect(serverConstants[name]).toBeDefined()
        expect(webValue(name)).toEqual(serverConstants[name])
    }
    // The web routes a feed to its object by these lists (components/Feeds/Utils/HelperFunctions.js).
    const contactTypesList = webConstants.slice(webConstants.indexOf('export const FEED_CONTACT_TYPES'))
    const contactTypes = contactTypesList.slice(0, contactTypesList.indexOf(']'))
    expect(contactTypes).toContain('FEED_CONTACT_LINKEDIN_CHANGED')
    expect(contactTypes).toContain('FEED_CONTACT_STATUS_CHANGED')
})
