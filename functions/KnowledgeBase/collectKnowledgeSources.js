'use strict'

// Collects what changed in a project since the wiki last looked, as compact text "source cards"
// for an ingest run.
//
// THE PRIVACY FILTER HERE IS THE ONLY ONE. Ingest runs read through the Admin SDK, which bypasses
// the security rules, and the wiki is readable by every member of the project. So an object is a
// source only when it is visible to the whole project (isPublicFor contains FEED_PUBLIC_FOR_ALL);
// a private task, a private note or a contact only one member can see must never reach a card.
//
// What else is deliberately left out, and why:
//   - email-derived tasks (gmailData): emails are opt-in for the wiki and not part of the MVP;
//   - the generated day-rate time-log task: bookkeeping, not knowledge;
//   - user memory notes (parentObject.type === 'users'): personal facts about one member.
//
// Delta queries use single-field indexes only, so the wiki needs no composite index:
//   - `lastEditionDate` ascending for every type, paged with a cursor;
//   - tasks also by `completed`, because completing a task does not stamp lastEditionDate. That
//     field has only a DESCENDING single-field index (see the field override in
//     firestore.indexes.json), so it is read newest-first in one bounded window and a burst larger
//     than the window is reported as truncated rather than paged.
//
// The cursor is a map of { [cursorKey]: { ms, ids } }: the newest timestamp read so far and the ids
// already read at exactly that timestamp, so documents sharing a millisecond are neither skipped
// nor read twice. A missing entry means "first build" for that key, which looks back a bounded
// window instead of reading the whole project history. A document that never got the ordered
// field (some very old goals and contacts) is not returned by a range query and is not read.

const { cleanTextMetaData } = require('../Utils/parseTextUtils')
const { mapWithConcurrency } = require('../Utils/mapWithConcurrency')
const { buildKnowledgeSourceKey, estimateTextTokens, parseKnowledgeSourceKey } = require('./knowledgeBaseModel')

const FEED_PUBLIC_FOR_ALL = 0
const DAY_MS = 24 * 60 * 60 * 1000

const SOURCE_QUERIES = [
    {
        cursorKey: 'tasks',
        type: 'task',
        collectionPath: projectId => `items/${projectId}/tasks`,
        field: 'lastEditionDate',
        direction: 'asc',
        pageLimit: 200,
        initialLookbackMs: 90 * DAY_MS,
    },
    {
        cursorKey: 'tasksCompleted',
        type: 'task',
        collectionPath: projectId => `items/${projectId}/tasks`,
        field: 'completed',
        direction: 'desc',
        pageLimit: 300,
        initialLookbackMs: 90 * DAY_MS,
    },
    {
        cursorKey: 'goals',
        type: 'goal',
        collectionPath: projectId => `goals/${projectId}/items`,
        field: 'lastEditionDate',
        direction: 'asc',
        pageLimit: 100,
        initialLookbackMs: null,
    },
    {
        cursorKey: 'notes',
        // Every note card costs a Storage download, so notes are read in smaller pages.
        type: 'note',
        collectionPath: projectId => `noteItems/${projectId}/notes`,
        field: 'lastEditionDate',
        direction: 'asc',
        pageLimit: 60,
        initialLookbackMs: 180 * DAY_MS,
    },
    {
        cursorKey: 'contacts',
        type: 'contact',
        collectionPath: projectId => `projectsContacts/${projectId}/contacts`,
        field: 'lastEditionDate',
        direction: 'asc',
        pageLimit: 200,
        initialLookbackMs: null,
    },
]

const TASK_DESCRIPTION_MAX_CHARS = 1500
const GOAL_DESCRIPTION_MAX_CHARS = 1500
const CONTACT_DESCRIPTION_MAX_CHARS = 1500
const NOTE_CONTENT_MAX_CHARS = 6000
const NOTE_READ_CONCURRENCY = 5
// Due dates this far out are the "Someday" backlog, not a date anyone means.
const FAR_FUTURE_MS = Date.UTC(3000, 0, 1)

function toMillis(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (value && typeof value.toMillis === 'function') return value.toMillis()
    return null
}

