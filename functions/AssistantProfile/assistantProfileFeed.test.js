const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const { publishAssistantProfileFeed } = require('./assistantProfileFeed')
const { getAssistantProfileFeedRevision } = require('./assistantProfileFeedModel')
const { getAssistantProfileContextLines } = require('./assistantProfileContext')

const USER = 'karsten'
const NOW = Date.UTC(2026, 10, 18, 3, 5)
const DAY_KEY = '18112026'

const OBJECT_ID = `assistantProfile_${USER}`
// The user's own 'users' feed object of the same day (a description or role change) lives at
// projectsFeeds/p1/{day}/{uid}; the profile's object must never land on it.
const USER_FEED_OBJECT = { type: 'users', userId: USER, isPublicFor: [0], lastChangeDate: NOW - 1000 }

function createDb(project = { userIds: [USER, 'colleague'] }) {
    return new KnowledgeFirestoreDouble({
        'projects/p1': project,
        [`projectsFeeds/p1/${DAY_KEY}/${USER}`]: USER_FEED_OBJECT,
    })
}

describe('publishAssistantProfileFeed', () => {
    it('writes a line only its owner can read, with no profile text, into the default project', async () => {
        const db = createDb()

        const result = await publishAssistantProfileFeed({
            db,
            userId: USER,
            userData: { defaultProjectId: 'p1' },
            revision: 4,
            now: NOW,
        })

        expect(result).toMatchObject({ published: true, projectId: 'p1' })
        const feedId = result.feedId
        const entry = db.read(`feedsStore/p1/all/${feedId}`)
        expect(entry).toEqual({
            type: 'FEED_ASSISTANT_PROFILE_UPDATED',
            lastChangeDate: NOW,
            creatorId: 'assistantProfile',
            objectId: OBJECT_ID,
            isPublicFor: [USER],
            entryText: 'updated your assistant profile',
            profileRevision: 4,
        })
        expect(getAssistantProfileFeedRevision(entry)).toBe(4)
        expect(db.read(`feedsStore/p1/${USER}/feeds/followed/${feedId}`)).toEqual(entry)
        expect(db.read(`projectsFeeds/p1/${DAY_KEY}/${OBJECT_ID}`)).toMatchObject({
            type: 'assistantProfiles',
            userId: USER,
            isPublicFor: [USER],
            isPrivate: true,
        })
        expect(db.read(`projectsFeeds/p1/${DAY_KEY}/${USER}`)).toEqual(USER_FEED_OBJECT)
        expect(db.read(`feedsObjectsLastStates/p1/assistantProfiles/${OBJECT_ID}`)).toMatchObject({
            isPublicFor: [USER],
        })
        // One unread slot for the owner, none for anyone else.
        expect(db.read(`feedsCount/p1/${USER}/followed`)).toMatchObject({
            assistantProfiles: { [OBJECT_ID]: { assistant_profile: { dateFormated: DAY_KEY } } },
        })
        expect(db.read('feedsCount/p1/colleague/all')).toBeUndefined()
        expect(db.read('feedsCount/p1/colleague/followed')).toBeUndefined()
    })

    it('writes no line without a default project the user is still a member of', async () => {
        const db = createDb({ userIds: ['colleague'] })
        expect(
            await publishAssistantProfileFeed({
                db,
                userId: USER,
                userData: { defaultProjectId: 'p1' },
                revision: 2,
                now: NOW,
            })
        ).toEqual({ published: false, reason: 'no-default-project' })
        expect(await publishAssistantProfileFeed({ db, userId: USER, userData: {}, revision: 2, now: NOW })).toEqual({
            published: false,
            reason: 'no-default-project',
        })
    })

    it('writes the monthly-cap pause as a line of its own, once per month', async () => {
        const db = createDb()
        const first = await publishAssistantProfileFeed({
            db,
            userId: USER,
            userData: { defaultProjectId: 'p1' },
            pausedMonth: '2026-11',
            now: NOW,
        })
        const second = await publishAssistantProfileFeed({
            db,
            userId: USER,
            userData: { defaultProjectId: 'p1' },
            pausedMonth: '2026-11',
            now: NOW + 1000,
        })
        expect(first.feedId).toBe(second.feedId)
        expect(db.read(`feedsStore/p1/all/${first.feedId}`)).toMatchObject({
            type: 'FEED_ASSISTANT_PROFILE_PAUSED',
            profileMonth: '2026-11',
        })
    })
})

describe('getAssistantProfileContextLines', () => {
    it("gives the user's own runs the profile while it is on", async () => {
        const db = new KnowledgeFirestoreDouble({
            [`assistantProfiles/${USER}`]: { enabled: true, text: 'Top of mind: AT-3072', textUpdatedAt: NOW },
        })
        const lines = await getAssistantProfileContextLines({ db, userId: USER })
        expect(lines[0]).toBe('Private assistant profile of this user:')
        expect(lines).toContain('Top of mind: AT-3072')
        expect(lines).toContain('- Last updated: 2026-11-18')
    })

    it('gives nothing for a profile that is off, empty, missing or unreadable', async () => {
        const off = new KnowledgeFirestoreDouble({ [`assistantProfiles/${USER}`]: { enabled: false, text: 'x' } })
        const empty = new KnowledgeFirestoreDouble({ [`assistantProfiles/${USER}`]: { enabled: true, text: ' ' } })
        const broken = { doc: () => ({ get: async () => Promise.reject(new Error('boom')) }) }
        expect(await getAssistantProfileContextLines({ db: off, userId: USER })).toEqual([])
        expect(await getAssistantProfileContextLines({ db: empty, userId: USER })).toEqual([])
        expect(await getAssistantProfileContextLines({ db: new KnowledgeFirestoreDouble({}), userId: USER })).toEqual(
            []
        )
        expect(await getAssistantProfileContextLines({ db: broken, userId: USER })).toEqual([])
        expect(await getAssistantProfileContextLines({ db: off, userId: null })).toEqual([])
    })
})
