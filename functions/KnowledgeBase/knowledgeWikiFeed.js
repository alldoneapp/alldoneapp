'use strict'

// Puts every new wiki page revision into the project's Updates feed (see knowledgeWikiFeedModel.js
// for what an entry carries and why it carries no page text). Runs from the revision create
// trigger, so every writer — ingest, rebuild, archive, a member's correction and its undo — is
// covered without any of them knowing about feeds, and a page write is never slowed down or failed
// by the fan-out.
//
// It also writes the line for a source a member hands the wiki or takes back (publishWikiSourceFeed:
// a document added or removed, knowledge saved or removed), at the moment they ask for it; the page
// revisions that follow come from an ingest run and are credited to the wiki.
//
// What a change does in the feed:
//   - it is listed in the project's "All" tab, and in "Followed" for the wiki's owner (who switched
//     it on and pays for it), for the member who made it and for anyone following the wiki;
//   - a change a MEMBER made (a correction, an undo) raises the other members' unread badge with
//     its own line, as any member's change does;
//   - the wiki's own changes (ingest runs, rebuilds, archives, the weekly check) raise every
//     member's badge ONCE per project and day, through one shared counter slot
//     (WIKI_AUTOMATIC_CHANGES_COUNTER_ID). Not badging them at all made them invisible: Updates opens
//     on the unread lines alone whenever anything is unread, and a 03:00 line sits below the whole
//     day once nothing is. One line per revision would be the opposite mistake: a run rewrites
//     dozens of pages, the counters are copied verbatim into each member's single
//     activityUnreadSummary document across all projects, and archived projects (whose counters
//     nobody clears) keep their wiki running — the summary would grow every night without bound.
//     The first change of the day fills the slot; later ones read it and write nothing, so a run
//     costs one counter write per member instead of one per page. Every change is still listed.
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
    FEED_WIKI_SOURCE_CHANGED,
    WIKI_CHANGE_ENTRY_TEXTS,
    WIKI_SOURCE_CHANGE_ENTRY_TEXTS,
    WIKI_AUTOMATIC_CHANGES_COUNTER_ID,
    WIKI_FEED_AUTHOR_ID,
    WIKI_FEED_OBJECT_ID,
    WIKI_FEED_OBJECTS_TYPE,
    WIKI_SLUG_PATTERN,
    buildWikiFeedId,
    buildWikiSourceFeedId,
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

const getCounterPath = (projectId, userId, tab) => `feedsCount/${projectId}/${userId}/${tab}`

// Members whose shared wiki slot already holds a change from this day: writing it again would only
// replace one unread line with another and fire the summary mirror for nothing. A failed read is
// answered with nobody, so the slot is written — it is one fixed key, so that can never pile up.
async function readMembersBadgedOnDay({ db, projectId, userIds, getTab, dateFormated }) {
    if (userIds.length === 0) return new Set()
    try {
        const snapshots = await db.getAll(
            ...userIds.map(userId => db.doc(getCounterPath(projectId, userId, getTab(userId))))
        )
        return new Set(
            snapshots
                .map((snapshot, index) => {
                    const slot = snapshot.exists
                        ? snapshot.data()?.[WIKI_FEED_OBJECTS_TYPE]?.[WIKI_FEED_OBJECT_ID]?.[
                              WIKI_AUTOMATIC_CHANGES_COUNTER_ID
                          ]
                        : null
                    return slot?.dateFormated === dateFormated ? userIds[index] : null
                })
                .filter(Boolean)
        )
    } catch (error) {
        console.warn('[knowledge base] Could not read the wiki unread slots; writing them', {
            projectId,
            error: error.message,
        })
        return new Set()
    }
}

// Who sees a wiki line: the members; in "Followed" the wiki's owner (who switched it on and pays for
// it), the member who made the change and anyone following the wiki.
async function loadWikiFeedAudience(db, projectId, authorId) {
    const [project, knowledgeBase, followers] = await Promise.all([
        readData(db, `projects/${projectId}`),
        readData(db, getKnowledgeBasePath(projectId)),
        readData(db, `followers/${projectId}/${WIKI_FEED_OBJECTS_TYPE}/${WIKI_FEED_OBJECT_ID}`),
    ])
    if (!project) return null

    const memberIds = uniq((Array.isArray(project.userIds) ? project.userIds : []).filter(isRealUserId))
    const isMember = userId => memberIds.includes(userId)
    const followerIds = uniq([
        ...(Array.isArray(followers?.usersFollowing) ? followers.usersFollowing : []),
        knowledgeBase?.ownerUserId,
        authorId,
    ]).filter(isMember)
    const getCounterTab = userId => (followerIds.includes(userId) ? 'followed' : 'all')
    return { memberIds, followerIds, getCounterTab }
}

