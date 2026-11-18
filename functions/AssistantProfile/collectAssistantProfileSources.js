'use strict'

// What one user did since the profile last looked, across the projects they are a member of, as
// plain text for one model call. Nothing here asks a model which tools to call: the old recurring
// task let an assistant research with its tools, and on 2026-11-11 it spent its research budget and
// saved nothing. Here the server reads a fixed set of sources, a bounded amount of each:
//
//   memory    what the user's assistants remembered (assistantMemories/{uid}__{pid}) and changed
//   tasks     tasks the user owns and completed
//   notes     notes the user edited last, with the beginning of their text
//   contacts  contacts the user edited last
//   chats     conversations the user wrote in, with the comments of the window
//   goals     the open goals assigned to the user: context only, never a reason to run
//
// Every object must be readable by the user (isPublicFor names 0 or the user): the profile is the
// user's own, so their private objects count, other members' private objects never do. Membership
// comes from projects/{pid}.userIds through ProjectService. Templates, guides and archived projects
// are left out: what the user does there is not what is on their mind.
//
// All range queries are single-field (lastEditionDate, completed, created) or one equality, which
// Firestore indexes by default; the rest is filtered in memory.

const { canAccessObject, filterMemberProjectIds } = require('../shared/privacyAccess')
const { cleanTextMetaData } = require('../Utils/parseTextUtils')
const { mapWithConcurrency } = require('../Utils/mapWithConcurrency')
const { BACKLOG_DATE_NUMERIC } = require('../Utils/HelperFunctionsCloud')

const DAY_MS = 24 * 60 * 60 * 1000
// A first run, or one after a pause, looks back this far and no further.
const MAX_LOOKBACK_MS = 7 * DAY_MS
const MAX_PROJECTS = 80
const PROJECT_CONCURRENCY = 5
const PER_PROJECT_QUERY_LIMIT = 25
const MAX_TASKS = 60
const MAX_NOTES = 8
const NOTE_TEXT_MAX_CHARS = 1500
const MAX_CONTACTS = 20
const MAX_THREADS = 15
const THREAD_COMMENTS_LIMIT = 12
const COMMENT_MAX_CHARS = 400
const MAX_GOALS = 15
const MEMORY_MAX_CHARS_PER_PROJECT = 1500
// Character budgets per section, about 12,000 tokens in all: the run must stay a cheap nightly call.
const SECTION_BUDGETS = {
    memory: 6000,
    tasks: 6000,
    notes: 10000,
    contacts: 3000,
    chats: 14000,
    goals: 3000,
}

function toMillis(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (value && typeof value.toMillis === 'function') return value.toMillis()
    if (value instanceof Date) return value.getTime()
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

function oneLine(value, maxChars) {
    return cleanText(value, maxChars).replace(/\s*\n\s*/g, ' ')
}

function formatDate(ms) {
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ''
}

// Keeps whole lines until the section's budget is spent, and says how many were left out.
function fitLines(lines, budget) {
    const kept = []
    let used = 0
    for (const line of lines) {
        if (used + line.length + 1 > budget) break
        kept.push(line)
        used += line.length + 1
    }
    const omitted = lines.length - kept.length
    return omitted > 0 ? [...kept, `(${omitted} more not shown)`] : kept
}

function resolveSince({ cursorAt, now }) {
    const floor = now - MAX_LOOKBACK_MS
    return Number.isFinite(cursorAt) && cursorAt > floor ? cursorAt : floor
}

async function defaultListProjects({ db, userId }) {
    const { ProjectService } = require('../shared/ProjectService')
    const service = new ProjectService({ database: db })
    await service.initialize()
    const projects = await service.getUserProjects(userId, { includeArchived: false, includeCommunity: false })
    return projects.filter(project => project && project.id && project.projectType === 'regular')
}

let defaultNoteServicePromise = null

function defaultReadNoteContent(projectId, noteId) {
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
    return defaultNoteServicePromise.then(service => service.getStorageContent(projectId, noteId))
}

async function queryRecent(db, path, field, since, limit = PER_PROJECT_QUERY_LIMIT) {
    const snapshot = await db.collection(path).where(field, '>=', since).orderBy(field, 'desc').limit(limit).get()
    return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() || {} }))
}