// Visible to every member of the project. `isPrivate` is checked as well as a second line: the two
// fields are written together, and if they ever disagree the stricter one wins. A goal without
// isPublicFor is public, because that is how mapGoalData renders it to every member; for every
// other type a missing array is treated as private.
function isVisibleToWholeProject(data, type) {
    if (!data || data.isPrivate === true) return false
    if (!Array.isArray(data.isPublicFor)) return type === 'goal'
    return data.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
}

function getExclusionReason(data, type) {
    if (type === 'task') {
        if (data.gmailData) return 'email'
        if (data.genericData?.type === 'dayRateTimeLog') return 'generated'
    }
    if (type === 'note' && data.parentObject?.type === 'users') return 'user_memory'
    return null
}

function cleanText(value, maxChars) {
    const text = cleanTextMetaData(String(value || ''), false)
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    if (text.length <= maxChars) return text
    return `${text.slice(0, maxChars).trimEnd()} […]`
}

function formatDate(ms) {
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null
}

function nameOf(userNames, userId) {
    return (userId && userNames[userId]) || null
}

function buildTaskCard(id, data, userNames) {
    const title = cleanText(data.extendedName || data.name, 300) || '(untitled task)'
    const details = []
    if (data.done) {
        const completedOn = formatDate(toMillis(data.completed))
        details.push(completedOn ? `done ${completedOn}` : 'done')
    } else {
        details.push('open')
        const due = toMillis(data.dueDate)
        if (Number.isFinite(due) && due < FAR_FUTURE_MS) details.push(`due ${formatDate(due)}`)
    }
    const assignee = nameOf(userNames, data.userId)
    if (assignee) details.push(`assigned to ${assignee}`)
    const goalKey = buildKnowledgeSourceKey('goal', data.parentGoalId)
    if (goalKey) details.push(`goal [[${goalKey}]]`)
    const parentKey = buildKnowledgeSourceKey('task', data.parentId)
    if (parentKey) details.push(`subtask of [[${parentKey}]]`)

    const lines = [`[[task:${id}]] "${title}" (${details.join(', ')})`]
    const description = cleanText(data.description, TASK_DESCRIPTION_MAX_CHARS)
    if (description) lines.push(`Description: ${description}`)
    return { title, text: lines.join('\n') }
}

function buildGoalCard(id, data, userNames) {
    const title = cleanText(data.extendedName || data.name, 300) || '(untitled goal)'
    const details = []
    const progress = Number(data.progress)
    if (Number.isFinite(progress)) details.push(`progress ${Math.round(progress)}%`)
    const completion = toMillis(data.completionMilestoneDate)
    if (Number.isFinite(completion) && completion < FAR_FUTURE_MS) details.push(`target ${formatDate(completion)}`)
    const assignees = (Array.isArray(data.assigneesIds) ? data.assigneesIds : [])
        .map(userId => nameOf(userNames, userId))
        .filter(Boolean)
    if (assignees.length) details.push(`assigned to ${assignees.join(', ')}`)

    const lines = [`[[goal:${id}]] "${title}"${details.length ? ` (${details.join(', ')})` : ''}`]
    const description = cleanText(data.description, GOAL_DESCRIPTION_MAX_CHARS)
    if (description) lines.push(`Description: ${description}`)
    return { title, text: lines.join('\n') }
}

function buildNoteCard(id, data, content) {
    const title = cleanText(data.extendedTitle || data.title, 300) || '(untitled note)'
    const edited = formatDate(toMillis(data.lastEditionDate))
    const lines = [`[[note:${id}]] "${title}"${edited ? ` (last edited ${edited})` : ''}`]
    const body = cleanText(content || data.preview, NOTE_CONTENT_MAX_CHARS)
    if (body) lines.push(`Content:\n${body}`)
    return { title, text: lines.join('\n') }
}

// Name, role, company and description only. Phone numbers and email addresses describe how to
// reach a person, not what the project knows about them, and a compiled page keeps no copy of them.
function buildContactCard(id, data) {
    const title = cleanText(data.displayName, 200) || '(unnamed contact)'
    const role = cleanText(data.role, 200)
    const company = cleanText(data.company, 200)
    const position = [role, company && `at ${company}`].filter(Boolean).join(' ')
    const lines = [`[[contact:${id}]] "${title}"${position ? ` (${position})` : ''}`]
    const description = cleanText(data.extendedDescription || data.description, CONTACT_DESCRIPTION_MAX_CHARS)
    if (description) lines.push(`Description: ${description}`)
    return { title, text: lines.join('\n') }
}

