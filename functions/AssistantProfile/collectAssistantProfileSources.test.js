const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const {
    MAX_LOOKBACK_MS,
    collectAssistantProfileSources,
    formatAssistantProfileSources,
    resolveSince,
} = require('./collectAssistantProfileSources')

const USER = 'karsten'
const OTHER = 'colleague'
const NOW = Date.UTC(2026, 10, 18, 3, 0)
const HOUR = 60 * 60 * 1000
const SINCE = NOW - 24 * HOUR
const PROJECT = { id: 'p1', name: 'Alldone Product', projectType: 'regular' }

function createDb(documents = {}) {
    return new KnowledgeFirestoreDouble({
        [`projects/${PROJECT.id}`]: { userIds: [USER, OTHER], name: PROJECT.name },
        ...documents,
    })
}

function collect(db, overrides = {}) {
    return collectAssistantProfileSources({
        db,
        userId: USER,
        cursorAt: SINCE,
        now: NOW,
        listProjects: async () => [PROJECT],
        readNoteContent: async (projectId, noteId) => `Text of ${noteId}`,
        ...overrides,
    })
}

const linesOf = (result, key) => result.sections.find(section => section.key === key)?.lines || []

describe('collectAssistantProfileSources', () => {
    it('reads what the user did and nothing that only somebody else may see', async () => {
        const db = createDb({
            'items/p1/tasks/t1': {
                name: 'Ship the profile',
                done: true,
                userId: USER,
                completed: NOW - HOUR,
                isPublicFor: [0],
            },
            // Somebody else's task, even a public one, says nothing about the user.
            'items/p1/tasks/t2': {
                name: 'Colleague task',
                done: true,
                userId: OTHER,
                completed: NOW - HOUR,
                isPublicFor: [0],
            },
            // The user's own private task counts: the profile is private too.
            'items/p1/tasks/t3': {
                name: 'Private errand',
                done: true,
                userId: USER,
                completed: NOW - 2 * HOUR,
                isPublicFor: [USER],
            },
            // Done before the window.
            'items/p1/tasks/t4': {
                name: 'Old task',
                done: true,
                userId: USER,
                completed: SINCE - HOUR,
                isPublicFor: [0],
            },
            'noteItems/p1/notes/n1': {
                title: 'Meeting notes',
                lastEditorId: USER,
                lastEditionDate: NOW - HOUR,
                isPublicFor: [0],
            },
            'noteItems/p1/notes/n2': {
                title: 'Their note',
                lastEditorId: OTHER,
                lastEditionDate: NOW - HOUR,
                isPublicFor: [0],
            },
            // Another member's private note the user once edited is not theirs to read any more.
            'noteItems/p1/notes/n3': {
                title: 'Private to colleague',
                lastEditorId: USER,
                lastEditionDate: NOW - HOUR,
                isPublicFor: [OTHER],
            },
            'projectsContacts/p1/contacts/c1': {
                displayName: 'Ada Lovelace',
                company: 'Analytical',
                lastEditorId: USER,
                lastEditionDate: NOW - HOUR,
                isPublicFor: [0],
            },
        })

        const result = await collect(db)

        expect(linesOf(result, 'tasks').join('\n')).toContain('Ship the profile')
        expect(linesOf(result, 'tasks').join('\n')).toContain('Private errand')
        expect(linesOf(result, 'tasks').join('\n')).not.toContain('Colleague task')
        expect(linesOf(result, 'tasks').join('\n')).not.toContain('Old task')
        expect(linesOf(result, 'notes').join('\n')).toContain('Meeting notes')
        expect(linesOf(result, 'notes').join('\n')).toContain('Text of n1')
        expect(linesOf(result, 'notes').join('\n')).not.toContain('Their note')
        expect(linesOf(result, 'notes').join('\n')).not.toContain('Private to colleague')
        expect(linesOf(result, 'contacts').join('\n')).toContain('Ada Lovelace (Analytical)')
        expect(result.counts).toMatchObject({ tasks: 2, notes: 1, contacts: 1 })
        expect(result.activityCount).toBe(4)
    })

    it('keeps a conversation only when the user wrote in it during the window', async () => {
        const db = createDb({
            'chatObjects/p1/chats/topic1': {
                type: 'topics',
                title: 'Pricing',
                lastEditionDate: NOW - HOUR,
                isPublicFor: [0],
            },
            'chatComments/p1/topics/topic1/comments/a': {
                creatorId: USER,
                commentText: 'What should we charge?',
                created: NOW - 2 * HOUR,
            },
            'chatComments/p1/topics/topic1/comments/b': {
                creatorId: 'assistant-1',
                fromAssistant: true,
                commentText: 'About 10 euros.',
                created: NOW - HOUR,
            },
            'chatComments/p1/topics/topic1/comments/c': {
                creatorId: 'assistant-1',
                fromAssistant: true,
                commentText: 'still thinking',
                created: NOW - HOUR + 1,
                isThinking: true,
            },
            // Only other people talked here.
            'chatObjects/p1/chats/topic2': {
                type: 'topics',
                title: 'Team chatter',
                lastEditionDate: NOW - HOUR,
                isPublicFor: [0],
            },
            'chatComments/p1/topics/topic2/comments/a': {
                creatorId: OTHER,
                commentText: 'Lunch?',
                created: NOW - HOUR,
            },
            // A thread the user cannot read.
            'chatObjects/p1/chats/topic3': {
                type: 'topics',
                title: 'Private to colleague',
                lastEditionDate: NOW - HOUR,
                isPublicFor: [OTHER],
            },
            'chatComments/p1/topics/topic3/comments/a': { creatorId: USER, commentText: 'secret', created: NOW - HOUR },
        })

        const chats = linesOf(await collect(db), 'chats').join('\n')

        expect(chats).toContain('### Pricing')
        expect(chats).toContain('- User: What should we charge?')
        expect(chats).toContain('- Assistant: About 10 euros.')
        expect(chats).not.toContain('still thinking')
        expect(chats).not.toContain('Team chatter')
        expect(chats).not.toContain('secret')
    })

    it('reads assistant memory changed in the window, only for projects the user is still in', async () => {
        const db = createDb({
            'assistantMemories/karsten__p1': {
                userId: USER,
                projectId: 'p1',
                content: '2026-11-17: likes short answers',
                updatedAt: NOW - HOUR,
            },
            'assistantMemories/karsten__left': {
                userId: USER,
                projectId: 'left',
                content: 'from a project I left',
                updatedAt: NOW - HOUR,
            },
            'projects/left': { userIds: [OTHER] },
            'assistantMemories/karsten__old': {
                userId: USER,
                projectId: 'p1-old',
                content: 'unchanged',
                updatedAt: SINCE - HOUR,
            },
            'projects/p1-old': { userIds: [USER] },
            'assistantMemories/colleague__p1': {
                userId: OTHER,
                projectId: 'p1',
                content: 'not mine',
                updatedAt: NOW - HOUR,
            },
        })

        const memory = linesOf(await collect(db), 'memory').join('\n')
        expect(memory).toContain('likes short answers')
        expect(memory).not.toContain('from a project I left')
        expect(memory).not.toContain('unchanged')
        expect(memory).not.toContain('not mine')

        // The first version reads all of it, not just what changed.
        const all = linesOf(await collect(db, { includeAllMemory: true }), 'memory').join('\n')
        expect(all).toContain('unchanged')
    })

    it('adds open goals as context only when there is activity, and never counts them as activity', async () => {
        const goal = {
            name: 'Launch v2',
            assigneesIds: [USER],
            progress: 40,
            completionMilestoneDate: NOW + 30 * 24 * HOUR,
            isPublicFor: [0],
        }
        const quiet = await collect(createDb({ 'goals/p1/items/g1': goal }))
        expect(quiet.activityCount).toBe(0)
        expect(quiet.sections).toEqual([])

        const busy = await collect(
            createDb({
                'goals/p1/items/g1': goal,
                'goals/p1/items/g2': { ...goal, name: 'Done goal', progress: 100 },
                'items/p1/tasks/t1': {
                    name: 'Task',
                    done: true,
                    userId: USER,
                    completed: NOW - HOUR,
                    isPublicFor: [0],
                },
            })
        )
        expect(busy.activityCount).toBe(1)
        expect(linesOf(busy, 'goals').join('\n')).toContain('Launch v2 [Alldone Product] (40%')
        expect(linesOf(busy, 'goals').join('\n')).not.toContain('Done goal')
    })

    it('skips the sources the user switched off', async () => {
        const db = createDb({
            'items/p1/tasks/t1': { name: 'Task', done: true, userId: USER, completed: NOW - HOUR, isPublicFor: [0] },
            'noteItems/p1/notes/n1': {
                title: 'Note',
                lastEditorId: USER,
                lastEditionDate: NOW - HOUR,
                isPublicFor: [0],
            },
        })
        const result = await collect(db, { sources: { notes: false } })
        expect(result.counts.notes).toBe(0)
        expect(result.counts.tasks).toBe(1)
    })

    it('never looks back further than a week', () => {
        expect(resolveSince({ cursorAt: null, now: NOW })).toBe(NOW - MAX_LOOKBACK_MS)
        expect(resolveSince({ cursorAt: NOW - 30 * 24 * HOUR, now: NOW })).toBe(NOW - MAX_LOOKBACK_MS)
        expect(resolveSince({ cursorAt: SINCE, now: NOW })).toBe(SINCE)
    })

    it('formats sections as markdown headings', () => {
        expect(formatAssistantProfileSources([{ title: 'Tasks', lines: ['- a', '- b'] }])).toBe('## Tasks\n- a\n- b')
    })
})
