const { KnowledgeFirestoreDouble } = require('./__fixtures__/knowledgeFirestoreDouble')
const {
    SOURCE_QUERIES,
    advanceKnowledgeCursor,
    chunkKnowledgeSources,
    collectKnowledgeSources,
    isVisibleToWholeProject,
} = require('./collectKnowledgeSources')

const PROJECT_ID = 'project-a'
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 24, 12)
const PUBLIC = [0, 'owner']

const taskPath = id => `items/${PROJECT_ID}/tasks/${id}`
const goalPath = id => `goals/${PROJECT_ID}/items/${id}`
const notePath = id => `noteItems/${PROJECT_ID}/notes/${id}`
const contactPath = id => `projectsContacts/${PROJECT_ID}/contacts/${id}`

function collect(db, options = {}) {
    return collectKnowledgeSources({
        db,
        projectId: PROJECT_ID,
        now: NOW,
        readNoteContent: async (projectId, noteId) => `Body of ${noteId}`,
        resolveUserNames: async () => ({ owner: 'Karsten', teammate: 'Daniela' }),
        ...options,
    })
}

describe('isVisibleToWholeProject', () => {
    it('admits only objects the whole project may read', () => {
        expect(isVisibleToWholeProject({ isPublicFor: [0, 'u1'] }, 'task')).toBe(true)
        expect(isVisibleToWholeProject({ isPublicFor: ['u1'] }, 'task')).toBe(false)
        expect(isVisibleToWholeProject({ isPublicFor: [0, 'u1'], isPrivate: true }, 'task')).toBe(false)
        expect(isVisibleToWholeProject({}, 'note')).toBe(false)
        expect(isVisibleToWholeProject(null, 'task')).toBe(false)
    })

    it('treats a goal without isPublicFor as public, the way the app renders it', () => {
        expect(isVisibleToWholeProject({}, 'goal')).toBe(true)
        expect(isVisibleToWholeProject({ isPublicFor: ['u1'] }, 'goal')).toBe(false)
    })
})

