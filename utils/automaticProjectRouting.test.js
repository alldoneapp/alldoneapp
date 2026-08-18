import {
    AUTOMATIC_PROJECT_ROUTING_SOURCE,
    buildPendingProjectRouting,
    resolveAutomaticHostProjectId,
} from './automaticProjectRouting'

describe('resolveAutomaticHostProjectId', () => {
    const projects = [{ id: 'project-a' }, { id: 'project-b' }]

    it('uses the default project when the user can still write to it', () => {
        expect(resolveAutomaticHostProjectId({ defaultProjectId: 'project-b', projects })).toBe('project-b')
    })

    // A default project that was archived, left or deleted is still on the user
    // doc; creating there would fail, so the offered list decides.
    it('falls back to the first offered project when the default is not among them', () => {
        expect(resolveAutomaticHostProjectId({ defaultProjectId: 'project-gone', projects })).toBe('project-a')
    })

    it('keeps the default project when no candidate list is available yet', () => {
        expect(resolveAutomaticHostProjectId({ defaultProjectId: 'project-b', projects: [] })).toBe('project-b')
    })

    it('never invents a project id', () => {
        expect(resolveAutomaticHostProjectId({})).toBe('')
        expect(resolveAutomaticHostProjectId()).toBe('')
    })
})

describe('buildPendingProjectRouting', () => {
    it('stamps the pending routing request with the host project it was created in', () => {
        expect(buildPendingProjectRouting({ hostProjectId: 'project-a', now: 42 })).toEqual({
            status: 'pending',
            source: AUTOMATIC_PROJECT_ROUTING_SOURCE,
            hostProjectId: 'project-a',
            requestedAt: 42,
        })
    })

    it('never writes undefined into a Firestore field', () => {
        expect(buildPendingProjectRouting({ now: 1 }).hostProjectId).toBe('')
    })
})