// One failing project or source must not cost the user the whole night: it is logged and skipped.
async function safely(label, context, fn, fallback) {
    try {
        return await fn()
    } catch (error) {
        console.warn(`[assistant profile] Could not read ${label}`, { ...context, error: error.message })
        return fallback
    }
}

async function collectMemory({ db, userId, since, includeAll, projectNames }) {
    const snapshot = await db.collection('assistantMemories').where('userId', '==', userId).get()
    const entries = snapshot.docs
        .map(doc => doc.data() || {})
        .filter(data => typeof data.content === 'string' && data.content.trim() && data.projectId)
    const memberIds = new Set(
        await filterMemberProjectIds(
            db,
            userId,
            entries.map(entry => entry.projectId)
        )
    )
    return entries
        .filter(entry => memberIds.has(entry.projectId))
        .map(entry => ({ ...entry, updatedAtMs: toMillis(entry.updatedAt) }))
        .filter(entry => includeAll || (Number.isFinite(entry.updatedAtMs) && entry.updatedAtMs >= since))
        .sort((left, right) => (right.updatedAtMs || 0) - (left.updatedAtMs || 0))
        .map(entry => {
            // Memory lines are appended, so the newest are at the end.
            const content = entry.content.trim()
            const text =
                content.length > MEMORY_MAX_CHARS_PER_PROJECT
                    ? `[…] ${content.slice(content.length - MEMORY_MAX_CHARS_PER_PROJECT).trimStart()}`
                    : content
            const name = projectNames.get(entry.projectId) || 'another project'
            return `### Memory in ${name}\n${text}`
        })
}

async function collectProjectActivity({ db, userId, project, since, sources }) {
    const projectId = project.id
    const context = { userId, projectId }
    const readable = data => canAccessObject(data, userId)
    const [tasks, notes, contacts, chats] = await Promise.all([
        sources.tasks
            ? safely('tasks', context, () => queryRecent(db, `items/${projectId}/tasks`, 'completed', since, 50), [])
            : [],
        sources.notes
            ? safely(
                  'notes',
                  context,
                  () => queryRecent(db, `noteItems/${projectId}/notes`, 'lastEditionDate', since),
                  []
              )
            : [],
        sources.contacts
            ? safely(
                  'contacts',
                  context,
                  () => queryRecent(db, `projectsContacts/${projectId}/contacts`, 'lastEditionDate', since),
                  []
              )
            : [],
        sources.chats
            ? safely(
                  'chats',
                  context,
                  () => queryRecent(db, `chatObjects/${projectId}/chats`, 'lastEditionDate', since),
                  []
              )
            : [],
    ])
    return {
        project,
        tasks: tasks.filter(({ data }) => data.done === true && data.userId === userId && readable(data)),
        notes: notes.filter(({ data }) => data.lastEditorId === userId && readable(data)),
        contacts: contacts.filter(({ data }) => data.lastEditorId === userId && readable(data)),
        chats: chats.filter(({ data }) => readable(data)),
    }
}

function buildTaskLines(activity) {
    return activity
        .flatMap(({ project, tasks }) =>
            tasks.map(({ data }) => ({
                at: toMillis(data.completed) || 0,
                line: `- ${formatDate(toMillis(data.completed))} [${oneLine(project.name, 60)}] ${oneLine(
                    data.extendedName || data.name,
                    200
                )}${data.description ? ` — ${oneLine(data.description, 200)}` : ''}`,
            }))
        )
        .sort((left, right) => left.at - right.at)
        .slice(-MAX_TASKS)
        .map(({ line }) => line)
}

