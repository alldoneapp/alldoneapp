'use strict'

const {
    buildMeetingKey,
    normalizeAttendeeEmails,
    scoreProjectsByAttendeeOverlap,
    findUniqueProjectByTitle,
    resolveMenubarNoteProject,
    MEETING_MAPPINGS_COLLECTION,
} = require('./menubarNoteProjectResolver')

function createFakeDb(docs = {}, collections = {}) {
    return {
        collection(path) {
            const collectionApi = {
                doc(id) {
                    const fullPath = `${path}/${id}`
                    return {
                        __path: fullPath,
                        get: async () => ({
                            exists: fullPath in docs,
                            id,
                            data: () => docs[fullPath],
                        }),
                        set: async () => {},
                    }
                },
                limit() {
                    return collectionApi
                },
                get: async () => ({
                    docs: (collections[path] || []).map(item => ({ id: item.id, data: () => item })),
                }),
            }
            return collectionApi
        },
        getAll: async (...refs) =>
            refs.map(ref => ({
                exists: ref.__path in docs,
                id: ref.__path.split('/').pop(),
                data: () => docs[ref.__path],
            })),
    }
}

describe('buildMeetingKey', () => {
    it('prefers the recurring key over the title', () => {
        const byRecurring = buildMeetingKey({ recurringKey: 'series-123', title: 'Weekly sync' })
        const byRecurringOtherTitle = buildMeetingKey({ recurringKey: 'series-123', title: 'Other title' })
        const byTitle = buildMeetingKey({ title: 'Weekly sync' })
        expect(byRecurring).toBe(byRecurringOtherTitle)
        expect(byRecurring).not.toBe(byTitle)
    })

    it('normalizes the title so cosmetic changes map to the same key', () => {
        expect(buildMeetingKey({ title: 'Weekly Sync — Acme!' })).toBe(buildMeetingKey({ title: 'weekly sync acme' }))
    })

    it('returns null without recurring key or title', () => {
        expect(buildMeetingKey({})).toBeNull()
        expect(buildMeetingKey({ title: '   ' })).toBeNull()
    })
})

describe('normalizeAttendeeEmails', () => {
    it('normalizes, dedupes and excludes the requester email', () => {
        const result = normalizeAttendeeEmails(
            ['Bob@Acme.com ', 'bob@acme.com', 'me@self.com', 'not-an-email-but-kept@x.co', ''],
            ['ME@self.com']
        )
        expect(result).toEqual(['bob@acme.com', 'not-an-email-but-kept@x.co'])
    })

    it('returns empty array for non-array input', () => {
        expect(normalizeAttendeeEmails(undefined)).toEqual([])
        expect(normalizeAttendeeEmails('bob@acme.com')).toEqual([])
    })
})

describe('scoreProjectsByAttendeeOverlap', () => {
    const sets = [
        { projectId: 'p1', emails: new Set(['bob@acme.com', 'carol@acme.com']) },
        { projectId: 'p2', emails: new Set(['dave@other.com']) },
    ]

    it('picks the project with strictly highest overlap', () => {
        const result = scoreProjectsByAttendeeOverlap(sets, ['bob@acme.com', 'carol@acme.com', 'dave@other.com'])
        expect(result.projectId).toBe('p1')
        expect(result.score).toBe(2)
        expect(result.runnerUpScore).toBe(1)
    })

    it('returns no project on a tie', () => {
        const result = scoreProjectsByAttendeeOverlap(sets, ['bob@acme.com', 'dave@other.com'])
        expect(result.projectId).toBeNull()
    })

    it('returns no project without any overlap', () => {
        const result = scoreProjectsByAttendeeOverlap(sets, ['stranger@nowhere.com'])
        expect(result.projectId).toBeNull()
        expect(result.score).toBe(0)
    })
})

describe('findUniqueProjectByTitle', () => {
    const projects = [
        { id: 'p1', name: 'Acme Corp' },
        { id: 'p2', name: 'Internal Tools' },
        { id: 'p3', name: 'Acme Mobile' },
    ]

    it('matches a unique full project name inside the meeting title', () => {
        const match = findUniqueProjectByTitle(projects, 'Weekly sync with Internal Tools team')
        expect(match?.id).toBe('p2')
    })

    it('returns null when multiple project names match', () => {
        // "acme corp" and "acme mobile" both token-match "acme"
        expect(findUniqueProjectByTitle(projects, 'Acme planning')).toBeNull()
    })

    it('matches a unique distinctive token', () => {
        const match = findUniqueProjectByTitle(projects, 'Mobile roadmap discussion')
        expect(match?.id).toBe('p3')
    })

    it('returns null for empty titles', () => {
        expect(findUniqueProjectByTitle(projects, '')).toBeNull()
        expect(findUniqueProjectByTitle(projects, undefined)).toBeNull()
    })
})

