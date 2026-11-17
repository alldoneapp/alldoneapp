jest.mock('./backends/firestore', () => ({
    getDb: jest.fn(),
    mapGoalData: jest.fn(),
    mapMilestoneData: jest.fn(),
    mapProjectData: jest.fn(),
}))
jest.mock('./backends/OKRs/okrsFirestore', () => ({ mapOKRData: jest.fn() }))
jest.mock('../components/TaskListView/OKRs/okrHelper', () => ({
    calculateOkrPace: () => ({ status: 'onTrack' }),
    calculateRevenueOkrCurrentValue: jest.fn(),
    canUserSeeOkr: () => true,
    isRevenueOkr: () => false,
    normalizeOkrNumber: value => {
        const number = Number(value)
        return Number.isFinite(number) ? number : 0
    },
}))
const { getActiveRoadmapProjects, getRoadmapNavigationPath, normalizeRoadmapGoal } = require('./roadmapSourceBridge')

describe('roadmap source bridge', () => {
    it('offers only active projects and returns a minimal sorted DTO', () => {
        const projects = [
            { id: 'guide', name: 'Guide', color: '#47A3FF', secret: 'not exposed' },
            { id: 'active-b', name: 'Zulu', color: '#FF5274', userIds: ['u1'] },
            { id: 'archived', name: 'Archived', color: '#47A3FF' },
            { id: 'active-a', name: 'Alpha', color: 'not-a-project-color' },
        ]
        const user = {
            projectIds: ['guide', 'active-b', 'archived', 'active-a'],
            archivedProjectIds: ['archived'],
            templateProjectIds: [],
            guideProjectIds: ['guide'],
        }

        expect(getActiveRoadmapProjects(projects, user)).toEqual([
            { id: 'active-a', name: 'Alpha', color: '#47A3FF' },
            { id: 'active-b', name: 'Zulu', color: '#FF5274' },
        ])
    })

    it('routes exact goals and sends aggregate entities to their owning project views', () => {
        expect(getRoadmapNavigationPath({ projectId: 'p1', userId: 'u1', entityType: 'goal', entityId: 'g1' })).toBe(
            '/projects/p1/goals/g1'
        )
        expect(getRoadmapNavigationPath({ projectId: 'p1', userId: 'u1', entityType: 'okr' })).toBe('/project/p1/okrs')
        expect(getRoadmapNavigationPath({ projectId: 'p1', userId: 'u1', entityType: 'milestone' })).toBe(
            '/projects/p1/user/u1/goals/open'
        )
        expect(getRoadmapNavigationPath({ projectId: 'p1', userId: 'u1', entityType: 'task' })).toBeNull()
    })

    it('preserves live dynamic progress and exposes the goal comment summary', () => {
        expect(
            normalizeRoadmapGoal({
                id: 'g1',
                name: 'Live goal',
                progress: 'DYNAMIC_PERCENT',
                dynamicProgress: 73,
                commentsData: {
                    lastComment: '  Waiting for final approval  ',
                    lastCommentType: 'comment',
                    amount: 3,
                },
            })
        ).toMatchObject({
            id: 'g1',
            progress: -1,
            dynamicProgress: 73,
            commentsData: {
                lastComment: 'Waiting for final approval',
                lastCommentType: 'comment',
                amount: 3,
            },
        })
    })
})
