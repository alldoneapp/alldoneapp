'use strict'

// Collects what changed in a project since the wiki last looked, as compact text "source cards"
// for an ingest run.
//
// THE PRIVACY FILTER HERE IS THE ONLY ONE. Ingest runs read through the Admin SDK, which bypasses
// the security rules, and the wiki is readable by every member of the project. So an object is a
// source only when it is visible to the whole project (isPublicFor contains FEED_PUBLIC_FOR_ALL);
// a private task, a private note or a contact only one member can see must never reach a card.
//
// Documents members added to the wiki (knowledgeDocuments.js) are read here too. They live inside
// the wiki tree and so share its audience by construction, like corrections; one that was removed
// is no source any more. A long document is split into several cards ("part 2 of 4"), each small
// enough for one prompt, because chunkKnowledgeSources cuts a card that is too large rather than
// splitting it, and a deck's last slides matter as much as its first.
//
// Knowledge a member saved from a conversation (knowledgeContributions.js, `contribution:ID`) is read
// the same way and for the same reason: it lives inside the wiki tree, and one that was removed is no
// source any more. Its card says who saved it and whether the text is the member's own words or an
// assistant's summary that the member confirmed, because neither is a verified project record.
//
// Comment threads are sources too, one card per thread (`chat:ID`, the id of its chat object). A
// thread belongs to the task, note, goal, contact or artifact it is attached to and is exactly as
// visible as that object, whatever its own chat object says, so the object is read and filtered
// like a source of its own; a topic is its own object. A delta card holds only the comments written
// since the wiki last looked, because a thread is re-read every time anybody adds to it; a rebuild
// reads the latest comments instead. Artifacts (`artifact:ID`) contribute their title, description
// and the text of their current entry file (knowledgeArtifactText.js).
//
// The topics a member has with their assistant are sources like any other topic: the daily WhatsApp,
// heartbeat and menubar conversations, and the email day topics with their email comments (Anna's
// email conversations, the "Daily emails …" summaries of the Gmail labeling). They are visible to the
// whole project like any topic, things worth knowing get discussed there too, and the ingest decides
// what in them belongs to the project.
//
// Tasks created from an email (gmailData with the message they came from, AT-2833) are sources like
// any other task, and so are their threads: an actionable email lands in the project the labeling
// matched, and what is decided on it is project knowledge. They pass the same visibility filter as
// every other task and nothing more; the card says the task came from an email but carries no
// sender, address or mailbox.
//
// What else is deliberately left out, and why:
//   - the daily inbox counter task ("Emails in inbox", isForEmail): an unread count, not knowledge.
//     A thread of an excluded object is left out with it;
//   - the generated day-rate time-log task: bookkeeping, not knowledge;
//   - user memory notes (parentObject.type === 'users'): personal facts about one member;
//   - the wiki's own Gold-limit notice topic;
//   - the threads of users, assistants and skills: a member's profile chat, an assistant's board;
//   - a comment an assistant is still writing (isLoading / isThinking).
//
// Delta queries use single-field indexes only, so the wiki needs no composite index:
//   - `lastEditionDate` ascending for every type, paged with a cursor. A thread's chat object takes
//     the time of every new comment, so one query on chatObjects finds every thread with something
//     new, and its comments are then read by `created`, newest first;
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
const {
    buildKnowledgeSourceKey,
    estimateTextTokens,
    getKnowledgeContributionsPath,
    getKnowledgeDocumentsPath,
    parseKnowledgeSourceKey,
} = require('./knowledgeBaseModel')