function readQueryCursor(cursor, cursorKey) {
    const entry = cursor && cursor[cursorKey]
    if (!entry || !Number.isFinite(entry.ms)) return null
    return { ms: entry.ms, ids: Array.isArray(entry.ids) ? entry.ids.filter(id => typeof id === 'string') : [] }
}

function moveCursor(entry, ms, id) {
    if (!entry || ms > entry.ms) return { ms, ids: [id] }
    if (ms === entry.ms && !entry.ids.includes(id)) return { ms, ids: [...entry.ids, id] }
    return entry
}

async function runSourceQuery({ db, projectId, spec, cursor, now }) {
    const start = readQueryCursor(cursor, spec.cursorKey)
    const fromMs = start ? start.ms : spec.initialLookbackMs === null ? 0 : now - spec.initialLookbackMs
    const alreadyRead = start ? start.ids : []
    const fetchLimit = spec.pageLimit + alreadyRead.length

    const snapshot = await db
        .collection(spec.collectionPath(projectId))
        .where(spec.field, '>=', fromMs)
        .orderBy(spec.field, spec.direction)
        .limit(fetchLimit)
        .get()

    const docs = snapshot.docs
        .map(doc => ({ id: doc.id, data: doc.data() || {}, ms: toMillis((doc.data() || {})[spec.field]) }))
        .filter(doc => Number.isFinite(doc.ms))
        .filter(doc => !(start && doc.ms === start.ms && alreadyRead.includes(doc.id)))
        .sort((left, right) => left.ms - right.ms || (left.id < right.id ? -1 : 1))

    const full = snapshot.docs.length >= fetchLimit
    return {
        // A descending window is read whole: cutting it would drop its NEWEST documents.
        docs: spec.direction === 'desc' ? docs : docs.slice(0, spec.pageLimit),
        // An ascending page that came back full has more behind it; a descending window cannot be
        // paged, so a full one means older documents in it were not read at all.
        exhausted: spec.direction === 'desc' || !full,
        truncated: spec.direction === 'desc' && full,
        start,
    }
}

async function resolveUserNamesFromFirestore(db, userIds) {
    const ids = [...new Set(userIds.filter(id => typeof id === 'string' && id))]
    const names = {}
    for (let index = 0; index < ids.length; index += 100) {
        const refs = ids.slice(index, index + 100).map(id => db.doc(`users/${id}`))
        const snapshots = await db.getAll(...refs)
        snapshots.forEach(snapshot => {
            if (!snapshot.exists) return
            const user = snapshot.data() || {}
            const name = user.displayName || user.name
            if (name) names[snapshot.id] = String(name)
        })
    }
    return names
}

let defaultNoteServicePromise = null

function createDefaultNoteContentReader() {
    return async (projectId, noteId) => {
        if (!defaultNoteServicePromise) {
            defaultNoteServicePromise = (async () => {
                const admin = require('firebase-admin')
                const moment = require('moment')
                const { NoteService } = require('../shared/NoteService')
                const db = admin.firestore()
                const service = new NoteService({
                    database: db,
                    moment,
                    idGenerator: () => db.collection('_').doc().id,
                    enableFeeds: false,
                    enableValidation: false,
                    isCloudFunction: true,
                })
                await service.initialize()
                return service
            })()
        }
        const service = await defaultNoteServicePromise
        return service.getStorageContent(projectId, noteId)
    }
}

/**
 * Reads the project's changes since `cursor` and turns the ones the whole project may see into
 * source cards.
 *
 * @returns {Promise<{sources: Array, nextCursor: object, exhausted: boolean, stats: object}>}
 *   `sources` sorted oldest first; `nextCursor` covers everything READ, including skipped
 *   documents, so a page full of private tasks cannot stall the wiki; `exhausted` is false while
 *   any query has another page waiting.
 */
