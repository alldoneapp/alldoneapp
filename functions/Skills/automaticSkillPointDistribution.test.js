jest.mock('firebase-admin', () => ({
    firestore: Object.assign(
        jest.fn(() => ({
            doc: jest.fn(),
            collection: jest.fn(),
        })),
        {
            FieldValue: {
                increment: jest.fn(value => ({ __increment: value })),
                arrayUnion: jest.fn((...values) => ({ __arrayUnion: values })),
            },
            Timestamp: {
                now: jest.fn(() => ({ seconds: 1, nanoseconds: 0 })),
            },
        }
    ),
}))

jest.mock('../Assistant/assistantHelper', () => ({
    interactWithChatStream: jest.fn(),
    reduceGoldWhenChatWithAI: jest.fn(),
    normalizeModelKey: jest.fn(model => model || 'MODEL_GPT5_5'),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 0,
    STAYWARD_COMMENT: 2,
}))

jest.mock('../Feeds/globalFeedsHelper', () => ({
    generateCurrentDateObject: jest.fn(() => ({
        currentDateFormated: '20260521',
        currentMilliseconds: 1,
    })),
    generateFeedModel: jest.fn(() => ({ feed: {}, feedId: 'feed-id' })),
    loadFeedObject: jest.fn(() => null),
    proccessFeed: jest.fn(),
}))

const {
    __private__: {
        allocateEvenly,
        validateAllocations,
        isEligibleTask,
        getActiveProjectIds,
        getDistributionProjectIds,
        collectStreamText,
        parseJsonResponse,
        writeSkillComment,
    },
} = require('./automaticSkillPointDistribution')

describe('automatic skill point distribution helpers', () => {
    test('splits points evenly by lowest current points, oldest created, then stable id', () => {
        const skills = [
            { projectId: 'p1', id: 'b', points: 3, created: 1 },
            { projectId: 'p1', id: 'a', points: 0, created: 2 },
            { projectId: 'p2', id: 'c', points: 0, created: 1 },
        ]

        expect(allocateEvenly(skills, 5)).toEqual([
            expect.objectContaining({ projectId: 'p2', skillId: 'c', points: 2 }),
            expect.objectContaining({ projectId: 'p1', skillId: 'a', points: 2 }),
            expect.objectContaining({ projectId: 'p1', skillId: 'b', points: 1 }),
        ])
    })

    test('validates, normalizes, and coalesces assistant allocations', () => {
        const skills = [{ projectId: 'p1', id: 's1' }]
        const tasks = [{ id: 't1' }, { id: 't2' }]

        expect(
            validateAllocations(
                [
                    { projectId: 'p1', skillId: 's1', points: 2, rationale: 'Good fit', evidenceTaskIds: ['t1'] },
                    {
                        projectId: 'p1',
                        skillId: 's1',
                        points: 3,
                        rationale: 'Duplicate',
                        evidenceTaskIds: ['t2', 'bad'],
                    },
                ],
                skills,
                tasks,
                5
            )
        ).toEqual([
            {
                projectId: 'p1',
                skillId: 's1',
                points: 5,
                rationale: 'Good fit',
                evidenceTaskIds: ['t1', 't2'],
            },
        ])
    })

    test('rejects invalid totals and unknown skills', () => {
        const skills = [{ projectId: 'p1', id: 's1' }]

        expect(() => validateAllocations([{ projectId: 'p1', skillId: 's1', points: 4 }], skills, [], 5)).toThrow(
            'Invalid allocation total'
        )
        expect(() => validateAllocations([{ projectId: 'p1', skillId: 'missing', points: 5 }], skills, [], 5)).toThrow(
            'Invalid skill allocation'
        )
    })

    test('filters eligible owned top-level completed tasks', () => {
        expect(
            isEligibleTask(
                { done: true, userId: 'u1', isSubtask: false, parentId: null, completed: 200 },
                'u1',
                100,
                300
            )
        ).toBe(true)
        expect(isEligibleTask({ done: true, userId: 'u2', completed: 200 }, 'u1', 100, 300)).toBe(false)
        expect(isEligibleTask({ done: true, userId: 'u1', parentId: 'parent', completed: 200 }, 'u1', 100, 300)).toBe(
            false
        )
        expect(
            isEligibleTask(
                { done: true, userId: 'u1', completed: 200, genericData: { type: 'dayRateTimeLog' } },
                'u1',
                100,
                300
            )
        ).toBe(false)
        expect(
            isEligibleTask(
                { done: true, userId: 'u1', completed: 200, genericData: { genericType: 'mention' } },
                'u1',
                100,
                300
            )
        ).toBe(false)
    })

    test('treats missing auto-distribution field as enabled active-project behavior', () => {
        expect(
            getActiveProjectIds({
                projectIds: ['p1', 'p2', 'p3'],
                archivedProjectIds: ['p2'],
                templateProjectIds: ['p3'],
            })
        ).toEqual(['p1'])
    })

    test('excludes inactive and template project docs but keeps active guides', () => {
        expect(
            getDistributionProjectIds(['active', 'inactive', 'template', 'guide'], {
                active: { active: true },
                inactive: { active: false },
                template: { active: true, isTemplate: true },
                guide: { active: true, parentTemplateId: 'template' },
            })
        ).toEqual(['active', 'guide'])
    })

    test('parses strict json with optional markdown fence', () => {
        expect(parseJsonResponse('```json\n{"allocations":[]}\n```')).toEqual({ allocations: [] })
    })

    test('collects assistant stream text from OpenAI-style chunks', async () => {
        await expect(
            collectStreamText([
                { choices: [{ delta: { content: '{"allocations":' } }] },
                { choices: [{ delta: { content: '[]}' } }] },
            ])
        ).resolves.toBe('{"allocations":[]}')
    })

    test('updates the nested chat preview fields when writing an automatic distribution comment', async () => {
        const batch = {
            set: jest.fn(),
            update: jest.fn(),
        }
        const commentText = 'Auto-distributed +1 skill point. Recent work supports this skill.'

        await writeSkillComment(batch, {
            project: { userIds: [], name: 'Project' },
            skill: {
                id: 'skill-1',
                projectId: 'project-1',
                userId: 'user-1',
                name: 'Planning',
                isPublicFor: [0],
            },
            assistant: { uid: 'assistant-1', displayName: 'Assistant' },
            allocation: { points: 1, evidenceTaskIds: [] },
            commentId: 'comment-1',
            commentText,
            followers: [],
        })

        expect(batch.update).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({
                'commentsData.lastCommentOwnerId': 'assistant-1',
                'commentsData.lastComment': commentText,
                'commentsData.lastCommentType': 2,
            })
        )
        expect(batch.set).not.toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({ 'commentsData.lastComment': commentText }),
            { merge: true }
        )
    })
})
