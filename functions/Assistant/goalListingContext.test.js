const {
    mapAssistantGoalForToolResponse,
    compactGoalListing,
    MAX_DONE_MILESTONES_PER_GOAL,
} = require('./goalListingContext')

const BACKLOG_DATE = Number.MAX_SAFE_INTEGER

function backlogGoal(index, extra = {}) {
    return {
        id: `-OefCuSmRPR9k${String(index).padStart(7, '0')}`,
        name: `Goal number ${index} with a real name`,
        description: '',
        progress: 'DYNAMIC_PERCENT',
        projectId: 'project-1',
        projectName: 'Privat',
        ownerId: 'ALL_USERS',
        assigneesIds: ['user-1'],
        commentsData: null,
        status: 'active',
        startingMilestoneDate: BACKLOG_DATE,
        completionMilestoneDate: BACKLOG_DATE,
        isBacklog: true,
        matchedMilestone: null,
        doneMilestones: [],
        latestDoneMilestoneDate: null,
        ...extra,
    }
}

describe('goal listing context', () => {
    test('leaves out empty fields and the backlog placeholder dates', () => {
        expect(mapAssistantGoalForToolResponse(backlogGoal(1))).toEqual({
            id: '-OefCuSmRPR9k0000001',
            name: 'Goal number 1 with a real name',
            progress: 'DYNAMIC_PERCENT',
            projectId: 'project-1',
            projectName: 'Privat',
            assigneesIds: ['user-1'],
            status: 'active',
            isBacklog: true,
        })
    })

    test('keeps a real owner and the newest done milestones of a recurring goal', () => {
        const doneMilestones = Array.from({ length: 40 }, (_, index) => ({
            milestoneId: `m-${index}`,
            date: 1794000000000 - index * 86400000,
            extendedName: '',
            progress: 100,
        }))
        const mapped = mapAssistantGoalForToolResponse(
            backlogGoal(2, {
                ownerId: 'user-1',
                status: 'both',
                doneMilestones,
                latestDoneMilestoneDate: doneMilestones[0].date,
                commentsData: { amount: 3, lastComment: 'x'.repeat(500), lastCommentOwnerId: 'user-1' },
            })
        )
        expect(mapped.ownerId).toBe('user-1')
        expect(mapped.doneMilestones).toHaveLength(MAX_DONE_MILESTONES_PER_GOAL)
        expect(mapped.doneMilestones[0]).toEqual({ milestoneId: 'm-0', date: doneMilestones[0].date, progress: 100 })
        expect(mapped.doneMilestoneCount).toBe(40)
        expect(mapped.olderDoneMilestonesOmitted).toBe(40 - MAX_DONE_MILESTONES_PER_GOAL)
        expect(mapped.latestDoneMilestoneDate).toBe(doneMilestones[0].date)
        expect(mapped.commentsData.amount).toBe(3)
        expect(mapped.commentsData.lastComment.length).toBeLessThanOrEqual(301)
        expect(mapped.commentsData.lastCommentOwnerId).toBeUndefined()
    })

    test('an oversized listing keeps every goal identity instead of the first twenty', () => {
        // The 2026-11-11 incident: 331 goals, status "all".
        const goals = Array.from({ length: 331 }, (_, index) =>
            mapAssistantGoalForToolResponse(backlogGoal(index, { description: 'd'.repeat(400) }))
        )
        const compact = compactGoalListing({ goals, count: 331, appliedFilters: { status: 'all' } }, 40000)
        expect(JSON.stringify(compact).length).toBeLessThanOrEqual(40000)
        expect(compact.shownCount).toBe(331)
        expect(compact.listingComplete).toBe(true)
        expect(compact.projects).toHaveLength(1)
        expect(compact.projects[0].projectName).toBe('Privat')
        expect(compact.projects[0].goals).toHaveLength(331)
        expect(compact.projects[0].goals[330]).toEqual({
            id: '-OefCuSmRPR9k0000330',
            name: 'Goal number 330 with a real name',
            progress: 'DYNAMIC_PERCENT',
        })
    })

    test('says the listing is partial when even identities do not fit', () => {
        const goals = Array.from({ length: 300 }, (_, index) =>
            backlogGoal(index, { name: 'n'.repeat(200), projectId: `project-${index % 7}`, status: 'done' })
        )
        const compact = compactGoalListing({ goals, count: 300 }, 10000)
        expect(JSON.stringify(compact).length).toBeLessThanOrEqual(10000)
        expect(compact.shownCount).toBeLessThan(300)
        expect(compact.count).toBe(300)
        expect(compact.listingComplete).toBe(false)
        expect(compact.countGuidance).toContain('partial')
        const listed = compact.projects.reduce((sum, project) => sum + project.goals.length, 0)
        expect(listed).toBe(compact.shownCount)
        expect(compact.projects.every(project => project.goals.length > 0)).toBe(true)
        expect(compact.projects[0].goals[0].status).toBe('done')
    })
})
