const { isEqual } = require('lodash')

/**
 * Should a note document update reach the search index at all? (AT-2340)
 *
 * `updateRecord` downloads the FULL note body from Firebase Storage for every
 * note update and then upserts the whole search record. Its own change
 * detection cannot prevent that: `objectBefore.content` is mapped from the note
 * DOCUMENT, which has no `content` field (so it is always ''), while
 * `objectAfter.content` is the real downloaded text — making `hasContentChanged`
 * structurally true on every update. So a note doc write that could not have
 * touched the body (backlink recomputation, followers, sticky data) still paid
 * for a download plus a re-index, and every autosave produced TWO such writes.
 *
 * Content is only ever written together with `lastEditionDate` (and the
 * `preview`, which is derived from the content), which is what makes that pair a
 * sound content signal. Anything else that changed an INDEXED field still goes
 * through — including the download, because the record is upserted whole and
 * omitting the body would wipe the indexed text.
 *
 * @param {object} oldItem the note document before the update
 * @param {object} newItem the note document after the update
 * @param {object} mappedBefore the search record mapped from oldItem
 * @param {object} mappedAfter the search record mapped from newItem
 * @returns {boolean} whether the search index needs to be touched
 */
const noteUpdateNeedsIndexing = (oldItem, newItem, mappedBefore, mappedAfter) => {
    const contentMayHaveChanged =
        (oldItem || {}).lastEditionDate !== (newItem || {}).lastEditionDate ||
        (oldItem || {}).preview !== (newItem || {}).preview
    if (contentMayHaveChanged) return true

    return Object.keys(mappedAfter || {}).some(key => !isEqual((mappedBefore || {})[key], mappedAfter[key]))
}

module.exports = { noteUpdateNeedsIndexing }