const FEED_PUBLIC_FOR_ALL = 0
const DAY_MS = 24 * 60 * 60 * 1000
const GLOBAL_PROJECT_ID = 'globalProject'
// A Firestore id that is safe to put into a document path.
const AUTHOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

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
    {
        cursorKey: 'chats',
        // Every thread card reads its comments (and the object it belongs to), so threads are read in
        // smaller pages. The first look back is shorter than for tasks: a project's threads change
        // daily (a heartbeat and a WhatsApp topic per member and day), and every existing wiki
        // pays for that first build when threads become a source.
        type: 'chat',
        collectionPath: projectId => `chatObjects/${projectId}/chats`,
        field: 'lastEditionDate',
        direction: 'asc',
        pageLimit: 60,
        initialLookbackMs: 30 * DAY_MS,
    },
    {
        cursorKey: 'artifacts',
        // Every artifact card downloads its entry file.
        type: 'artifact',
        collectionPath: projectId => `artifactItems/${projectId}/artifacts`,
        field: 'lastEditionDate',
        direction: 'asc',
        pageLimit: 20,
        initialLookbackMs: null,
    },
    {
        cursorKey: 'documents',
        // Up to 120,000 characters each, so only a few per page.
        type: 'document',
        collectionPath: projectId => getKnowledgeDocumentsPath(projectId),
        field: 'lastEditionDate',
        direction: 'asc',
        pageLimit: 5,
        initialLookbackMs: null,
    },
    {
        cursorKey: 'contributions',
        // At most 4,000 characters each.
        type: 'contribution',
        collectionPath: projectId => getKnowledgeContributionsPath(projectId),
        field: 'lastEditionDate',
        direction: 'asc',
        pageLimit: 30,
        initialLookbackMs: null,
    },
]

const TASK_DESCRIPTION_MAX_CHARS = 1500
const GOAL_DESCRIPTION_MAX_CHARS = 1500
const CONTACT_DESCRIPTION_MAX_CHARS = 1500
const NOTE_CONTENT_MAX_CHARS = 6000
const NOTE_READ_CONCURRENCY = 5
const THREAD_COMMENT_MAX_CHARS = 1500
// Like a note: a thread contributes at most about one note's worth of text per card.
const THREAD_CARD_MAX_CHARS = 6000
const THREAD_COMMENTS_PER_CARD = 40
const THREAD_READ_CONCURRENCY = 5
const ARTIFACT_DESCRIPTION_MAX_CHARS = 1500
const ARTIFACT_CONTENT_MAX_CHARS = 6000
const ARTIFACT_READ_CONCURRENCY = 3

// The threads that are sources, by their chat object's `type`, and the source type of the object
// each belongs to. A topic is its own object.
const TOPIC_THREAD_TYPE = 'topics'
const THREAD_PARENT_SOURCE_TYPES = {
    tasks: 'task',
    notes: 'note',
    goals: 'goal',
    contacts: 'contact',
    artifacts: 'artifact',
}
// Topics the server opens with deterministic ids that are never sources: the wiki's own Gold-limit
// notice (knowledgeBaseCapNotice.js `WikiGoldCap_…`), which says nothing about the project. The
// channel topics a member has with their assistant (daily WhatsApp `BotChat…`, email
// `BotChatEmail…`, heartbeat `Heartbeat…`, menubar `MacApp…`) ARE sources.
const EXCLUDED_TOPIC_ID_PREFIXES = [{ prefix: 'WikiGoldCap_', reason: 'wiki_notice' }]
const THREAD_TYPE_LABELS = {
    tasks: 'the task',
    notes: 'the note',
    goals: 'the goal',
    contacts: 'the contact',
    artifacts: 'the artifact',
}
// Well under the ingest's 16,000-token chunk, so a part always travels whole and with company.
const DOCUMENT_PART_MAX_TOKENS = 10000
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
// other type a missing array is treated as private. A document added to the wiki is visible to the
// wiki's audience until it is removed.
function isVisibleToWholeProject(data, type) {
    if (type === 'document' || type === 'contribution') return !!data && data.status === 'active'
    if (!data || data.isPrivate === true) return false
    if (!Array.isArray(data.isPublicFor)) return type === 'goal'
    return data.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
}

// A task created from an email carries the message it came from (`gmailData.messageId`, or
// `messageIds` once a thread has continued on it): the Gmail labeling follow-up tasks and the email
// line's "create task". The daily inbox counter ("Emails in inbox", `isForEmail`, apis/
// EmailIntegration.js) carries gmailData too, but only a mailbox address and an unread count, and
// it is rewritten all day long; it is the inbox, not knowledge.
function isInboxSummaryEmailTask(data) {
    if (!data?.gmailData) return false
    if (data.isForEmail === true) return true
    const { messageId, messageIds } = data.gmailData
    const hasMessage =
        (typeof messageId === 'string' && messageId.trim()) ||
        (Array.isArray(messageIds) && messageIds.some(id => typeof id === 'string' && id.trim()))
    return !hasMessage
}