async function collectKnowledgeSources({
    db,
    projectId,
    cursor = {},
    now = Date.now(),
    readNoteContent = createDefaultNoteContentReader(),
    resolveUserNames = userIds => resolveUserNamesFromFirestore(db, userIds),
}) {
    if (!db) throw new Error('db is required')
    if (!projectId) throw new Error('projectId is required')

    const results = await Promise.all(
        SOURCE_QUERIES.map(async spec => ({ spec, ...(await runSourceQuery({ db, projectId, spec, cursor, now })) }))
    )

    const stats = { scanned: 0, included: 0, skipped: {}, truncated: [] }
    const nextCursor = { ...(cursor || {}) }
    const candidates = new Map()

    for (const result of results) {
        const { spec } = result
        if (result.truncated) stats.truncated.push(spec.cursorKey)
        let position = result.start
        for (const doc of result.docs) {
            stats.scanned += 1
            position = moveCursor(position, doc.ms, doc.id)

            const reason = !isVisibleToWholeProject(doc.data, spec.type)
                ? 'private'
                : getExclusionReason(doc.data, spec.type)
            if (reason) {
                stats.skipped[reason] = (stats.skipped[reason] || 0) + 1
                continue
            }

            const key = buildKnowledgeSourceKey(spec.type, doc.id)
            if (!key) continue
            const existing = candidates.get(key)
            if (existing) {
                existing.updatedAt = Math.max(existing.updatedAt, doc.ms)
                existing.positions.push({ cursorKey: spec.cursorKey, ms: doc.ms })
            } else {
                candidates.set(key, {
                    key,
                    type: spec.type,
                    id: doc.id,
                    data: doc.data,
                    updatedAt: doc.ms,
                    positions: [{ cursorKey: spec.cursorKey, ms: doc.ms }],
                })
            }
        }
        if (position) nextCursor[spec.cursorKey] = position
    }

    const sources = (
        await buildSourceCards({ projectId, entries: [...candidates.values()], readNoteContent, resolveUserNames })
    ).sort((left, right) => left.updatedAt - right.updatedAt || (left.key < right.key ? -1 : 1))

    stats.included = sources.length
    return { sources, nextCursor, exhausted: results.every(result => result.exhausted), stats }
}

// Turns visible, non-excluded documents into cards: resolves the user names the cards mention and
// downloads note bodies, a few at a time.
async function buildSourceCards({ projectId, entries, readNoteContent, resolveUserNames }) {
    const userIds = []
    entries.forEach(entry => {
        if (entry.type === 'task') userIds.push(entry.data.userId)
        if (entry.type === 'goal' && Array.isArray(entry.data.assigneesIds)) userIds.push(...entry.data.assigneesIds)
    })
    const userNames = userIds.length ? await resolveUserNames(userIds) : {}

    const noteContents = new Map()
    const notes = entries.filter(entry => entry.type === 'note')
    await mapWithConcurrency(notes, NOTE_READ_CONCURRENCY, async entry => {
        try {
            noteContents.set(entry.id, await readNoteContent(projectId, entry.id))
        } catch (error) {
            // A note whose body cannot be read still contributes its title and preview.
            console.warn('[knowledge base] Could not read note content', {
                projectId,
                noteId: entry.id,
                error: error.message,
            })
        }
    })

    return entries.map(entry => {
        const card =
            entry.type === 'task'
                ? buildTaskCard(entry.id, entry.data, userNames)
                : entry.type === 'goal'
                  ? buildGoalCard(entry.id, entry.data, userNames)
                  : entry.type === 'note'
                    ? buildNoteCard(entry.id, entry.data, noteContents.get(entry.id))
                    : entry.type === 'correction'
                      ? buildCorrectionCard(entry.id, entry.data)
                      : buildContactCard(entry.id, entry.data)
        return {
            key: entry.key,
            type: entry.type,
            id: entry.id,
            title: card.title,
            text: card.text,
            tokens: estimateTextTokens(card.text),
            updatedAt: entry.updatedAt,
            positions: entry.positions || [],
        }
    })
}

