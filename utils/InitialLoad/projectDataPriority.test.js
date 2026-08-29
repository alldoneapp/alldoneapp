import { resolveBootCriticalProjectIds } from './projectDataPriority'

describe('resolveBootCriticalProjectIds', () => {
    const projectIds = ['p-alpha', 'p-beta', 'p-gamma', 'p-delta']

    it('returns the route project and default-assistant project independently', () => {
        expect(
            resolveBootCriticalProjectIds({
                urlProjectId: 'p-gamma',
                loggedUser: { defaultProjectId: 'p-alpha' },
                projectIds,
            })
        ).toEqual({
            routeProjectId: 'p-gamma',
            defaultAssistantProjectId: 'p-alpha',
        })
    })

    it('does not invent a route project for an ordinary All Projects boot', () => {
        expect(
            resolveBootCriticalProjectIds({
                loggedUser: { inFocusTaskProjectId: 'p-beta', defaultProjectId: 'p-alpha' },
                projectIds,
            })
        ).toEqual({
            routeProjectId: null,
            defaultAssistantProjectId: 'p-alpha',
        })
    })

    it('deduplicates naturally when the route and default project are the same', () => {
        const result = resolveBootCriticalProjectIds({
            urlProjectId: 'p-gamma',
            loggedUser: { defaultProjectId: 'p-gamma' },
            projectIds,
        })

        expect(result).toEqual({
            routeProjectId: 'p-gamma',
            defaultAssistantProjectId: 'p-gamma',
        })
    })

    it('ignores stale or foreign ids', () => {
        expect(
            resolveBootCriticalProjectIds({
                urlProjectId: 'p-not-mine',
                loggedUser: { defaultProjectId: 'p-also-not-mine' },
                projectIds,
            })
        ).toEqual({ routeProjectId: null, defaultAssistantProjectId: null })
    })

    it('returns nothing for an account with no projects', () => {
        expect(resolveBootCriticalProjectIds({ loggedUser: {}, projectIds: [] })).toEqual({
            routeProjectId: null,
            defaultAssistantProjectId: null,
        })
        expect(resolveBootCriticalProjectIds()).toEqual({
            routeProjectId: null,
            defaultAssistantProjectId: null,
        })
    })
})