describe('resolveMenubarNoteProject', () => {
    const userId = 'u1'
    const baseDocs = {
        'users/u1': {
            email: 'me@self.com',
            projectIds: ['p1', 'p2'],
            defaultProjectId: 'p2',
        },
        'projects/p1': { name: 'Acme Corp', userIds: ['u1', 'm1'], active: true },
        'projects/p2': { name: 'Internal Tools', userIds: ['u1'], active: true },
        'users/m1': { email: 'bob@acme.com' },
    }

    it('uses an explicit projectId when the user is a member', async () => {
        const db = createFakeDb(baseDocs)
        const result = await resolveMenubarNoteProject(db, {
            userId,
            userData: baseDocs['users/u1'],
            requestedProjectId: 'p1',
        })
        expect(result.projectId).toBe('p1')
        expect(result.source).toBe('explicitProjectId')
    })

    it('rejects an explicit projectId when the user is not a member', async () => {
        const db = createFakeDb({ ...baseDocs, 'projects/p9': { name: 'Foreign', userIds: ['someoneElse'] } })
        await expect(
            resolveMenubarNoteProject(db, {
                userId,
                userData: baseDocs['users/u1'],
                requestedProjectId: 'p9',
            })
        ).rejects.toMatchObject({ code: 'PROJECT_NOT_ACCESSIBLE' })
    })

    it('resolves by project name match', async () => {
        const db = createFakeDb(baseDocs)
        const result = await resolveMenubarNoteProject(db, {
            userId,
            userData: baseDocs['users/u1'],
            requestedProjectName: 'acme corp',
        })
        expect(result.projectId).toBe('p1')
        expect(result.source).toBe('projectName_exact')
    })

    it('uses the learned meeting mapping when present and still accessible', async () => {
        const meetingKey = buildMeetingKey({ recurringKey: 'series-42' })
        const db = createFakeDb({
            ...baseDocs,
            [`${MEETING_MAPPINGS_COLLECTION}/${userId}__${meetingKey}`]: { projectId: 'p1' },
        })
        const result = await resolveMenubarNoteProject(db, {
            userId,
            userData: baseDocs['users/u1'],
            meetingRecurringKey: 'series-42',
            meetingTitle: 'Some meeting',
        })
        expect(result.projectId).toBe('p1')
        expect(result.source).toBe('learnedMeetingMapping')
    })

    it('resolves by attendee email overlap with project members', async () => {
        const db = createFakeDb(baseDocs)
        const result = await resolveMenubarNoteProject(db, {
            userId,
            userData: baseDocs['users/u1'],
            meetingTitle: 'Untitled catchup',
            attendeeEmails: ['bob@acme.com', 'me@self.com'],
        })
        expect(result.projectId).toBe('p1')
        expect(result.source).toBe('attendeeEmailMatch')
    })

    it('resolves by attendee email overlap with project contacts', async () => {
        const db = createFakeDb(baseDocs, {
            'projectsContacts/p2/contacts': [{ id: 'c1', email: 'carol@client.com' }],
        })
        const result = await resolveMenubarNoteProject(db, {
            userId,
            userData: baseDocs['users/u1'],
            meetingTitle: 'Untitled catchup',
            attendeeEmails: ['carol@client.com'],
        })
        expect(result.projectId).toBe('p2')
        expect(result.source).toBe('attendeeEmailMatch')
    })

    it('resolves by meeting title when no other signal matches', async () => {
        const db = createFakeDb(baseDocs)
        const result = await resolveMenubarNoteProject(db, {
            userId,
            userData: baseDocs['users/u1'],
            meetingTitle: 'Internal Tools retro',
        })
        expect(result.projectId).toBe('p2')
        expect(result.source).toBe('meetingTitleMatch')
    })

    it('falls back to the default project', async () => {
        const db = createFakeDb(baseDocs)
        const result = await resolveMenubarNoteProject(db, {
            userId,
            userData: baseDocs['users/u1'],
            meetingTitle: 'Completely unrelated topic xyzzy',
        })
        expect(result.projectId).toBe('p2')
        expect(result.source).toBe('defaultProject')
    })

    it('throws when nothing can be resolved', async () => {
        const docs = {
            'users/u1': { email: 'me@self.com', projectIds: [] },
        }
        const db = createFakeDb(docs)
        await expect(
            resolveMenubarNoteProject(db, {
                userId,
                userData: docs['users/u1'],
                meetingTitle: 'Anything',
            })
        ).rejects.toMatchObject({ code: 'NO_PROJECT_RESOLVED' })
    })
})
