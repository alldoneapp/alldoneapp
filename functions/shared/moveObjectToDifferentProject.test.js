'use strict'

const {
    filterPrivacyForTarget,
    prepareContactForTarget,
    prepareGoalForTarget,
    prepareSkillForTarget,
} = require('./moveObjectToDifferentProject')

const move = {
    requestId: 'move-1',
    sourceProjectId: 'project-a',
    targetProjectId: 'project-b',
    status: 'moving',
}

describe('generic project move transformations', () => {
    test('limits private visibility to target members and keeps the actor', () => {
        expect(filterPrivacyForTarget(['user-a', 'user-b'], ['user-b', 'actor'], 'actor')).toEqual(['user-b', 'actor'])
        expect(filterPrivacyForTarget([0, 'user-a'], ['actor'], 'actor')).toEqual([0])
    })

    test('normalizes goal roles and retains its task-linking contract', () => {
        const goal = prepareGoalForTarget(
            {
                assigneesIds: ['old-user'],
                assigneesCapacity: { 'old-user': 'CAPACITY_50' },
                assigneesReminderDate: { 'old-user': 123 },
                isPublicFor: [0],
                creatorId: 'old-user',
                parentDoneMilestoneIds: ['old-milestone'],
                progressByDoneMilestone: { old: 50 },
                readerIds: ['old-user'],
            },
            { userIds: ['actor'] },
            'actor',
            move
        )

        expect(goal).toEqual(
            expect.objectContaining({
                assigneesIds: ['ws@default'],
                assigneesCapacity: { 'ws@default': 'CAPACITY_NONE' },
                creatorId: 'actor',
                parentDoneMilestoneIds: [],
                progressByDoneMilestone: {},
                projectMove: move,
            })
        )
        expect(goal.readerIds).toBeUndefined()
    })

    test('clears project-local contact and skill fields', () => {
        expect(prepareContactForTarget({ contactStatusId: 'status', openTasksAmount: 4 }, 'actor', move)).toEqual(
            expect.objectContaining({ contactStatusId: null, openTasksAmount: 0, assistantId: '', projectMove: move })
        )
        expect(
            prepareSkillForTarget(
                { isPublicFor: ['old-user'], readerIds: ['old-user'] },
                { userIds: ['actor'] },
                'actor',
                move
            )
        ).toEqual(expect.objectContaining({ isPublicFor: ['actor'], projectMove: move }))
    })
})
