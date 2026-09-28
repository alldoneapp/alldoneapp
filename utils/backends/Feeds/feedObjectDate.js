import moment from 'moment'

// A feed object lives at `projectsFeeds/{projectId}/{DDMMYYYY}/{objectId}`, and the DATE in that
// path is whatever calendar day the WRITER was in. Cloud Functions run in UTC and the browser runs in
// the user's zone, so an object written by the server between 00:00 and 02:00 Berlin time is filed
// under the previous day while the client, re-deriving the day from `lastChangeDate`, looks under
// the local one. That read targets a document that does not exist, and the projectsFeeds read rule
// dereferences `resource.data`, so it comes back as `permission-denied` rather than as "missing":
// the Updates list treated it as a pending access projection and retried forever, leaving an
// unread badge whose project showed a header and no rows. Server-written feeds cluster exactly in
// that window (the scheduled calendar sync runs right after the user's midnight).

const DATE_FORMAT = 'DDMMYYYY'
const DATE_PATTERN = /^\d{8}$/

const isStoredDate = value => typeof value === 'string' && DATE_PATTERN.test(value)

// The day to read the object from. The unread counter records the day the writer actually used, so
// that wins; a feed without one (the feedsStore history docs) falls back to the local day.
export function getFeedObjectDate(feed) {
    if (isStoredDate(feed?.dateFormated)) return feed.dateFormated
    return moment(feed?.lastChangeDate).format(DATE_FORMAT)
}

// Every day the object can be filed under: the one the caller resolved, then the UTC day, which is
// what a Cloud Function writes. Deduplicated, so a user in UTC reads once.
export function getFeedObjectDateCandidates(dateFormated, lastChangeDate) {
    const candidates = []
    if (isStoredDate(dateFormated)) candidates.push(dateFormated)
    if (lastChangeDate !== undefined && lastChangeDate !== null) {
        const utcDate = moment.utc(lastChangeDate).format(DATE_FORMAT)
        if (!candidates.includes(utcDate)) candidates.push(utcDate)
    }
    return candidates
}

/**
 * Reads the first candidate day that holds the object.
 *
 * A failed read on one day is not conclusive - a missing document reads as `permission-denied` -
 * so the next day is tried. Only when EVERY read failed is the first error rethrown, which keeps
 * the "object not yet readable, retry after projection" behaviour for a genuinely pending object.
 * When no read found the object and at least one answered cleanly, it is reported missing on the
 * first day.
 */
export async function readFeedObjectFromCandidates(candidates, readAt) {
    let firstError = null
    let answeredMissing = false
    for (const date of candidates) {
        try {
            const object = await readAt(date)
            if (object) return { object, date }
            answeredMissing = true
        } catch (error) {
            if (!firstError) firstError = error
        }
    }
    if (firstError && !answeredMissing) throw firstError
    return { object: null, date: candidates[0] }
}
