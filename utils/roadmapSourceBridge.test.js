jest.mock('./backends/firestore', () => ({
    getDb: jest.fn(),
    mapGoalData: jest.fn(),
    mapMilestoneData: jest.fn(),
    mapProjectData: jest.fn(),
}))
jest.mock('./backends/OKRs/okrsFirestore', () => ({ mapOKRData: jest.fn() }))
jest.mock('../components/GoalsView/GoalsHelper', () => ({ ALL_USERS: 'ALL_USERS' }))
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
jest.mock('../Themes/Modern/ProjectColors', () => ({
    PROJECT_COLOR_DEFAULT: 'default',
    PROJECT_COLOR_SYSTEM: {
        default: { MARKER: '#2563EB' },
        red: { MARKER: '#DC2626' },
    },
}))

const { getActiveRoadmapProjects, getRoadmapNavigationPath } = require('./roadmapSourceBridge')

describe('roadmap source bridge', () => {
    it('offers only active projects and returns a minimal sorted DTO', () => {
        const projects = [
            { id: 'guide', name: 'Guide', color: 'default', secret: 'not exposed' },
            { id: 'active-b', name: 'Zulu', color: 'red', userIds: ['u1'] },
            { id: 'archived', name: 'Archived', color: 'default' },
            { id: 'active-a', name: 'Alpha', color: 'default' },
        ]
        const user = {
            projectIds: ['guide', 'active-b', 'archived', 'active-a'],
            archivedProjectIds: ['archived'],
            templateProjectIds: [],
            guideProjectIds: ['guide'],
        }

        expect(getActiveRoadmapProjects(projects, user)).toEqual([
            { id: 'active-a', name: 'Alpha', color: '#2563EB' },
            { id: 'active-b', name: 'Zulu', color: '#DC2626' },
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
})
