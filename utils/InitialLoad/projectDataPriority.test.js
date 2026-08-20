import { orderProjectsForDataWarmUp, PRIORITY_PROJECT_LIMIT, resolvePriorityProjectIds } from './projectDataPriority'

// AT-2386. The interesting case is the DEFAULT one: the app boots into "All projects", so there is
// no selected project to prefer and the ordering has to invent a sensible "current" anyway.

describe('resolvePriorityProjectIds', () => {
    const projectIds = ['p-alpha', 'p-beta', 'p-gamma', 'p-delta']

    it('prefers the project the URL is about to route to', () => {
        const priority = resolvePriorityProjectIds({
            urlProjectId: 'p-gamma',
            loggedUser: { inFocusTaskProjectId: 'p-beta', defaultProjectId: 'p-alpha' },
            projectIds,
        })

        expect(priority[0]).toBe('p-gamma')
    })

    it('falls back to the in-focus project, then the default project, when no URL project applies', () => {
        expect(
            resolvePriorityProjectIds({
                loggedUser: { inFocusTaskProjectId: 'p-beta', defaultProjectId: 'p-alpha' },
                projectIds,
            })
            // `p-alpha` is both the default project and `projectIds[0]`, so it appears once.
        ).toEqual(['p-beta', 'p-alpha'])

        expect(
            resolvePriorityProjectIds({
                loggedUser: { defaultProjectId: 'p-delta' },
                projectIds,
            })
        ).toEqual(['p-delta', 'p-alpha'])
    })

    it('still names a project when the user booted into All projects with nothing pinned', () => {
        // The whole point: `selectedProjectIndex` defaults to ALL_PROJECTS_INDEX, so without this
        // fallback the priority set would be empty and NOTHING would be loaded before URL routing.
        expect(resolvePriorityProjectIds({ loggedUser: {}, projectIds })).toEqual(['p-alpha'])
    })

    it('ignores ids the user cannot see, so a stale or foreign URL cannot pin a load', () => {
        expect(
            resolvePriorityProjectIds({
                urlProjectId: 'p-not-mine',
                loggedUser: { defaultProjectId: 'p-also-not-mine' },
                projectIds,
            })
        ).toEqual(['p-alpha'])
    })

    it('never returns duplicates when the same project wins several ways', () => {
        expect(
            resolvePriorityProjectIds({
                urlProjectId: 'p-beta',
                loggedUser: { inFocusTaskProjectId: 'p-beta', defaultProjectId: 'p-beta' },
                projectIds,
            })
        ).toEqual(['p-beta', 'p-alpha'])
    })

    it('is capped, so login can never wait on an unbounded number of projects', () => {
        const many = Array.from({ length: 50 }, (unused, index) => `p-${index}`)
        const priority = resolvePriorityProjectIds({
            urlProjectId: 'p-30',
            loggedUser: { inFocusTaskProjectId: 'p-20', defaultProjectId: 'p-10' },
            projectIds: many,
        })

        expect(priority).toHaveLength(PRIORITY_PROJECT_LIMIT)
        expect(priority).toEqual(['p-30', 'p-20', 'p-10'])
    })

    it('returns nothing for an account with no projects', () => {
        expect(resolvePriorityProjectIds({ loggedUser: {}, projectIds: [] })).toEqual([])
        expect(resolvePriorityProjectIds()).toEqual([])
    })
})

describe('orderProjectsForDataWarmUp', () => {
    it('covers every project exactly once across the two buckets', () => {
        const projectIds = ['p-a', 'p-b', 'p-c', 'p-d', 'p-e']

        const { priorityProjectIds, warmUpProjectIds } = orderProjectsForDataWarmUp({
            urlProjectId: 'p-d',
            loggedUser: { defaultProjectId: 'p-b' },
            projectIds,
        })

        expect(priorityProjectIds).toEqual(['p-d', 'p-b', 'p-a'])
        expect(warmUpProjectIds).toEqual(['p-c', 'p-e'])
        expect([...priorityProjectIds, ...warmUpProjectIds].sort()).toEqual([...projectIds].sort())
    })

    it('keeps the remainder in the caller order and drops blanks', () => {
        const { warmUpProjectIds } = orderProjectsForDataWarmUp({
            loggedUser: {},
            projectIds: ['p-a', null, 'p-b', '', 'p-c'],
        })

        expect(warmUpProjectIds).toEqual(['p-b', 'p-c'])
    })

    it('does not warm a project twice when the id list contains duplicates', () => {
        const { warmUpProjectIds } = orderProjectsForDataWarmUp({
            loggedUser: {},
            projectIds: ['p-a', 'p-b', 'p-b', 'p-c', 'p-c'],
        })

        expect(warmUpProjectIds).toEqual(['p-b', 'p-c'])
    })

    it('handles an empty account without throwing', () => {
        expect(orderProjectsForDataWarmUp({ loggedUser: {}, projectIds: [] })).toEqual({
            priorityProjectIds: [],
            warmUpProjectIds: [],
        })
        expect(orderProjectsForDataWarmUp()).toEqual({ priorityProjectIds: [], warmUpProjectIds: [] })
    })
})
