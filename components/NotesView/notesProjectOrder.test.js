import {
    NO_NOTE_EDITION_DATE,
    PROJECT_ORDER_PROBE_TIMEOUT_MS,
    applyProbedEditionDates,
    excludeGuideProjects,
    probeProjectsLastNoteEdit,
    sortProjectsByLastNoteEdit,
} from './notesProjectOrder'

const ids = projects => projects.map(project => project.id)

describe('sortProjectsByLastNoteEdit', () => {
    it('orders newest edit first and keeps ties in their incoming order', () => {
        const projects = [
            { id: 'a', lastEditNoteDate: NO_NOTE_EDITION_DATE },
            { id: 'b', lastEditNoteDate: 10 },
            { id: 'c' },
            { id: 'd', lastEditNoteDate: 30 },
            { id: 'e', lastEditNoteDate: NaN },
        ]
        expect(ids(sortProjectsByLastNoteEdit(projects))).toEqual(['d', 'b', 'a', 'c', 'e'])
    })

    it('does not mutate its input', () => {
        const projects = [
            { id: 'a', lastEditNoteDate: 1 },
            { id: 'b', lastEditNoteDate: 2 },
        ]
        sortProjectsByLastNoteEdit(projects)
        expect(ids(projects)).toEqual(['a', 'b'])
    })
})

describe('excludeGuideProjects', () => {
    it('drops guides by parent template and by the user guide list', () => {
        const projects = [{ id: 'a' }, { id: 'b', parentTemplateId: 't' }, { id: 'c' }]
        expect(ids(excludeGuideProjects(projects, { guideProjectIds: ['c'] }))).toEqual(['a'])
        expect(ids(excludeGuideProjects(projects, {}))).toEqual(['a', 'c'])
    })
})

describe('applyProbedEditionDates', () => {
    it('takes a probed date only when it is newer than what the project already knows', () => {
        const projects = [
            { id: 'a', lastEditNoteDate: 0 },
            { id: 'b', lastEditNoteDate: 50 },
            { id: 'c', lastEditNoteDate: 0 },
        ]
        const result = applyProbedEditionDates(projects, { a: 20, b: 10 })
        expect(result.map(project => project.lastEditNoteDate)).toEqual([20, 50, 0])
        expect(result[1]).toBe(projects[1])
    })
})

describe('probeProjectsLastNoteEdit', () => {
    afterEach(() => jest.useRealTimers())

    it('resolves with every answered date once all probes settle', async () => {
        const probe = jest.fn(id => Promise.resolve({ a: 5, b: 0 }[id]))
        await expect(probeProjectsLastNoteEdit(['a', 'b'], probe)).resolves.toEqual({ a: 5, b: 0 })
        expect(probe).toHaveBeenCalledTimes(2)
    })

    it('never rejects: failed, throwing and null probes are left out', async () => {
        const probe = id => {
            if (id === 'a') throw new Error('sync')
            if (id === 'b') return Promise.reject(new Error('async'))
            if (id === 'c') return Promise.resolve(null)
            return Promise.resolve(7)
        }
        await expect(probeProjectsLastNoteEdit(['a', 'b', 'c', 'd'], probe)).resolves.toEqual({ d: 7 })
    })

    it('resolves immediately for no projects', async () => {
        await expect(probeProjectsLastNoteEdit([], jest.fn())).resolves.toEqual({})
    })

    it('gives up on slow probes at the timeout and ignores their late answers', async () => {
        jest.useFakeTimers()
        let resolveSlow
        const probe = id => (id === 'fast' ? Promise.resolve(3) : new Promise(resolve => (resolveSlow = resolve)))
        const result = probeProjectsLastNoteEdit(['fast', 'slow'], probe)

        for (let i = 0; i < 5; i++) await Promise.resolve()
        jest.advanceTimersByTime(PROJECT_ORDER_PROBE_TIMEOUT_MS)
        await expect(result).resolves.toEqual({ fast: 3 })

        resolveSlow(99)
        await expect(result).resolves.toEqual({ fast: 3 })
    })
})