// Cloud Functions run in UTC, and that is the day the client falls back to when it looks the object
// up (utils/backends/Feeds/feedObjectDate.js). The counters record it explicitly.
const getWikiFeedDay = lastChangeDate => moment.utc(lastChangeDate).format('DDMMYYYY')

async function commitWikiFeed({
    db,
    projectId,
    feedId,
    feed,
    followerIds,
    notifiedIds,
    counterId,
    getCounterTab,
    dateFormated,
}) {
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
        [WIKI_FEED_OBJECTS_TYPE]: { [WIKI_FEED_OBJECT_ID]: { [counterId]: { dateFormated, feed } } },
    }
    notifiedIds.forEach(userId => {
        batch.set(db.doc(getCounterPath(projectId, userId, getCounterTab(userId))), counterEntry, { merge: true })
    })
    await batch.commit()
}

async function publishWikiRevisionFeed({ db, projectId, slug, revision }) {
    const built = buildWikiRevisionFeed({ slug, revision })
    if (!projectId || !built) return { published: false, reason: 'invalid' }
    const { feedId, feed, authorId } = built

    const audience = await loadWikiFeedAudience(db, projectId, authorId)
    if (!audience) return { published: false, reason: 'no-project' }
    const { memberIds, followerIds, getCounterTab } = audience

    const dateFormated = getWikiFeedDay(feed.lastChangeDate)

    // A member's change badges the others with its own line; one their MCP client made badges them
    // as well. The wiki's own changes share one slot per member and day (see the header).
    let notifiedIds
    let counterId
    if (authorId) {
        notifiedIds = memberIds.filter(userId => userId !== authorId || isMcpActor(feed))
        counterId = feedId
    } else {
        const badgedToday = await readMembersBadgedOnDay({
            db,
            projectId,
            userIds: memberIds,
            getTab: getCounterTab,
            dateFormated,
        })
        notifiedIds = memberIds.filter(userId => !badgedToday.has(userId))
        counterId = WIKI_AUTOMATIC_CHANGES_COUNTER_ID
    }

    await commitWikiFeed({
        db,
        projectId,
        feedId,
        feed,
        followerIds,
        notifiedIds,
        counterId,
        getCounterTab,
        dateFormated,
    })

    return { published: true, feedId, followerIds, notifiedIds }
}

function buildWikiSourceFeed({ kind, sourceId, feedUser, now }) {
    const feedId = buildWikiSourceFeedId(kind, sourceId)
    const actorId = typeof feedUser?.uid === 'string' ? feedUser.uid : ''
    if (!feedId || !actorId) return null
    return {
        feedId,
        actorId,
        feed: {
            type: FEED_WIKI_SOURCE_CHANGED,
            lastChangeDate: Number(now) || Date.now(),
            creatorId: actorId,
            objectId: WIKI_FEED_OBJECT_ID,
            isPublicFor: [FEED_PUBLIC_FOR_ALL],
            entryText: WIKI_SOURCE_CHANGE_ENTRY_TEXTS[kind],
            wikiSourceChange: kind,
            ...getActorChannelFields(feedUser),
        },
    }
}

/**
 * A line for a source a member handed the wiki or took back (a document, saved knowledge), written
 * when they asked - the pages it changes follow in an ingest run credited to the wiki. `feedUser` is
 * the actor: the member, with the MCP marker over MCP, or the assistant. Like any member's change it
 * badges every other member, and the member themselves when their MCP client made it; an
 * assistant is not a member, so everybody is badged.
 */
async function publishWikiSourceFeed({ db, projectId, kind, sourceId, feedUser, now = Date.now() }) {
    const built = buildWikiSourceFeed({ kind, sourceId, feedUser, now })
    if (!projectId || !built) return { published: false, reason: 'invalid' }
    const { feedId, feed, actorId } = built

    const audience = await loadWikiFeedAudience(db, projectId, actorId)
    if (!audience) return { published: false, reason: 'no-project' }
    const { memberIds, followerIds, getCounterTab } = audience
    const notifiedIds = memberIds.filter(userId => userId !== actorId || isMcpActor(feed))

    await commitWikiFeed({
        db,
        projectId,
        feedId,
        feed,
        followerIds,
        notifiedIds,
        counterId: feedId,
        getCounterTab,
        dateFormated: getWikiFeedDay(feed.lastChangeDate),
    })
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
    buildWikiSourceFeed,
    publishWikiRevisionFeed,
    publishWikiSourceFeed,
    onKnowledgePageRevisionCreated,
}