function getExclusionReason(data, type) {
    if (type === 'task') {
        if (isInboxSummaryEmailTask(data)) return 'email_inbox'
        if (data.genericData?.type === 'dayRateTimeLog') return 'generated'
    }
    if (type === 'note' && data.parentObject?.type === 'users') return 'user_memory'
    return null
}

// The object a thread belongs to, as a source type and document path, or null for a topic (its own
// object) and for the threads that are never sources.
function getThreadParent(projectId, chatId, chat) {
    const sourceType = THREAD_PARENT_SOURCE_TYPES[chat?.type]
    return sourceType ? { sourceType, path: SOURCE_DOC_PATHS[sourceType](projectId, chatId) } : null
}

// Why a thread is not a source, or null when it is. `parent` is the object the thread belongs to
// (undefined for a topic, null when that object is gone).
function getThreadExclusionReason(chatId, chat, parent) {
    if (chat?.type === TOPIC_THREAD_TYPE) {
        if (!isVisibleToWholeProject(chat, 'chat')) return 'private'
        const excluded = EXCLUDED_TOPIC_ID_PREFIXES.find(({ prefix }) => String(chatId).startsWith(prefix))
        return excluded ? excluded.reason : null
    }
    const sourceType = THREAD_PARENT_SOURCE_TYPES[chat?.type]
    if (!sourceType) return 'other_thread'
    if (!parent) return 'missing_parent'
    if (!isVisibleToWholeProject(parent, sourceType)) return 'private'
    return getExclusionReason(parent, sourceType)
}

// An email comment (gmailData) is a source like any other: it is what an email day topic consists of.
function isThreadCommentSource(comment) {
    if (!comment) return false
    return comment.isLoading !== true && comment.isThinking !== true
}

