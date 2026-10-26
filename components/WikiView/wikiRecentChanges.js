import { WIKI_CHANGE_CREATED } from '../../functions/KnowledgeBase/knowledgeWikiFeedModel'
import { EMPTY_WIKI_TEXT, getWikiRevisionText, isUsableWikiDiffBase } from './wikiDiff'

// "What changed on this page lately" (AT-2878): ONE diff from an earlier revision of a page to its
// newest one, over a range the reader picks. Pure functions; the view only renders what they decide.
//
// A range is named by its BASE: the revision whose text the comparison starts from. "Since revision
// 4" compares revision 4 with the newest revision, so it covers every change after 4. Base 0 is the
// page before it existed (everything reads as added). Only stored revisions are ever compared: a base
// whose text the wiki removed (a source turned private or was deleted) is reported as unavailable and
// never reconstructed from the revisions around it.

export const WIKI_RANGE_LAST_CHANGE = 'lastChange'
export const WIKI_RANGE_LAST_3_CHANGES = 'last3Changes'
export const WIKI_RANGE_LAST_7_DAYS = 'last7Days'
export const WIKI_RANGE_LAST_30_DAYS = 'last30Days'
export const WIKI_RANGE_KIND = 'range'

const DAY_MS = 24 * 60 * 60 * 1000

export const WIKI_RANGE_PRESETS = [
    { id: WIKI_RANGE_LAST_CHANGE, changes: 1 },
    { id: WIKI_RANGE_LAST_3_CHANGES, changes: 3 },
    { id: WIKI_RANGE_LAST_7_DAYS, days: 7 },
    { id: WIKI_RANGE_LAST_30_DAYS, days: 30 },
]

const MAX_REVISION = 9999999

// A base read from a URL or a press: a whole number from 0 up, or null.
export function normalizeWikiRangeBase(value) {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    return Number.isInteger(number) && number >= 0 && number <= MAX_REVISION ? number : null
}

// What the button on a page opens: the page's last change.
export function getDefaultWikiRangeBase(currentRevision) {
    const current = Number(currentRevision)
    return Number.isInteger(current) && current > 0 ? current - 1 : 0
}

const revisionNumber = revision => Number(revision?.revision)
const createdAtOf = revision => Number(revision?.createdAt) || 0

// Newest first, whatever order they were read in.
const sortNewestFirst = revisions =>
    (Array.isArray(revisions) ? revisions : [])
        .filter(revision => Number.isInteger(revisionNumber(revision)) && revisionNumber(revision) > 0)
        .sort((a, b) => revisionNumber(b) - revisionNumber(a))

/**
 * The base a preset stands for, from the newest revisions of the page (the history loads the last 20).
 *   { base }               the range is known
 *   { lookupBefore: ms }   the period reaches past the loaded revisions; the newest revision older
 *                          than that time has to be read to know where it starts
 *   null                   the preset shows nothing (no change in that period) or nothing new
 */
export function resolveWikiRangePreset(preset, { currentRevision, revisions, now = Date.now() } = {}) {
    const current = Number(currentRevision)
    if (!preset || !Number.isInteger(current) || current < 1) return null

    if (preset.changes) return { base: Math.max(0, current - preset.changes) }

    const cutoff = now - preset.days * DAY_MS
    const sorted = sortNewestFirst(revisions)
    if (!sorted.length) return null
    // Revision numbers grow with time, so the first one found older than the cutoff is the newest.
    const before = sorted.find(revision => createdAtOf(revision) < cutoff)
    if (before) {
        const base = revisionNumber(before)
        return base < current ? { base } : null
    }
    // Every loaded revision lies inside the period. If the oldest of them is the page's first, the
    // period covers the whole page; otherwise older revisions may lie inside it too.
    const oldest = sorted[sorted.length - 1]
    if (revisionNumber(oldest) === 1) return { base: 0 }
    return { lookupBefore: cutoff }
}

// The range buttons above the diff, without two buttons that would show the same thing.
export function buildWikiRangeOptions(context) {
    const options = []
    const seenBases = new Set()
    WIKI_RANGE_PRESETS.forEach(preset => {
        const resolved = resolveWikiRangePreset(preset, context)
        if (!resolved) return
        if (resolved.base !== undefined) {
            if (seenBases.has(resolved.base)) return
            seenBases.add(resolved.base)
        }
        options.push({ id: preset.id, ...resolved })
    })
    return options
}

/**
 * The comparison from the base revision to the newest one, in the shape `ChangeContent` renders
 * (the same as one revision's change, components/WikiView/wikiDiff.resolveWikiChange).
 *   status 'ok'               before/after are the two texts to compare
 *   status 'empty'            the base is not older than the newest revision: nothing to compare
 *   status 'redacted'         the newest revision's own text was removed
 *   status 'baseUnavailable'  the base's text was removed, so only the newest text can be shown
 *   status 'missing'          the newest revision cannot be read (or the page is archived)
 */
export function resolveWikiRangeChange(baseNumber, baseRevision, latestRevision) {
    if (!latestRevision || latestRevision.archived === true) return { status: 'missing' }
    const latestNumber = revisionNumber(latestRevision)
    if (!Number.isInteger(baseNumber) || baseNumber < 0) return { status: 'missing' }
    if (baseNumber >= latestNumber) return { status: 'empty', kind: WIKI_RANGE_KIND }
    if (latestRevision.redacted === true) return { status: 'redacted', kind: WIKI_RANGE_KIND }

    const after = getWikiRevisionText(latestRevision)
    // Before the page existed, or before it was brought back after being archived: all of it is new.
    if (baseNumber === 0 || baseRevision?.archived === true) {
        return { status: 'ok', kind: WIKI_CHANGE_CREATED, before: EMPTY_WIKI_TEXT, after }
    }
    return isUsableWikiDiffBase(baseRevision)
        ? { status: 'ok', kind: WIKI_RANGE_KIND, before: getWikiRevisionText(baseRevision), after }
        : { status: 'baseUnavailable', kind: WIKI_RANGE_KIND, before: null, after }
}

/**
 * The single changes a range is made of, newest first, as far as they are loaded, and how many of
 * them are not (a range can reach further back than the revisions read for it).
 */
export function getWikiRangeRevisions(revisions, baseNumber, latestNumber) {
    const listed = sortNewestFirst(revisions).filter(revision => {
        const number = revisionNumber(revision)
        return number > baseNumber && number <= latestNumber
    })
    const total = Math.max(0, latestNumber - baseNumber)
    return { listed, total, notListed: Math.max(0, total - listed.length) }
}
