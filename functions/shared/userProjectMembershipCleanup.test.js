'use strict'

const { collectListedProjectIds, planUnbackedProjectIdRemovals } = require('./userProjectMembershipCleanup')

describe('planUnbackedProjectIdRemovals', () => {
    const projects = new Map([
        ['own', ['u1', 'u2']],
        ['foreign', ['victim']],
        // 'gone' has no project document
    ])

    test('keeps projects whose userIds list the user', () => {
        const userData = { projectIds: ['own'], archivedProjectIds: ['own'] }
        expect(planUnbackedProjectIdRemovals('u1', userData, projects)).toEqual({ removals: [], update: {} })
    })

    test('removes a project whose userIds omit the user, from every list', () => {
        const userData = {
            projectIds: ['own', 'foreign'],
            guideProjectIds: ['foreign'],
            copyProjectIds: ['foreign', 'own'],
        }
        expect(planUnbackedProjectIdRemovals('u1', userData, projects)).toEqual({
            removals: [
                { list: 'projectIds', projectId: 'foreign' },
                { list: 'guideProjectIds', projectId: 'foreign' },
                { list: 'copyProjectIds', projectId: 'foreign' },
            ],
            update: { projectIds: ['own'], guideProjectIds: [], copyProjectIds: ['own'] },
        })
    })

    test('treats a missing project document as unbacked', () => {
        const userData = { projectIds: ['own', 'gone'], templateProjectIds: ['gone'] }
        expect(planUnbackedProjectIdRemovals('u1', userData, projects)).toEqual({
            removals: [
                { list: 'projectIds', projectId: 'gone' },
                { list: 'templateProjectIds', projectId: 'gone' },
            ],
            update: { projectIds: ['own'], templateProjectIds: [] },
        })
    })

    test('leaves a user without membership lists, or with only backed ids, untouched', () => {
        expect(planUnbackedProjectIdRemovals('u1', {}, projects)).toEqual({ removals: [], update: {} })
        expect(planUnbackedProjectIdRemovals('u2', { projectIds: ['own'], displayName: 'x' }, projects)).toEqual({
            removals: [],
            update: {},
        })
    })

    test('collects every listed id once', () => {
        expect(
            collectListedProjectIds({ projectIds: ['a', 'b'], archivedProjectIds: ['b'], copyProjectIds: ['c'] })
        ).toEqual(['a', 'b', 'c'])
    })
})