// Reads the objects the given threads belong to, in one batch, and decides for each thread whether
// it is a source. Returns a Map chatId -> { reason, thread } where `thread` describes it for its card.
async function resolveThreads(db, projectId, chats) {
    const parents = chats.map(({ id, data }) => getThreadParent(projectId, id, data))
    const refs = parents.filter(Boolean).map(parent => db.doc(parent.path))
    const snapshots = refs.length ? await db.getAll(...refs) : []
    const parentData = new Map(
        snapshots.map(snapshot => [snapshot.ref.path, snapshot.exists ? snapshot.data() || {} : null])
    )

    const threads = new Map()
    chats.forEach(({ id, data }, index) => {
        const parent = parents[index]
        const parentDoc = parent ? parentData.get(parent.path) : undefined
        const reason = getThreadExclusionReason(id, data, parentDoc)
        const title = parent
            ? cleanText(
                  parentDoc?.extendedName ||
                      parentDoc?.name ||
                      parentDoc?.extendedTitle ||
                      parentDoc?.title ||
                      parentDoc?.displayName,
                  300
              )
            : cleanText(data.title, 300)
        threads.set(id, {
            reason,
            thread: {
                threadType: data.type,
                title: title || cleanText(data.title, 300) || '(untitled conversation)',
                parentKey: parent ? buildKnowledgeSourceKey(parent.sourceType, id) : null,
            },
        })
    })
    return threads
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
    if (data.gmailData) details.push('created from an email')

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

// A document's text in parts of at most `maxTokens`, cut at line ends where it can be. The token
// count is kept as a running sum: re-estimating a growing part on every line would make a long
// document quadratic.
function splitDocumentText(text, maxTokens = DOCUMENT_PART_MAX_TOKENS) {
    const parts = []
    let current = []
    let currentTokens = 0
    const flush = () => {
        const part = current.join('\n').trim()
        if (part) parts.push(part)
        current = []
        currentTokens = 0
    }
    for (const line of String(text || '').split('\n')) {
        let rest = line
        let restTokens = estimateTextTokens(rest)
        if (currentTokens + restTokens + 1 > maxTokens) flush()
        // A single line longer than a part (a slide pasted as one paragraph) is cut by length.
        while (restTokens > maxTokens) {
            let cut = Math.max(1, Math.floor((rest.length * maxTokens) / restTokens))
            // The estimate is per character class, so a cut proportional to the whole line can still
            // land over budget when the text is denser at its start.
            while (cut > 1 && estimateTextTokens(rest.slice(0, cut)) > maxTokens) cut = Math.floor(cut * 0.9)
            parts.push(rest.slice(0, cut))
            rest = rest.slice(cut)
            restTokens = estimateTextTokens(rest)
        }
        current.push(rest)
        currentTokens += restTokens + 1
    }
    flush()
    return parts
}

function buildDocumentCards(id, data) {
    const title = cleanText(data.title || data.fileName, 300) || '(untitled document)'
    const details = []
    if (data.fileName) details.push(`file ${cleanText(data.fileName, 300)}`)
    const author = cleanText(data.authorName, 200)
    const addedOn = formatDate(toMillis(data.createdAt))
    if (author || addedOn) details.push(`added by ${author || 'a project member'}${addedOn ? ` on ${addedOn}` : ''}`)
    if (data.truncated) details.push('only the beginning of a longer file')
    const instructions = cleanText(data.instructions, 1000)
    const parts = splitDocumentText(data.text)
    return parts.map((part, index) => {
        const partLabel = parts.length > 1 ? `, part ${index + 1} of ${parts.length}` : ''
        const lines = [`[[document:${id}]] "${title}" (${details.join(', ')}${partLabel})`]
        if (instructions) lines.push(`The member who added it asked: ${instructions}`)
        lines.push(`Content:\n${part}`)
        return { title, text: lines.join('\n'), part: index }
    })
}

const CONTRIBUTION_ORIGIN_LABELS = {
    user_statement: "the member's own words",
    assistant_summary: "an assistant's summary of the conversation, which the member confirmed",
}

// Knowledge a member saved from a conversation. The card says plainly what it is: a statement by a
// member (or a summary they confirmed), not a project record anybody checked.
function buildContributionCard(id, data) {
    const title = cleanText(data.title, 300) || '(untitled)'
    const author = cleanText(data.authorName, 200) || 'a project member'
    const savedOn = formatDate(toMillis(data.createdAt))
    const origin = CONTRIBUTION_ORIGIN_LABELS[data.origin] || CONTRIBUTION_ORIGIN_LABELS.user_statement
    const lines = [
        `[[contribution:${id}]] "${title}" (saved to the wiki by ${author}${savedOn ? ` on ${savedOn}` : ''} from a conversation; ${origin}; not verified against project records)`,
        `Content:\n${cleanText(data.text, 4000)}`,
    ]
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

function describeCommentAuthor(comment, userNames, assistantNames) {
    const name = comment.fromAssistant
        ? assistantNames[comment.creatorId]
            ? `${assistantNames[comment.creatorId]} (assistant)`
            : 'an assistant'
        : userNames[comment.creatorId] || 'a project member'
    // Written by an MCP client in the member's name (shared/mcpActor.js).
    return comment.via === 'mcp' ? `${name} (via ${comment.viaClient || 'MCP'})` : name
}

// One thread as a card: the comments in the order they were written, the newest kept when they do
// not all fit. `comments` arrive newest first, already filtered; `moreBefore` says the read itself
// stopped at its limit, so there are older ones the card cannot show.
function buildThreadCard(id, thread, { comments, moreBefore }, userNames, assistantNames, { onlyNew }) {
    const lines = []
    let size = 0
    let omitted = moreBefore
    for (const comment of comments) {
        const text = cleanText(comment.commentText, THREAD_COMMENT_MAX_CHARS).replace(/\n+/g, '\n  ')
        if (!text) continue
        const date = formatDate(toMillis(comment.created))
        const line = `- ${date ? `${date} ` : ''}${describeCommentAuthor(comment, userNames, assistantNames)}: ${text}`
        if (lines.length && size + line.length > THREAD_CARD_MAX_CHARS) {
            omitted = true
            break
        }
        lines.push(line)
        size += line.length
    }
    if (!lines.length) return null
    lines.reverse()

    const where =
        thread.threadType === TOPIC_THREAD_TYPE
            ? `Chat topic "${thread.title}"`
            : `Comments on ${THREAD_TYPE_LABELS[thread.threadType] || 'the object'}${
                  thread.parentKey ? ` [[${thread.parentKey}]]` : ''
              } "${thread.title}"`
    const count = `${lines.length} ${onlyNew ? 'new ' : ''}comment${lines.length === 1 ? '' : 's'}`
    const header = `[[chat:${id}]] ${where} (${count}${omitted ? ', older ones left out' : ''})`
    return { title: thread.title, text: [header, ...lines].join('\n') }
}

function buildArtifactCard(id, data, content) {
    const title = cleanText(data.title, 300) || '(untitled artifact)'
    const details = [`${data.kind || 'file'} artifact`]
    const versions = Number(data.versionCount)
    if (Number.isFinite(versions) && versions > 0) details.push(`version ${versions}`)
    const edited = formatDate(toMillis(data.lastEditionDate))
    if (edited) details.push(`last changed ${edited}`)
    const lines = [`[[artifact:${id}]] "${title}" (${details.join(', ')})`]
    const description = cleanText(data.description, ARTIFACT_DESCRIPTION_MAX_CHARS)
    if (description) lines.push(`Description: ${description}`)
    const body = cleanText(content, ARTIFACT_CONTENT_MAX_CHARS)
    if (body) lines.push(`Content:\n${body}`)
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
        // Where this read began: for a thread, the comments written since then are the new ones.
        fromMs,
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

// Assistants live in the project's own assistants collection or, for the shared ones, in the
// global project; a comment only names its author's id.
async function resolveAssistantNamesFromFirestore(db, projectId, assistantIds) {
    const ids = [...new Set(assistantIds.filter(id => typeof id === 'string' && AUTHOR_ID_PATTERN.test(id)))]
    const names = {}
    for (const collectionProjectId of [projectId, GLOBAL_PROJECT_ID]) {
        const missing = ids.filter(id => !names[id])
        for (let index = 0; index < missing.length; index += 100) {
            const refs = missing
                .slice(index, index + 100)
                .map(id => db.doc(`assistants/${collectionProjectId}/items/${id}`))
            const snapshots = await db.getAll(...refs)
            snapshots.forEach(snapshot => {
                if (!snapshot.exists) return
                const name = (snapshot.data() || {}).displayName
                if (name) names[snapshot.id] = String(name)
            })
        }
    }
    return names
}

// The newest comments of a thread, newest first: those written since `sinceMs` for a delta, the
// latest ones for a rebuild. `created` has the default single-field index in both directions.
async function readThreadCommentsFromFirestore(db, { projectId, threadType, chatId, sinceMs, limit }) {
    let query = db.collection(`chatComments/${projectId}/${threadType}/${chatId}/comments`)
    if (Number.isFinite(sinceMs)) query = query.where('created', '>=', sinceMs)
    const snapshot = await query.orderBy('created', 'desc').limit(limit).get()
    return snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
}

function createDefaultArtifactContentReader() {
    return async (projectId, artifactId, artifact) => {
        const admin = require('firebase-admin')
        const { readArtifactText } = require('./knowledgeArtifactText')
        return readArtifactText({
            bucket: admin.storage().bucket(),
            projectId,
            artifactId,
            artifact,
            maxChars: ARTIFACT_CONTENT_MAX_CHARS,
        })
    }
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
    readThreadComments = options => readThreadCommentsFromFirestore(db, options),
    readArtifactContent = createDefaultArtifactContentReader(),
    resolveUserNames = userIds => resolveUserNamesFromFirestore(db, userIds),
    resolveAssistantNames = assistantIds => resolveAssistantNamesFromFirestore(db, projectId, assistantIds),
}) {
    if (!db) throw new Error('db is required')
    if (!projectId) throw new Error('projectId is required')

    const results = await Promise.all(
        SOURCE_QUERIES.map(async spec => ({ spec, ...(await runSourceQuery({ db, projectId, spec, cursor, now })) }))
    )
    const chatsResult = results.find(result => result.spec.type === 'chat')
    const threads =
        chatsResult && chatsResult.docs.length ? await resolveThreads(db, projectId, chatsResult.docs) : new Map()

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

            const reason =
                spec.type === 'chat'
                    ? threads.get(doc.id)?.reason
                    : !isVisibleToWholeProject(doc.data, spec.type)
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
                    ...(spec.type === 'chat' && { thread: threads.get(doc.id).thread, commentsSinceMs: result.fromMs }),
                })
            }
        }
        if (position) nextCursor[spec.cursorKey] = position
    }

    const sources = (
        await buildSourceCards({
            projectId,
            entries: [...candidates.values()],
            readNoteContent,
            readThreadComments,
            readArtifactContent,
            resolveUserNames,
            resolveAssistantNames,
        })
    ).sort(
        (left, right) =>
            left.updatedAt - right.updatedAt ||
            (left.key < right.key ? -1 : left.key > right.key ? 1 : left.part - right.part)
    )

    stats.included = sources.length
    return { sources, nextCursor, exhausted: results.every(result => result.exhausted), stats }
}