describe('collectKnowledgeSources', () => {
    it('never turns a private object into a source card', async () => {
        const db = new KnowledgeFirestoreDouble({
            [taskPath('public')]: { name: 'Release planen', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
            [taskPath('private')]: {
                name: 'Gehaltsgespräch vorbereiten',
                description: 'streng vertraulich',
                isPublicFor: ['owner'],
                lastEditionDate: NOW - DAY,
            },
            [notePath('private-note')]: { title: 'Privat', isPublicFor: ['owner'], lastEditionDate: NOW - DAY },
            [contactPath('private-contact')]: {
                displayName: 'Nur ich',
                isPublicFor: ['owner'],
                lastEditionDate: NOW - DAY,
            },
        })
        const readNoteContent = jest.fn(async () => 'never read')

        const { sources, stats } = await collect(db, { readNoteContent })

        expect(sources.map(source => source.key)).toEqual(['task:public'])
        expect(JSON.stringify(sources)).not.toMatch(/Gehaltsgespräch|vertraulich|Nur ich/)
        expect(readNoteContent).not.toHaveBeenCalled()
        expect(stats.skipped.private).toBe(3)
    })

    it('leaves out email tasks, generated time logs and user memory notes', async () => {
        const db = new KnowledgeFirestoreDouble({
            [taskPath('email')]: {
                name: 'Mail',
                gmailData: { messageId: 'm1' },
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - DAY,
            },
            [taskPath('timelog')]: {
                name: 'Time log',
                genericData: { type: 'dayRateTimeLog' },
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - DAY,
            },
            [notePath('memory')]: {
                title: 'Karsten memory',
                parentObject: { type: 'users', id: 'owner' },
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - DAY,
            },
        })

        const { sources, stats } = await collect(db)

        expect(sources).toEqual([])
        expect(stats.skipped).toEqual({ email: 1, generated: 1, user_memory: 1 })
    })

    it('builds compact cards that cite each object with its own token', async () => {
        const db = new KnowledgeFirestoreDouble({
            [taskPath('t1')]: {
                extendedName: 'Release planen',
                description:
                    'Termin mit O2TI5plHBf1QfdYhttps://x.pngO2TI5plHBf1QfdYhttps://x.pngO2TI5plHBf1QfdYbildO2TI5plHBf1QfdYfalse Team',
                userId: 'owner',
                parentGoalId: 'g1',
                dueDate: Date.UTC(2026, 10, 3),
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - 3 * DAY,
            },
            [taskPath('someday')]: {
                name: 'Irgendwann',
                dueDate: Date.UTC(5000, 0, 1),
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - 2 * DAY,
            },
            [goalPath('g1')]: {
                extendedName: 'Release v2',
                progress: 40,
                assigneesIds: ['owner', 'teammate'],
                lastEditionDate: NOW - 2 * DAY,
            },
            [notePath('n1')]: {
                extendedTitle: 'Meeting-Notizen',
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - DAY,
            },
            [contactPath('c1')]: {
                displayName: 'Jane Doe',
                role: 'CTO',
                company: 'Acme',
                email: 'jane@acme.test',
                phone: '+49 123',
                description: 'Entscheidet über das Budget.',
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - DAY,
            },
        })

        const { sources } = await collect(db)
        const byKey = Object.fromEntries(sources.map(source => [source.key, source]))

        expect(byKey['task:t1'].text).toBe(
            '[[task:t1]] "Release planen" (open, due 2026-11-03, assigned to Karsten, goal [[goal:g1]])\nDescription: Termin mit bild Team'
        )
        expect(byKey['task:someday'].text).toBe('[[task:someday]] "Irgendwann" (open)')
        expect(byKey['goal:g1'].text).toBe('[[goal:g1]] "Release v2" (progress 40%, assigned to Karsten, Daniela)')
        expect(byKey['note:n1'].text).toBe(
            '[[note:n1]] "Meeting-Notizen" (last edited 2026-10-23)\nContent:\nBody of n1'
        )
        expect(byKey['contact:c1'].text).toBe(
            '[[contact:c1]] "Jane Doe" (CTO at Acme)\nDescription: Entscheidet über das Budget.'
        )
        expect(byKey['contact:c1'].text).not.toMatch(/jane@acme|\+49/)
        expect(sources.map(source => source.key)).toEqual([
            'task:t1',
            'goal:g1',
            'task:someday',
            'contact:c1',
            'note:n1',
        ])
    })

    it('finds a task completed without a new lastEditionDate', async () => {
        const db = new KnowledgeFirestoreDouble({
            [taskPath('t1')]: {
                name: 'Vertrag unterschreiben',
                done: true,
                completed: NOW - 60_000,
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - 40 * DAY,
            },
        })
        const cursor = { tasks: { ms: NOW - 10 * DAY, ids: [] }, tasksCompleted: { ms: NOW - 10 * DAY, ids: [] } }

        const { sources, nextCursor } = await collect(db, { cursor })

        expect(sources).toHaveLength(1)
        expect(sources[0].text).toBe('[[task:t1]] "Vertrag unterschreiben" (done 2026-10-24)')
        expect(nextCursor.tasksCompleted).toEqual({ ms: NOW - 60_000, ids: ['t1'] })
        expect(nextCursor.tasks).toEqual({ ms: NOW - 10 * DAY, ids: [] })
    })

    it('reads a task found by both queries once and records both positions', async () => {
        const db = new KnowledgeFirestoreDouble({
            [taskPath('t1')]: {
                name: 'X',
                done: true,
                completed: NOW - 5,
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - 5,
            },
        })

        const { sources } = await collect(db, {
            cursor: { tasks: { ms: NOW - DAY, ids: [] }, tasksCompleted: { ms: NOW - DAY, ids: [] } },
        })

        expect(sources).toHaveLength(1)
        expect(sources[0].positions).toEqual([
            { cursorKey: 'tasks', ms: NOW - 5 },
            { cursorKey: 'tasksCompleted', ms: NOW - 5 },
        ])
    })

    it('looks back a bounded window on the first build instead of reading all history', async () => {
        const db = new KnowledgeFirestoreDouble({
            [taskPath('recent')]: { name: 'Neu', isPublicFor: PUBLIC, lastEditionDate: NOW - 10 * DAY },
            [taskPath('ancient')]: { name: 'Alt', isPublicFor: PUBLIC, lastEditionDate: NOW - 400 * DAY },
            [goalPath('old-goal')]: { name: 'Alt, aber ein Ziel', lastEditionDate: NOW - 400 * DAY },
        })

        const { sources } = await collect(db)

        expect(sources.map(source => source.key)).toEqual(['goal:old-goal', 'task:recent'])
    })

    it('uses only single-field orderings, in the direction the indexes exist for', async () => {
        const db = new KnowledgeFirestoreDouble({})

        await collect(db)

        const shapes = db.queries.map(query => ({
            path: query.collectionPath,
            filters: query.filters.map(filter => `${filter.field} ${filter.operator}`),
            orders: query.orders.map(order => `${order.field} ${order.direction}`),
        }))
        expect(shapes).toEqual(
            SOURCE_QUERIES.map(spec => ({
                path: spec.collectionPath(PROJECT_ID),
                filters: [`${spec.field} >=`],
                orders: [`${spec.field} ${spec.direction}`],
            }))
        )
        // tasks.completed is indexed DESCENDING only (firestore.indexes.json field override).
        expect(shapes.find(shape => shape.orders[0].startsWith('completed'))).toMatchObject({
            orders: ['completed desc'],
        })
    })

    it('pages through a long backlog without skipping or repeating documents that share a timestamp', async () => {
        const documents = {}
        for (let index = 0; index < 250; index++) {
            documents[taskPath(`t${String(index).padStart(3, '0')}`)] = {
                name: `Task ${index}`,
                isPublicFor: PUBLIC,
                // Pairs of tasks share a millisecond, including across the page boundary.
                lastEditionDate: NOW - DAY + Math.floor(index / 2),
            }
        }
        const db = new KnowledgeFirestoreDouble(documents)
        const cursor = { tasks: { ms: NOW - 2 * DAY, ids: [] } }

        const first = await collect(db, { cursor })
        const second = await collect(db, { cursor: first.nextCursor })
        const third = await collect(db, { cursor: second.nextCursor })

        const tasks = result => result.sources.filter(source => source.type === 'task').map(source => source.id)
        const seen = [...tasks(first), ...tasks(second)]
        expect(first.exhausted).toBe(false)
        expect(new Set(seen).size).toBe(250)
        expect(seen).toHaveLength(250)
        expect(tasks(third)).toEqual([])
        expect(third.exhausted).toBe(true)
    })

    it('moves the cursor past private documents so they cannot stall the wiki', async () => {
        const documents = {}
        for (let index = 0; index < 200; index++) {
            documents[taskPath(`p${String(index).padStart(3, '0')}`)] = {
                name: 'privat',
                isPublicFor: ['owner'],
                lastEditionDate: NOW - DAY + index,
            }
        }
        documents[taskPath('after')] = { name: 'Danach', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY + 500 }
        const db = new KnowledgeFirestoreDouble(documents)

        const first = await collect(db, { cursor: { tasks: { ms: NOW - 2 * DAY, ids: [] } } })
        const second = await collect(db, { cursor: first.nextCursor })

        expect(first.sources).toEqual([])
        expect(second.sources.map(source => source.key)).toEqual(['task:after'])
    })

    it('reports a burst of completions larger than its window instead of hiding it', async () => {
        const documents = {}
        for (let index = 0; index < 301; index++) {
            documents[taskPath(`d${index}`)] = {
                name: 'erledigt',
                done: true,
                completed: NOW - 1000 + index,
                isPublicFor: PUBLIC,
            }
        }
        const db = new KnowledgeFirestoreDouble(documents)

        const { stats } = await collect(db, { cursor: { tasksCompleted: { ms: NOW - DAY, ids: [] } } })

        expect(stats.truncated).toEqual(['tasksCompleted'])
    })

    it('keeps a note whose body cannot be read, with its preview', async () => {
        const db = new KnowledgeFirestoreDouble({
            [notePath('n1')]: {
                title: 'Kickoff',
                preview: 'Ziele und Rollen',
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - DAY,
            },
        })
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

        const { sources } = await collect(db, {
            readNoteContent: async () => {
                throw new Error('storage unavailable')
            },
        })

        expect(sources[0].text).toContain('Content:\nZiele und Rollen')
        warn.mockRestore()
    })
})

describe('advanceKnowledgeCursor', () => {
    it('moves each query only as far as the sources actually processed', () => {
        const cursor = { tasks: { ms: 10, ids: ['a'] }, notes: { ms: 5, ids: [] } }
        const processed = [
            { id: 'b', positions: [{ cursorKey: 'tasks', ms: 10 }] },
            {
                id: 'c',
                positions: [
                    { cursorKey: 'tasks', ms: 12 },
                    { cursorKey: 'tasksCompleted', ms: 30 },
                ],
            },
        ]

        expect(advanceKnowledgeCursor(cursor, processed)).toEqual({
            tasks: { ms: 12, ids: ['c'] },
            tasksCompleted: { ms: 30, ids: ['c'] },
            notes: { ms: 5, ids: [] },
        })
    })
})

describe('chunkKnowledgeSources', () => {
    const source = (key, tokens) => ({ key, tokens, text: 'x'.repeat(tokens * 3) })

    it('fills each chunk up to the budget, oldest first', () => {
        const chunks = chunkKnowledgeSources([source('a', 400), source('b', 400), source('c', 400)], {
            maxTokens: 1000,
        })
        expect(chunks.map(chunk => chunk.map(item => item.key))).toEqual([['a', 'b'], ['c']])
    })

    it('cuts a single oversized source down to the budget instead of dropping it', () => {
        const [[item]] = chunkKnowledgeSources([source('huge', 5000)], { maxTokens: 1000 })
        expect(item.key).toBe('huge')
        expect(item.tokens).toBeLessThanOrEqual(1000)
        expect(item.text.endsWith('[…]')).toBe(true)
    })
})

describe('loadKnowledgeSourcesByKeys', () => {
    const { loadKnowledgeSourcesByKeys } = require('./collectKnowledgeSources')

    it('reads the objects behind a page again and drops any that are no longer visible to everyone', async () => {
        const db = new KnowledgeFirestoreDouble({
            [taskPath('still-public')]: { name: 'Acme Pilot', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
            [taskPath('now-private')]: { name: 'Gehalt', isPublicFor: ['owner'], lastEditionDate: NOW - DAY },
            [`knowledgeBases/${PROJECT_ID}/corrections/c1`]: {
                text: 'Acme hat gekündigt.',
                authorName: 'Karsten',
                pageSlug: 'kunden',
                createdAt: NOW - DAY,
            },
        })

        const sources = await loadKnowledgeSourcesByKeys({
            db,
            projectId: PROJECT_ID,
            keys: ['task:still-public', 'task:now-private', 'task:deleted', 'correction:c1', 'not a key'],
            readNoteContent: async () => '',
            resolveUserNames: async () => ({}),
        })

        expect(sources.map(source => source.key)).toEqual(['task:still-public', 'correction:c1'])
        expect(sources[1].text).toBe(
            '[[correction:c1]] Correction by Karsten (2026-10-23) on page [[kunden]]: Acme hat gekündigt.'
        )
    })

    it('drops a correction that was undone', async () => {
        const db = new KnowledgeFirestoreDouble({
            [`knowledgeBases/${PROJECT_ID}/corrections/c1`]: { text: 'Acme hat gekündigt.', status: 'reverted' },
        })

        const sources = await loadKnowledgeSourcesByKeys({ db, projectId: PROJECT_ID, keys: ['correction:c1'] })

        expect(sources).toEqual([])
    })
})

describe('documents added to the wiki', () => {
    const {
        DOCUMENT_PART_MAX_TOKENS,
        loadKnowledgeSourcesByKeys,
        splitDocumentText,
    } = require('./collectKnowledgeSources')
    const { estimateTextTokens } = require('./knowledgeBaseModel')
    const documentPath = id => `knowledgeBases/${PROJECT_ID}/documents/${id}`
    const slide = number => `Slide ${number}\n${`Pricing point ${number} `.repeat(60).trim()}`
    const longText = Array.from({ length: 40 }, (_, index) => slide(index + 1)).join('\n\n')

    function documentDb() {
        return new KnowledgeFirestoreDouble({
            [documentPath('deck')]: {
                title: 'Pricing concept 2026',
                fileName: 'pricing.pptx',
                authorName: 'Karsten',
                instructions: 'Only the pricing',
                text: longText,
                status: 'active',
                createdAt: NOW - DAY,
                lastEditionDate: NOW - DAY,
            },
            [documentPath('withdrawn')]: {
                title: 'Old deck',
                status: 'removed',
                createdAt: NOW - DAY,
                lastEditionDate: NOW - DAY,
            },
        })
    }

    it('turns a long document into parts that each fit a prompt, in order, and skips a removed one', async () => {
        const { sources, stats } = await collect(documentDb())

        expect(sources.length).toBeGreaterThan(1)
        expect(sources.every(source => source.key === 'document:deck')).toBe(true)
        expect(stats.skipped).toEqual({ private: 1 })
        sources.forEach((source, index) => {
            expect(source.title).toBe('Pricing concept 2026')
            expect(source.tokens).toBeLessThanOrEqual(DOCUMENT_PART_MAX_TOKENS + 200)
            expect(source.text.split('\n').slice(0, 3)).toEqual([
                `[[document:deck]] "Pricing concept 2026" (file pricing.pptx, added by Karsten on 2026-10-23, part ${
                    index + 1
                } of ${sources.length})`,
                'The member who added it asked: Only the pricing',
                'Content:',
            ])
        })
        // Nothing is lost or repeated between the parts, and the last slide is still there.
        const content = sources.map(source => source.text.split('Content:\n')[1]).join('\n')
        expect(content.replace(/\s+/g, ' ')).toBe(longText.replace(/\s+/g, ' '))
        // A part always travels whole: the chunker never has to cut one.
        chunkKnowledgeSources(sources, { maxTokens: 16000 })
            .flat()
            .forEach((item, index) => expect(item.text).toBe(sources[index].text))
    })

    it('moves the cursor only with the last part, so a run stopped mid-document reads it again', async () => {
        const { sources } = await collect(documentDb())
        const firstParts = sources.slice(0, -1)

        expect(firstParts.every(source => source.positions.length === 0)).toBe(true)
        expect(advanceKnowledgeCursor({}, firstParts)).toEqual({})
        expect(advanceKnowledgeCursor({}, sources)).toEqual({ documents: { ms: NOW - DAY, ids: ['deck'] } })
    })

    it('rebuilds a page from every part of a document it cites, and from nothing once it is removed', async () => {
        const parts = await loadKnowledgeSourcesByKeys({
            db: documentDb(),
            projectId: PROJECT_ID,
            keys: ['document:deck', 'document:withdrawn'],
        })

        expect(parts.length).toBeGreaterThan(1)
        expect(new Set(parts.map(part => part.key))).toEqual(new Set(['document:deck']))
        expect(parts.map(part => part.part)).toEqual(parts.map((part, index) => index))
    })

    it('splits at line ends, and cuts a single line longer than a part by length', () => {
        const parts = splitDocumentText(`short\n${'ü'.repeat(25000)}\nend`, 10000)

        expect(parts[0]).toBe('short')
        expect(parts.every(part => estimateTextTokens(part) <= 10000)).toBe(true)
        // The cuts inside the long line fall mid-line; "end" follows the line's last piece.
        expect(parts.join('')).toBe(`short${'ü'.repeat(25000)}\nend`)
        expect(splitDocumentText('')).toEqual([])
    })
})

describe('comment threads and artifacts', () => {
    const { THREAD_COMMENTS_PER_CARD, loadKnowledgeSourcesByKeys: loadByKeys } = require('./collectKnowledgeSources')
    const chatPath = id => `chatObjects/${PROJECT_ID}/chats/${id}`
    const commentPath = (threadType, chatId, id) => `chatComments/${PROJECT_ID}/${threadType}/${chatId}/comments/${id}`
    const artifactPath = id => `artifactItems/${PROJECT_ID}/artifacts/${id}`

    function threadOptions(extra = {}) {
        return {
            resolveAssistantNames: async () => ({ anna: 'Anna' }),
            readArtifactContent: async (projectId, artifactId) => `Text of ${artifactId}`,
            ...extra,
        }
    }

    function threadDb(extraDocuments = {}) {
        return new KnowledgeFirestoreDouble({
            [taskPath('t1')]: { extendedName: 'Release planen', isPublicFor: PUBLIC, lastEditionDate: NOW - 20 * DAY },
            [chatPath('t1')]: {
                type: 'tasks',
                title: 'Release planen',
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - DAY,
            },
            [commentPath('tasks', 't1', 'c1')]: {
                commentText: 'Wir releasen am 3. November.',
                creatorId: 'owner',
                fromAssistant: false,
                created: NOW - 2 * DAY,
            },
            [commentPath('tasks', 't1', 'c2')]: {
                commentText: 'Ich habe den Changelog vorbereitet.',
                creatorId: 'anna',
                fromAssistant: true,
                created: NOW - DAY,
            },
            ...extraDocuments,
        })
    }

    it('turns the thread of a visible task into one card, oldest comment first, with its authors', async () => {
        const { sources } = await collect(threadDb(), threadOptions())

        const thread = sources.find(source => source.key === 'chat:t1')
        expect(thread.title).toBe('Release planen')
        expect(thread.text.split('\n')).toEqual([
            '[[chat:t1]] Comments on the task [[task:t1]] "Release planen" (2 new comments)',
            '- 2026-10-22 Karsten: Wir releasen am 3. November.',
            '- 2026-10-23 Anna (assistant): Ich habe den Changelog vorbereitet.',
        ])
    })

    it('never reads the comments of a thread whose object the whole project cannot see', async () => {
        const readThreadComments = jest.fn(async () => [{ commentText: 'geheim', creatorId: 'owner', created: NOW }])
        const db = threadDb({
            [taskPath('t1')]: { name: 'Gehalt', isPublicFor: ['owner'], lastEditionDate: NOW - 20 * DAY },
            [taskPath('mail')]: { name: 'Mail', gmailData: { messageId: 'm' }, isPublicFor: PUBLIC },
            [chatPath('mail')]: { type: 'tasks', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
            // The chat object says public, but its task is gone.
            [chatPath('orphan')]: { type: 'tasks', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
            [chatPath('profile')]: { type: 'users', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
        })

        const { sources, stats } = await collect(db, threadOptions({ readThreadComments }))

        expect(sources.filter(source => source.type === 'chat')).toEqual([])
        expect(readThreadComments).not.toHaveBeenCalled()
        // The private task is skipped twice: as a task and as the object its thread belongs to.
        expect(stats.skipped).toEqual({ private: 2, email: 1, missing_parent: 1, other_thread: 1 })
    })

    it("takes in topics, a member's WhatsApp and heartbeat topics included, but no email or private topics", async () => {
        const topic = (id, data) => ({
            [chatPath(id)]: { type: 'topics', title: id, isPublicFor: [0], lastEditionDate: NOW - DAY, ...data },
            [commentPath('topics', id, 'c')]: { commentText: `Inhalt ${id}`, creatorId: 'owner', created: NOW - DAY },
        })
        const db = new KnowledgeFirestoreDouble({
            ...topic('Planung'),
            ...topic('BotChat20261023owner'),
            ...topic('Heartbeat20261023owner'),
            ...topic('BotChatEmail20261023owner'),
            ...topic('WikiGoldCap_project-a_2026-10', { isPublicFor: ['owner'] }),
            ...topic('Privat', { isPublicFor: ['owner'] }),
        })

        const { sources, stats } = await collect(db, threadOptions())

        expect(sources.map(source => source.key).sort()).toEqual([
            'chat:BotChat20261023owner',
            'chat:Heartbeat20261023owner',
            'chat:Planung',
        ])
        expect(sources.find(source => source.key === 'chat:Planung').text).toMatch(
            /^\[\[chat:Planung\]\] Chat topic "Planung" \(1 new comment\)/
        )
        expect(stats.skipped).toEqual({ email: 1, private: 2 })
    })

    it('leaves out email comments and answers an assistant is still writing', async () => {
        const db = threadDb({
            [commentPath('tasks', 't1', 'c3')]: {
                commentText: 'Email from Bank: Kontoauszug',
                gmailData: { messageId: 'm1' },
                creatorId: 'anna',
                fromAssistant: true,
                created: NOW - DAY,
            },
            [commentPath('tasks', 't1', 'c4')]: {
                commentText: 'Ich denke noch',
                isLoading: true,
                creatorId: 'anna',
                fromAssistant: true,
                created: NOW - DAY,
            },
        })

        const { sources } = await collect(db, threadOptions())

        const text = sources.find(source => source.key === 'chat:t1').text
        expect(text).not.toMatch(/Kontoauszug|Ich denke noch/)
        expect(text).toMatch(/2 new comments/)
    })

    it('shows a delta only the comments written since the wiki last looked, and a rebuild the latest ones', async () => {
        const db = threadDb()
        const cursor = { chats: { ms: NOW - 1.5 * DAY, ids: [] } }

        const { sources } = await collect(db, { ...threadOptions(), cursor })
        const rebuilt = await loadByKeys({ db, projectId: PROJECT_ID, keys: ['chat:t1'], ...threadOptions() })

        const delta = sources.find(source => source.key === 'chat:t1').text
        expect(delta).not.toMatch(/3\. November/)
        expect(delta).toMatch(/\(1 new comment\)/)
        expect(rebuilt).toHaveLength(1)
        expect(rebuilt[0].text).toMatch(/\(2 comments\)/)
        expect(rebuilt[0].text).toMatch(/3\. November[\s\S]*Changelog/)
    })

    it('moves past a thread whose chat object changed without a new comment, without a card', async () => {
        const db = threadDb()
        const cursor = { chats: { ms: NOW - 0.5 * DAY, ids: [] } }
        await db.doc(chatPath('t1')).update({ lastEditionDate: NOW - 0.25 * DAY })

        const { sources, nextCursor } = await collect(db, { ...threadOptions(), cursor })

        expect(sources.filter(source => source.type === 'chat')).toEqual([])
        expect(nextCursor.chats).toEqual({ ms: NOW - 0.25 * DAY, ids: ['t1'] })
    })

    it('keeps the newest comments of a thread that does not fit one card, and says so', async () => {
        const comments = {}
        for (let index = 0; index < THREAD_COMMENTS_PER_CARD + 5; index++) {
            comments[commentPath('tasks', 't1', `long${String(index).padStart(2, '0')}`)] = {
                commentText: `Kommentar ${index} ${'x'.repeat(400)}`,
                creatorId: 'owner',
                created: NOW - DAY + index,
            }
        }
        const { sources } = await collect(threadDb(comments), threadOptions())

        const text = sources.find(source => source.key === 'chat:t1').text
        expect(text.split('\n')[0]).toMatch(/older ones left out\)$/)
        expect(text).toMatch(new RegExp(`Kommentar ${THREAD_COMMENTS_PER_CARD + 4} `))
        expect(text).not.toMatch(/Kommentar 0 /)
        expect(text.length).toBeLessThan(6500)
    })

    it('labels a comment an MCP client wrote in a member’s name', async () => {
        const db = threadDb({
            [commentPath('tasks', 't1', 'c5')]: {
                commentText: 'Status gepostet',
                creatorId: 'owner',
                via: 'mcp',
                viaClient: 'Claude',
                created: NOW - DAY + 5,
            },
        })

        const { sources } = await collect(db, threadOptions())

        expect(sources.find(source => source.key === 'chat:t1').text).toMatch(/Karsten \(via Claude\): Status gepostet/)
    })

    it('turns a visible artifact into a card with its text, and never reads a private one', async () => {
        const readArtifactContent = jest.fn(
            async (projectId, artifactId) => `Churn ist auf 2 % gefallen (${artifactId})`
        )
        const db = new KnowledgeFirestoreDouble({
            [artifactPath('a1')]: {
                title: 'Churn-Dashboard',
                description: 'Monatliche Kennzahlen',
                kind: 'web',
                versionCount: 3,
                isPublicFor: PUBLIC,
                lastEditionDate: NOW - DAY,
            },
            [artifactPath('secret')]: {
                title: 'Gehälter',
                kind: 'data',
                isPrivate: true,
                isPublicFor: ['owner'],
                lastEditionDate: NOW - DAY,
            },
        })

        const { sources, stats } = await collect(db, threadOptions({ readArtifactContent }))

        expect(sources.map(source => source.key)).toEqual(['artifact:a1'])
        expect(sources[0].text.split('\n')).toEqual([
            '[[artifact:a1]] "Churn-Dashboard" (web artifact, version 3, last changed 2026-10-23)',
            'Description: Monatliche Kennzahlen',
            'Content:',
            'Churn ist auf 2 % gefallen (a1)',
        ])
        expect(readArtifactContent).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(sources)).not.toMatch(/Gehälter/)
        expect(stats.skipped).toEqual({ private: 1 })
    })

    it('rebuilds from a thread and an artifact only while their objects are still visible', async () => {
        const db = threadDb({
            [artifactPath('a1')]: { title: 'Bericht', kind: 'pdf', isPublicFor: PUBLIC, lastEditionDate: NOW - DAY },
        })
        const keys = ['chat:t1', 'artifact:a1']

        const before = await loadByKeys({ db, projectId: PROJECT_ID, keys, ...threadOptions() })
        await db.doc(taskPath('t1')).update({ isPublicFor: ['owner'] })
        await db.doc(artifactPath('a1')).update({ isPublicFor: ['owner'], isPrivate: true })
        const after = await loadByKeys({ db, projectId: PROJECT_ID, keys, ...threadOptions() })

        expect(before.map(source => source.key).sort()).toEqual(['artifact:a1', 'chat:t1'])
        expect(after).toEqual([])
    })
})
