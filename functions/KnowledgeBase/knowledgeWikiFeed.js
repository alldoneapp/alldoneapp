'use strict'

// Puts every new wiki page revision into the project's Updates feed (see knowledgeWikiFeedModel.js
// for what an entry carries and why it carries no page text). Runs from the revision create
// trigger, so every writer — ingest, rebuild, archive, a member's correction and its undo — is
// covered without any of them knowing about feeds, and a page write is never slowed down or failed
// by the fan-out.
//
// What a change does in the feed:
//   - it is listed in the project's "All" tab, and in "Followed" for the wiki's owner (who switched
//     it on and pays for it), for the member who made it and for anyone following the wiki;
//   - only a change a MEMBER made (a correction, an undo) raises the other members' unread badge.
//     Ingest runs and rebuilds rewrite pages every night on their own; badging every member for
//     each of them is the noise that kept the wiki out of the feed in the first place
//     (knowledgeBaseModel.js). They are still listed, so every change stays traceable.
//
// Written with the Admin SDK in one batch. The documents are the same shapes the client and the
// other server feeds write; the access-projection triggers on feedsStore and projectsFeeds add the
// readerIds the Updates queries filter on, exactly as for every other server-written feed.

const moment = require('moment')
const { uniq } = require('lodash')

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { getKnowledgeBasePath } = require('./knowledgeBaseModel')
const {
    FEED_WIKI_PAGE_CHANGED,
    WIKI_CHANGE_ENTRY_TEXTS,
    WIKI_FEED_AUTHOR_ID,
    WIKI_FEED_OBJECT_ID,
    WIKI_FEED_OBJECTS_TYPE,
    WIKI_SLUG_PATTERN,
    buildWikiFeedId,
    generateWikiFeedObjectModel,
    getWikiChangeAuthorId,
    getWikiChangeKind,
} = require('./knowledgeWikiFeedModel')
const { getActorChannelFields, isMcpActor } = require('../shared/mcpActor')

const FEED_PUBLIC_FOR_ALL = 0

// Not accounts: workstreams and the public marker share the user-id slot in project member lists.
const isRealUserId = userId =>
    typeof userId === 'string' && userId.length > 0 && userId !== 'FEED_PUBLIC_FOR_ALL' && !userId.startsWith('ws@')

function buildWikiRevisionFeed({ slug, revision }) {
    const revisionNumber = Number(revision?.revision)
    if (!WIKI_SLUG_PATTERN.test(String(slug || '')) || !Number.isInteger(revisionNumber) || revisionNumber < 1) {
        return null
    }
    const lastChangeDate = Number(revision.createdAt) || Date.now()
    const change = getWikiChangeKind(revision)
    const authorId = getWikiChangeAuthorId(revision)

    return {
        feedId: buildWikiFeedId(slug, revisionNumber),
        authorId,
        feed: {
            type: FEED_WIKI_PAGE_CHANGED,
            lastChangeDate,
            creatorId: authorId || WIKI_FEED_AUTHOR_ID,
            objectId: WIKI_FEED_OBJECT_ID,
            isPublicFor: [FEED_PUBLIC_FOR_ALL],
            entryText: WIKI_CHANGE_ENTRY_TEXTS[change],
            wikiSlug: slug,
            wikiRevision: revisionNumber,
            wikiChange: change,
            ...(authorId ? getActorChannelFields(revision.author) : {}),
        },
    }
}

async function readData(db, path) {
    const snapshot = await db.doc(path).get()
    return snapshot.exists ? snapshot.data() || {} : null
}

async function publishWikiRevisionFeed({ db, projectId, slug, revision }) {
    const built = buildWikiRevisionFeed({ slug, revision })
    if (!projectId || !built) return { published: false, reason: 'invalid' }
    const { feedId, feed, authorId } = built

    const [project, knowledgeBase, followers] = await Promise.all([
        readData(db, `projects/${projectId}`),
        readData(db, getKnowledgeBasePath(projectId)),
        readData(db, `followers/${projectId}/${WIKI_FEED_OBJECTS_TYPE}/${WIKI_FEED_OBJECT_ID}`),
    ])
    if (!project) return { published: false, reason: 'no-project' }

    const memberIds = uniq((Array.isArray(project.userIds) ? project.userIds : []).filter(isRealUserId))
    const isMember = userId => memberIds.includes(userId)
    const followerIds = uniq([
        ...(Array.isArray(followers?.usersFollowing) ? followers.usersFollowing : []),
        knowledgeBase?.ownerUserId,
        authorId,
    ]).filter(isMember)
    // A member's change badges the others; one their MCP client made badges them as well.
    const notifiedIds = authorId ? memberIds.filter(userId => userId !== authorId || isMcpActor(feed)) : []

    // Cloud Functions run in UTC, and that is the day the client falls back to when it looks the
    // object up (utils/backends/Feeds/feedObjectDate.js). The counters record it explicitly.
    const dateFormated = moment.utc(feed.lastChangeDate).format('DDMMYYYY')
    const feedObject = generateWikiFeedObjectModel(feed.lastChangeDate)

    const batch = new BatchWrapper(db)
    batch.set(db.doc(`projectsFeeds/${projectId}/${dateFormated}/${WIKI_FEED_OBJECT_ID}`), feedObject, {
        merge: true,
    })
    batch.set(
        db.doc(`feedsObjectsLastStates/${projectId}/${WIKI_FEED_OBJECTS_TYPE}/${WIKI_FEED_OBJECT_ID}`),
        feedObject,
        { merge: true }
    )
    batch.set(db.doc(`feedsStore/${projectId}/all/${feedId}`), feed, { merge: true })
    followerIds.forEach(userId => {
        batch.set(db.doc(`feedsStore/${projectId}/${userId}/feeds/followed/${feedId}`), feed, { merge: true })
    })
    const counterEntry = {
        [WIKI_FEED_OBJECTS_TYPE]: { [WIKI_FEED_OBJECT_ID]: { [feedId]: { dateFormated, feed } } },
    }
    notifiedIds.forEach(userId => {
        const tab = followerIds.includes(userId) ? 'followed' : 'all'
        batch.set(db.doc(`feedsCount/${projectId}/${userId}/${tab}`), counterEntry, { merge: true })
    })
    await batch.commit()

    return { published: true, feedId, followerIds, notifiedIds }
}

// The trigger body. Never throws: the revision is stored either way, and a missing line in the
// Updates feed is no reason to report the page change as failed. The entry id is derived from the
// revision, so a redelivery rewrites the same documents rather than adding a second line.
async function onKnowledgePageRevisionCreated({ db, projectId, slug, revision }) {
    try {
        return await publishWikiRevisionFeed({ db, projectId, slug, revision })
    } catch (error) {
        console.error('[knowledge base] Could not add a wiki change to the Updates feed', {
            projectId,
            slug,
            revision: revision?.revision,
            error: error.message,
        })
        return { published: false, reason: 'error' }
    }
}

module.exports = {
    buildWikiRevisionFeed,
    publishWikiRevisionFeed,
    onKnowledgePageRevisionCreated,
}
