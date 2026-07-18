const { __private__ } = require('./menubarAccountSummary')

const { countProjectOpenTasks, countVisibleFeedObjects, getActiveProjectIds } = __private__

describe('menubar account summary', () => {
    test('uses active and guide projects while excluding archived and template projects', () => {
        expect(
            getActiveProjectIds({
                projectIds: ['active', 'archived', 'template'],
                guideProjectIds: ['guide', 'active'],
                archivedProjectIds: ['archived'],
                templateProjectIds: ['template'],
            })
        ).toEqual(['active', 'guide'])
    })

    test('counts today reviewer, workstream, and observed tasks like the sidebar', () => {
        const shared = { done: false, parentId: null, dueDate: 900, isPublicFor: [0] }
        const count = countProjectOpenTasks({
            normalTasks: [
                { ...shared, currentReviewerId: 'user-1', userId: 'user-1' },
                { ...shared, currentReviewerId: 'ws@team', userId: 'ws@team' },
                { ...shared, currentReviewerId: 'other', userId: 'other' },
                { ...shared, currentReviewerId: 'user-1', userId: 'user-1', dueDate: 1001 },
            ],
            observedTasks: [
                {
                    ...shared,
                    observersIds: ['user-1'],
                    dueDateByObserversIds: { 'user-1': 800 },
                },
                {
                    ...shared,
                    observersIds: ['user-1'],
                    dueDateByObserversIds: { 'user-1': 1200 },
                },
            ],
            workstreamIds: ['ws@team'],
            userId: 'user-1',
            endOfDay: 1000,
        })

        expect(count).toBe(3)
    })

    test('counts each visible updated feed object once and respects private feeds', () => {
        expect(
            countVisibleFeedObjects(
                {
                    tasks: {
                        task1: { one: { feed: {} }, two: { feed: {} } },
                        hidden: { isPrivate: 'other', three: { feed: {} } },
                    },
                    notes: {
                        note1: { isPrivate: 'user-1', four: { feed: {} } },
                        empty: { metadata: true },
                    },
                },
                'user-1'
            )
        ).toBe(2)
    })
})