async function buildNoteBlocks(activity, readNoteContent, userId) {
    const notes = activity
        .flatMap(({ project, notes }) => notes.map(note => ({ project, ...note })))
        .sort((left, right) => (toMillis(right.data.lastEditionDate) || 0) - (toMillis(left.data.lastEditionDate) || 0))
        .slice(0, MAX_NOTES)
    return Promise.all(
        notes.map(async ({ project, id, data }) => {
            const text = await safely(
                'a note',
                { userId, projectId: project.id, noteId: id },
                () => readNoteContent(project.id, id),
                ''
            )
            const title = oneLine(data.extendedTitle || data.title, 200) || '(untitled note)'
            const body = cleanText(text, NOTE_TEXT_MAX_CHARS)
            return `### ${title} [${oneLine(project.name, 60)}, edited ${formatDate(
                toMillis(data.lastEditionDate)
            )}]\n${body || '(no text)'}`
        })
    )
}

function buildContactLines(activity) {
    return activity
        .flatMap(({ project, contacts }) =>
            contacts.map(({ data }) => {
                const details = [data.role, data.company].map(value => oneLine(value, 80)).filter(Boolean)
                const description = data.extendedDescription || data.description
                return `- ${oneLine(data.displayName, 100) || '(unnamed contact)'}${
                    details.length ? ` (${details.join(', ')})` : ''
                } [${oneLine(project.name, 60)}]${description ? ` — ${oneLine(description, 200)}` : ''}`
            })
        )
        .slice(0, MAX_CONTACTS)
}

// A conversation counts only when the user wrote in it during the window: a thread an assistant or
// a colleague kept busy says nothing about the user. The assistant's replies stay in, because they
// show what the user's question was about.
async function buildThreadBlocks({ db, activity, userId, since }) {
    const threads = activity
        .flatMap(({ project, chats }) => chats.map(chat => ({ project, ...chat })))
        .sort((left, right) => (toMillis(right.data.lastEditionDate) || 0) - (toMillis(left.data.lastEditionDate) || 0))
        .slice(0, MAX_THREADS * 2)
    const blocks = await mapWithConcurrency(threads, PROJECT_CONCURRENCY, async ({ project, id, data }) => {
        if (!data.type) return null
        const comments = await safely(
            'a conversation',
            { userId, projectId: project.id, chatId: id },
            async () => {
                const snapshot = await db
                    .collection(`chatComments/${project.id}/${data.type}/${id}/comments`)
                    .where('created', '>=', since)
                    .orderBy('created', 'desc')
                    .limit(THREAD_COMMENTS_LIMIT)
                    .get()
                return snapshot.docs.map(doc => doc.data() || {})
            },
            []
        )
        const written = comments.filter(comment => comment.isLoading !== true && comment.isThinking !== true)
        if (!written.some(comment => comment.creatorId === userId && !comment.fromAssistant)) return null
        const lines = written
            .sort((left, right) => (toMillis(left.created) || 0) - (toMillis(right.created) || 0))
            .map(comment => {
                const who = comment.fromAssistant ? 'Assistant' : comment.creatorId === userId ? 'User' : 'Someone else'
                return `- ${who}: ${oneLine(comment.commentText, COMMENT_MAX_CHARS)}`
            })
        return `### ${oneLine(data.title, 150) || '(untitled conversation)'} [${oneLine(project.name, 60)}]\n${lines.join(
            '\n'
        )}`
    })
    return blocks.filter(Boolean).slice(0, MAX_THREADS)
}

async function collectGoalLines({ db, userId, projects, now }) {
    const goals = await mapWithConcurrency(projects, PROJECT_CONCURRENCY, project =>
        safely(
            'goals',
            { userId, projectId: project.id },
            async () => {
                const snapshot = await db
                    .collection(`goals/${project.id}/items`)
                    .where('assigneesIds', 'array-contains', userId)
                    .limit(30)
                    .get()
                return snapshot.docs.map(doc => ({ project, data: doc.data() || {} }))
            },
            []
        )
    )
    return goals
        .flat()
        .filter(({ data }) => {
            if (data.progress === 100 || !canAccessObject({ isPublicFor: [0], ...data }, userId)) return false
            const end = Number(data.completionMilestoneDate)
            if (end === BACKLOG_DATE_NUMERIC) return false
            return !Number.isFinite(end) || end >= now - DAY_MS
        })
        .sort(
            (left, right) =>
                (Number(left.data.completionMilestoneDate) || Infinity) -
                (Number(right.data.completionMilestoneDate) || Infinity)
        )
        .slice(0, MAX_GOALS)
        .map(({ project, data }) => {
            const end = Number(data.completionMilestoneDate)
            const progress = Number.isFinite(Number(data.progress)) ? `${Number(data.progress)}%` : ''
            const due = Number.isFinite(end) ? `due ${formatDate(end)}` : ''
            const details = [progress, due].filter(Boolean).join(', ')
            return `- ${oneLine(data.extendedName || data.name, 200) || '(untitled goal)'} [${oneLine(project.name, 60)}]${
                details ? ` (${details})` : ''
            }`
        })
}