// Turns visible, non-excluded documents into cards: downloads note bodies, reads thread comments and
// artifact files, a few at a time, then resolves the names the cards mention.
async function buildSourceCards({
    projectId,
    entries,
    readNoteContent,
    readThreadComments,
    readArtifactContent,
    resolveUserNames,
    resolveAssistantNames,
}) {
    const noteContents = new Map()
    const threadComments = new Map()
    const artifactContents = new Map()
    const readEach = (type, concurrency, read, describe) =>
        mapWithConcurrency(
            entries.filter(entry => entry.type === type),
            concurrency,
            async entry => {
                try {
                    await read(entry)
                } catch (error) {
                    // A source whose content cannot be read still contributes what its document says.
                    console.warn(`[knowledge base] Could not read ${describe}`, {
                        projectId,
                        id: entry.id,
                        error: error.message,
                    })
                }
            }
        )
    await Promise.all([
        readEach(
            'note',
            NOTE_READ_CONCURRENCY,
            async entry => {
                noteContents.set(entry.id, await readNoteContent(projectId, entry.id))
            },
            'note content'
        ),
        readEach(
            'chat',
            THREAD_READ_CONCURRENCY,
            async entry => {
                const comments = await readThreadComments({
                    projectId,
                    threadType: entry.thread.threadType,
                    chatId: entry.id,
                    sinceMs: entry.commentsSinceMs,
                    limit: THREAD_COMMENTS_PER_CARD,
                })
                const read = Array.isArray(comments) ? comments : []
                threadComments.set(entry.id, {
                    comments: read
                        .filter(isThreadCommentSource)
                        .sort((left, right) => (toMillis(right.created) || 0) - (toMillis(left.created) || 0)),
                    moreBefore: read.length >= THREAD_COMMENTS_PER_CARD,
                })
            },
            'thread comments'
        ),
        readEach(
            'artifact',
            ARTIFACT_READ_CONCURRENCY,
            async entry => {
                artifactContents.set(entry.id, await readArtifactContent(projectId, entry.id, entry.data))
            },
            'artifact content'
        ),
    ])

    const userIds = []
    const assistantIds = []
    entries.forEach(entry => {
        if (entry.type === 'task') userIds.push(entry.data.userId)
        if (entry.type === 'goal' && Array.isArray(entry.data.assigneesIds)) userIds.push(...entry.data.assigneesIds)
    })
    threadComments.forEach(({ comments }) =>
        comments.forEach(comment => (comment.fromAssistant ? assistantIds : userIds).push(comment.creatorId))
    )
    const [userNames, assistantNames] = await Promise.all([
        userIds.length ? resolveUserNames(userIds) : {},
        assistantIds.length ? resolveAssistantNames(assistantIds) : {},
    ])

    return entries.flatMap(entry => {
        const cards =
            entry.type === 'task'
                ? [buildTaskCard(entry.id, entry.data, userNames)]
                : entry.type === 'goal'
                  ? [buildGoalCard(entry.id, entry.data, userNames)]
                  : entry.type === 'note'
                    ? [buildNoteCard(entry.id, entry.data, noteContents.get(entry.id))]
                    : entry.type === 'chat'
                      ? // A thread whose chat object moved without a comment (a rename, a follower) has
                        // nothing new to say.
                        [
                            buildThreadCard(
                                entry.id,
                                entry.thread,
                                threadComments.get(entry.id) || { comments: [], moreBefore: false },
                                userNames,
                                assistantNames,
                                {
                                    onlyNew: Number.isFinite(entry.commentsSinceMs),
                                }
                            ),
                        ].filter(Boolean)
                      : entry.type === 'artifact'
                        ? [buildArtifactCard(entry.id, entry.data, artifactContents.get(entry.id))]
                        : entry.type === 'correction'
                          ? [buildCorrectionCard(entry.id, entry.data)]
                          : entry.type === 'document'
                            ? buildDocumentCards(entry.id, entry.data)
                            : entry.type === 'contribution'
                              ? [buildContributionCard(entry.id, entry.data)]
                              : [buildContactCard(entry.id, entry.data)]
        return cards.map((card, index) => ({
            key: entry.key,
            type: entry.type,
            id: entry.id,
            title: card.title,
            text: card.text,
            tokens: estimateTextTokens(card.text),
            updatedAt: entry.updatedAt,
            part: index,
            // Only the last part moves the cursor: a run that stops after part 2 of 4 must read the
            // whole document again next time rather than never seeing parts 3 and 4.
            positions: index === cards.length - 1 ? entry.positions || [] : [],
        }))
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
    chat: (projectId, id) => `chatObjects/${projectId}/chats/${id}`,
    artifact: (projectId, id) => `artifactItems/${projectId}/artifacts/${id}`,
    correction: (projectId, id) => `knowledgeBases/${projectId}/corrections/${id}`,
    document: (projectId, id) => `${getKnowledgeDocumentsPath(projectId)}/${id}`,
    contribution: (projectId, id) => `${getKnowledgeContributionsPath(projectId)}/${id}`,
}

/**
 * Cards for a known set of source keys, as a page rebuild needs them. Every object is read again
 * and goes through the same visibility filter as the delta: a key on a page is a hint, never
 * proof that the object is still visible to the whole project. Missing objects are dropped. A
 * thread is read again through the object it belongs to, and contributes its latest comments.
 */
async function loadKnowledgeSourcesByKeys({
    db,
    projectId,
    keys,
    readNoteContent = createDefaultNoteContentReader(),
    readThreadComments = options => readThreadCommentsFromFirestore(db, options),
    readArtifactContent = createDefaultArtifactContentReader(),
    resolveUserNames = userIds => resolveUserNamesFromFirestore(db, userIds),
    resolveAssistantNames = assistantIds => resolveAssistantNamesFromFirestore(db, projectId, assistantIds),
}) {
    const parsed = [...new Set(keys || [])].map(parseKnowledgeSourceKey).filter(Boolean)
    if (!parsed.length) return []

    const snapshots = await db.getAll(...parsed.map(({ type, id }) => db.doc(SOURCE_DOC_PATHS[type](projectId, id))))
    const loaded = snapshots
        .map((snapshot, index) => ({ ...parsed[index], exists: snapshot.exists, data: snapshot.data() || {} }))
        .filter(({ exists }) => exists)
    const chats = loaded.filter(({ type }) => type === 'chat')
    const threads = chats.length ? await resolveThreads(db, projectId, chats) : new Map()

    const entries = []
    loaded.forEach(({ type, id, data }) => {
        // Corrections live inside the wiki itself and share its audience by construction; one that
        // was undone is no source any more.
        if (type === 'correction') {
            if (data.status === 'reverted') return
        } else if (type === 'chat') {
            if (threads.get(id).reason) return
        } else if (!isVisibleToWholeProject(data, type) || getExclusionReason(data, type)) {
            return
        }
        entries.push({
            key: `${type}:${id}`,
            type,
            id,
            data,
            updatedAt: toMillis(data.lastEditionDate) || toMillis(data.createdAt) || 0,
            ...(type === 'chat' && { thread: threads.get(id).thread, commentsSinceMs: null }),
        })
    })
    return buildSourceCards({
        projectId,
        entries,
        readNoteContent,
        readThreadComments,
        readArtifactContent,
        resolveUserNames,
        resolveAssistantNames,
    })
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
    DOCUMENT_PART_MAX_TOKENS,
    THREAD_COMMENTS_PER_CARD,
    isVisibleToWholeProject,
    isInboxSummaryEmailTask,
    getExclusionReason,
    getThreadExclusionReason,
    collectKnowledgeSources,
    loadKnowledgeSourcesByKeys,
    buildCorrectionCard,
    buildDocumentCards,
    buildContributionCard,
    splitDocumentText,
    advanceKnowledgeCursor,
    chunkKnowledgeSources,
    cleanText,
}