// A correction a project member made through an assistant. It is a source of its own so that the
// next ingest cannot bring back what it corrected from the older objects it contradicts.
function buildCorrectionCard(id, data) {
    const author = cleanText(data.authorName, 200) || 'a project member'
    const createdOn = formatDate(toMillis(data.createdAt))
    const page = data.pageSlug ? ` on page [[${data.pageSlug}]]` : ''
    const title = `Correction by ${author}`
    const text = `[[correction:${id}]] ${title}${createdOn ? ` (${createdOn})` : ''}${page}: ${cleanText(
        data.text,
        2000
    )}`
    return { title, text }
}

const SOURCE_DOC_PATHS = {
    task: (projectId, id) => `items/${projectId}/tasks/${id}`,
    goal: (projectId, id) => `goals/${projectId}/items/${id}`,
    note: (projectId, id) => `noteItems/${projectId}/notes/${id}`,
    contact: (projectId, id) => `projectsContacts/${projectId}/contacts/${id}`,
    correction: (projectId, id) => `knowledgeBases/${projectId}/corrections/${id}`,
}

/**
 * Cards for a known set of source keys, as a page rebuild needs them. Every object is read again
 * and goes through the same visibility filter as the delta: a key on a page is a hint, never
 * proof that the object is still visible to the whole project. Missing objects are dropped.
 */
async function loadKnowledgeSourcesByKeys({
    db,
    projectId,
    keys,
    readNoteContent = createDefaultNoteContentReader(),
    resolveUserNames = userIds => resolveUserNamesFromFirestore(db, userIds),
}) {
    const parsed = [...new Set(keys || [])].map(parseKnowledgeSourceKey).filter(Boolean)
    if (!parsed.length) return []

    const snapshots = await db.getAll(...parsed.map(({ type, id }) => db.doc(SOURCE_DOC_PATHS[type](projectId, id))))
    const entries = []
    snapshots.forEach((snapshot, index) => {
        const { type, id } = parsed[index]
        if (!snapshot.exists) return
        const data = snapshot.data() || {}
        // Corrections live inside the wiki itself and share its audience by construction.
        if (type !== 'correction' && (!isVisibleToWholeProject(data, type) || getExclusionReason(data, type))) return
        entries.push({
            key: `${type}:${id}`,
            type,
            id,
            data,
            updatedAt: toMillis(data.lastEditionDate) || toMillis(data.createdAt) || 0,
        })
    })
    return buildSourceCards({ projectId, entries, readNoteContent, resolveUserNames })
}

/**
 * The cursor after only `processedSources` were handled, for a run that stops part-way (budget,
 * timeout). Skipped documents read before the last processed one are covered by it; anything later
 * is read again next time.
 */
function advanceKnowledgeCursor(cursor, processedSources) {
    const next = { ...(cursor || {}) }
    for (const source of processedSources || []) {
        for (const position of source.positions || []) {
            next[position.cursorKey] = moveCursor(readQueryCursor(next, position.cursorKey), position.ms, source.id)
        }
    }
    return next
}

/**
 * Groups sources into prompt-sized chunks, oldest first. A single source larger than the budget is
 * cut down to it rather than dropped, so one huge note cannot stall the wiki.
 */
function chunkKnowledgeSources(sources, { maxTokens = 20000 } = {}) {
    const chunks = []
    let current = []
    let currentTokens = 0
    for (const source of sources || []) {
        let item = source
        if (item.tokens > maxTokens) {
            const ratio = maxTokens / item.tokens
            const text = `${item.text.slice(0, Math.floor(item.text.length * ratio * 0.95)).trimEnd()} […]`
            item = { ...item, text, tokens: estimateTextTokens(text) }
        }
        if (current.length && currentTokens + item.tokens > maxTokens) {
            chunks.push(current)
            current = []
            currentTokens = 0
        }
        current.push(item)
        currentTokens += item.tokens
    }
    if (current.length) chunks.push(current)
    return chunks
}

module.exports = {
    SOURCE_QUERIES,
    isVisibleToWholeProject,
    getExclusionReason,
    collectKnowledgeSources,
    loadKnowledgeSourcesByKeys,
    buildCorrectionCard,
    advanceKnowledgeCursor,
    chunkKnowledgeSources,
}