/**
 * @returns {Promise<{ since: number, sections: Array<{key, title, lines}>, activityCount: number,
 *   counts: object }>} `activityCount` counts what the user did; the goals are context and do not
 *   count, so a quiet day makes no model call.
 */
async function collectAssistantProfileSources({
    db,
    userId,
    cursorAt = null,
    sources = {},
    includeAllMemory = false,
    now = Date.now(),
    listProjects = defaultListProjects,
    readNoteContent = defaultReadNoteContent,
}) {
    const enabled = key => sources[key] !== false
    const since = resolveSince({ cursorAt, now })
    const projects = (await listProjects({ db, userId })).slice(0, MAX_PROJECTS)
    const projectNames = new Map(projects.map(project => [project.id, project.name || project.id]))

    const activity = await mapWithConcurrency(projects, PROJECT_CONCURRENCY, project =>
        collectProjectActivity({
            db,
            userId,
            project,
            since,
            sources: {
                tasks: enabled('tasks'),
                notes: enabled('notes'),
                contacts: enabled('contacts'),
                chats: enabled('chats'),
            },
        })
    )

    const memory = enabled('memory')
        ? await safely(
              'assistant memory',
              { userId },
              () => collectMemory({ db, userId, since, includeAll: includeAllMemory, projectNames }),
              []
          )
        : []
    const taskLines = buildTaskLines(activity)
    const noteBlocks = enabled('notes') ? await buildNoteBlocks(activity, readNoteContent, userId) : []
    const contactLines = buildContactLines(activity)
    const threadBlocks = enabled('chats') ? await buildThreadBlocks({ db, activity, userId, since }) : []

    const counts = {
        projects: projects.length,
        memory: memory.length,
        tasks: taskLines.length,
        notes: noteBlocks.length,
        contacts: contactLines.length,
        chats: threadBlocks.length,
        goals: 0,
    }
    const activityCount = counts.memory + counts.tasks + counts.notes + counts.contacts + counts.chats

    // Goals only matter when there is something to write; on a quiet day they cost no reads.
    const goalLines = activityCount > 0 && enabled('goals') ? await collectGoalLines({ db, userId, projects, now }) : []
    counts.goals = goalLines.length

    const sections = [
        { key: 'memory', title: 'What the assistants remembered about the user', lines: memory },
        { key: 'tasks', title: 'Tasks the user completed', lines: taskLines },
        { key: 'notes', title: 'Notes the user edited (beginning of their text)', lines: noteBlocks },
        { key: 'contacts', title: 'Contacts the user edited', lines: contactLines },
        { key: 'chats', title: 'Conversations the user took part in', lines: threadBlocks },
        { key: 'goals', title: "The user's open goals (context)", lines: goalLines },
    ]
        .filter(section => section.lines.length > 0)
        .map(section => ({ ...section, lines: fitLines(section.lines, SECTION_BUDGETS[section.key]) }))

    return { since, sections, activityCount, counts }
}

function formatAssistantProfileSources(sections) {
    return sections.map(section => `## ${section.title}\n${section.lines.join('\n')}`).join('\n\n')
}

module.exports = {
    MAX_LOOKBACK_MS,
    SECTION_BUDGETS,
    resolveSince,
    fitLines,
    collectAssistantProfileSources,
    formatAssistantProfileSources,
}
