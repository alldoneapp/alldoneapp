'use strict'

// How a change to the project wiki appears in the Updates feed. Every new page revision becomes one
// feed entry, written by the revision trigger (knowledgeWikiFeed.js) and rendered by the web client
// (components/Feeds/FeedsObjects/WikiObject.js), which imports this module — so it stays free of
// dependencies.
//
// The whole wiki is ONE feed object per project and day, and each revision is one line in it: an
// ingest run that touches fifteen pages is one card with fifteen lines, not fifteen cards.
//
// A feed entry carries the page's slug and the revision number and NOTHING of the page itself — no
// title, no summary, no reason. When a cited object turns private or is deleted, the wiki removes
// what it contributed from the page and from every revision that repeated it
// (knowledgeSourceInvalidation.js). Text copied into a feed entry would survive that in five places
// (feedsStore, the followed stores, feedsCount, projectsFeeds and the activity summary), so the
// client reads title, author note and diff from the revision itself, where a redaction lands.

// The feed object's `type`, the objects-type key of the unread counters and the object id. The id
// must not be the project id: projectsFeeds/{projectId}/{day}/{objectId} is keyed by id alone, and
// the project's own feed object already lives at its project id.
const WIKI_FEED_OBJECT_TYPE = 'wiki'
const WIKI_FEED_OBJECTS_TYPE = 'wiki'
const WIKI_FEED_OBJECT_ID = 'wiki'

const FEED_WIKI_PAGE_CHANGED = 'FEED_WIKI_PAGE_CHANGED'
const FEED_WIKI_TYPES = [FEED_WIKI_PAGE_CHANGED]

// The author of a change nobody in the project made (an ingest run or a rebuild). Not a user id, so
// it can never match a member and suppress that member's unread counter as "their own" change.
const WIKI_FEED_AUTHOR_ID = 'wiki'

const WIKI_CHANGE_CREATED = 'created'
const WIKI_CHANGE_UPDATED = 'updated'
const WIKI_CHANGE_REBUILT = 'rebuilt'
const WIKI_CHANGE_ARCHIVED = 'archived'
const WIKI_CHANGE_CORRECTED = 'corrected'
const WIKI_CHANGE_RESTORED = 'restored'

const WIKI_CHANGE_KINDS = [
    WIKI_CHANGE_CREATED,
    WIKI_CHANGE_UPDATED,
    WIKI_CHANGE_REBUILT,
    WIKI_CHANGE_ARCHIVED,
    WIKI_CHANGE_CORRECTED,
    WIKI_CHANGE_RESTORED,
]

// English, like every other stored entryText: it is what the text-only consumers of a feed entry
// show. The Updates list renders its own translated line from `wikiChange`.
const WIKI_CHANGE_ENTRY_TEXTS = {
    [WIKI_CHANGE_CREATED]: 'created a wiki page',
    [WIKI_CHANGE_UPDATED]: 'updated a wiki page',
    [WIKI_CHANGE_REBUILT]: 'rebuilt a wiki page',
    [WIKI_CHANGE_ARCHIVED]: 'archived a wiki page',
    [WIKI_CHANGE_CORRECTED]: 'corrected a wiki page',
    [WIKI_CHANGE_RESTORED]: 'undid a wiki correction',
}

const WIKI_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function getWikiRevisionDocId(revision) {
    return String(revision).padStart(6, '0')
}

// One entry per revision, under an id derived from it: a redelivered trigger rewrites the same
// documents instead of adding a second line. Slugs never contain an underscore, so the id is
// unambiguous.
function buildWikiFeedId(slug, revision) {
    return `wiki_${slug}_${getWikiRevisionDocId(revision)}`
}

function getWikiChangeKind(revision = {}) {
    if (revision.archived === true) return WIKI_CHANGE_ARCHIVED
    if (revision.mode === 'correction') return WIKI_CHANGE_CORRECTED
    if (revision.mode === 'undo') return WIKI_CHANGE_RESTORED
    // Revisions written before `created` was recorded: the first one is the only creation we can tell.
    if (revision.created === true || (revision.created === undefined && Number(revision.revision) === 1)) {
        return WIKI_CHANGE_CREATED
    }
    if (revision.mode === 'rebuild') return WIKI_CHANGE_REBUILT
    return WIKI_CHANGE_UPDATED
}

// A member who made the change themselves: a correction or its undo.
function getWikiChangeAuthorId(revision = {}) {
    const author = revision.author || {}
    return author.type === 'user' && typeof author.userId === 'string' && author.userId ? author.userId : null
}

function isWikiFeed(feed) {
    return !!feed && FEED_WIKI_TYPES.includes(feed.type)
}

// What a wiki feed entry points at, validated, because it ends up in a URL.
function getWikiFeedTarget(feed) {
    if (!isWikiFeed(feed)) return null
    const slug = typeof feed.wikiSlug === 'string' ? feed.wikiSlug : ''
    const revision = Number(feed.wikiRevision)
    if (!WIKI_SLUG_PATTERN.test(slug) || !Number.isInteger(revision) || revision < 1) return null
    return {
        slug,
        revision,
        change: WIKI_CHANGE_KINDS.includes(feed.wikiChange) ? feed.wikiChange : WIKI_CHANGE_UPDATED,
    }
}

function generateWikiFeedObjectModel(lastChangeDate) {
    return {
        type: WIKI_FEED_OBJECT_TYPE,
        lastChangeDate,
        name: 'Wiki',
        privacy: 'public',
        // The wiki is compiled only from what the whole project can see, so it has one audience.
        isPublicFor: [0],
        isDeleted: false,
    }
}

module.exports = {
    WIKI_FEED_OBJECT_TYPE,
    WIKI_FEED_OBJECTS_TYPE,
    WIKI_FEED_OBJECT_ID,
    WIKI_FEED_AUTHOR_ID,
    FEED_WIKI_PAGE_CHANGED,
    FEED_WIKI_TYPES,
    WIKI_CHANGE_CREATED,
    WIKI_CHANGE_UPDATED,
    WIKI_CHANGE_REBUILT,
    WIKI_CHANGE_ARCHIVED,
    WIKI_CHANGE_CORRECTED,
    WIKI_CHANGE_RESTORED,
    WIKI_CHANGE_KINDS,
    WIKI_CHANGE_ENTRY_TEXTS,
    WIKI_SLUG_PATTERN,
    getWikiRevisionDocId,
    buildWikiFeedId,
    getWikiChangeKind,
    getWikiChangeAuthorId,
    isWikiFeed,
    getWikiFeedTarget,
    generateWikiFeedObjectModel,
}
