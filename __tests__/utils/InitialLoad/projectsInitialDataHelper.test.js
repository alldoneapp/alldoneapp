import {
    INVALID_ENTRY_REASONS,
    getInvalidProjectEntryReason,
    haveSameProjectIds,
    isCompleteProjectsInitialData,
    isValidProjectEntry,
    sanitizeProjectsInitialData,
} from '../../../utils/InitialLoad/projectsInitialDataHelper'

const projectEntry = (id, overrides = {}) => ({
    projectId: id,
    project: { id, name: `Project ${id}` },
    users: [{ uid: 'u1' }],
    contacts: [],
    workstreams: [],
    assistants: [],
    ...overrides,
})

const silentLogger = { error: jest.fn() }

beforeEach(() => {
    silentLogger.error.mockClear()
})

describe('getInvalidProjectEntryReason', () => {
    it('accepts a fully loaded project entry', () => {
        expect(getInvalidProjectEntryReason(projectEntry('p1'))).toBe(null)
        expect(isValidProjectEntry(projectEntry('p1'))).toBe(true)
    })

    it('rejects a missing entry', () => {
        expect(getInvalidProjectEntryReason(null)).toBe(INVALID_ENTRY_REASONS.MISSING_ENTRY)
        expect(getInvalidProjectEntryReason(undefined)).toBe(INVALID_ENTRY_REASONS.MISSING_ENTRY)
        expect(getInvalidProjectEntryReason('nope')).toBe(INVALID_ENTRY_REASONS.MISSING_ENTRY)
    })

    it('rejects an entry whose project document could not be read', () => {
        expect(getInvalidProjectEntryReason(projectEntry('p1', { project: null }))).toBe(
            INVALID_ENTRY_REASONS.MISSING_PROJECT
        )
        expect(getInvalidProjectEntryReason(projectEntry('p1', { project: undefined }))).toBe(
            INVALID_ENTRY_REASONS.MISSING_PROJECT
        )
    })

    it('rejects a project without an id', () => {
        expect(getInvalidProjectEntryReason(projectEntry('p1', { project: { name: 'broken' } }))).toBe(
            INVALID_ENTRY_REASONS.MISSING_PROJECT_ID
        )
    })
})

describe('sanitizeProjectsInitialData', () => {
    // This is the exact payload that used to throw
    // "TypeError: Cannot set properties of null (setting 'index')" at loggedUserHelper.js:146
    // and thereby aborted the whole login.
    it('drops an entry with a null project instead of throwing', () => {
        const payload = [projectEntry('p1'), projectEntry('p2', { project: null }), projectEntry('p3')]

        const { validEntries, invalidEntries } = sanitizeProjectsInitialData(payload, ['p1', 'p2', 'p3'], silentLogger)

        expect(validEntries.map(entry => entry.project.id)).toEqual(['p1', 'p3'])
        expect(invalidEntries).toEqual([{ index: 1, reason: INVALID_ENTRY_REASONS.MISSING_PROJECT, projectId: 'p2' }])
    })

    it('assigns a gapless index over the remaining projects', () => {
        const payload = [null, projectEntry('p2'), projectEntry('p3', { project: null }), projectEntry('p4')]

        const { validEntries } = sanitizeProjectsInitialData(payload, ['p1', 'p2', 'p3', 'p4'], silentLogger)

        expect(validEntries.map(entry => entry.project.index)).toEqual([0, 1])
        expect(validEntries.map(entry => entry.project.id)).toEqual(['p2', 'p4'])
    })

    it('never mutates the source payload (cached objects stay clean)', () => {
        const entry = projectEntry('p1')
        const payload = [entry]

        sanitizeProjectsInitialData(payload, ['p1'], silentLogger)

        expect(entry.project.index).toBeUndefined()
    })

    it('normalizes missing sub-collections to arrays', () => {
        const payload = [{ projectId: 'p1', project: { id: 'p1' } }]

        const { validEntries } = sanitizeProjectsInitialData(payload, ['p1'], silentLogger)

        expect(validEntries[0]).toEqual({
            project: { id: 'p1', index: 0 },
            users: [],
            contacts: [],
            workstreams: [],
            assistants: [],
        })
    })

    it('reports the offending project ids for diagnostics', () => {
        sanitizeProjectsInitialData([projectEntry('p1', { project: null })], ['p1'], silentLogger)

        expect(silentLogger.error).toHaveBeenCalledTimes(1)
        const [, diagnostics] = silentLogger.error.mock.calls[0]
        expect(diagnostics.droppedCount).toBe(1)
        expect(diagnostics.dropped[0].projectId).toBe('p1')
    })

    it('falls back to positional ids for legacy cached entries without projectId', () => {
        const payload = [{ project: null, users: [] }]

        const { invalidEntries } = sanitizeProjectsInitialData(payload, ['legacy-id'], silentLogger)

        expect(invalidEntries[0].projectId).toBe('legacy-id')
    })

    it('does not log and returns empty results for an empty or non-array payload', () => {
        expect(sanitizeProjectsInitialData(undefined, [], silentLogger).validEntries).toEqual([])
        expect(sanitizeProjectsInitialData([], [], silentLogger).invalidEntries).toEqual([])
        expect(silentLogger.error).not.toHaveBeenCalled()
    })

    it('tolerates a null logger', () => {
        expect(() => sanitizeProjectsInitialData([null], ['p1'], null)).not.toThrow()
    })
})

describe('isCompleteProjectsInitialData', () => {
    it('is true only when every requested project loaded', () => {
        expect(isCompleteProjectsInitialData([projectEntry('p1'), projectEntry('p2')], 2)).toBe(true)
        expect(isCompleteProjectsInitialData([projectEntry('p1'), null], 2)).toBe(false)
        expect(isCompleteProjectsInitialData([projectEntry('p1'), projectEntry('p2', { project: null })], 2)).toBe(
            false
        )
        expect(isCompleteProjectsInitialData([projectEntry('p1')], 2)).toBe(false)
        expect(isCompleteProjectsInitialData(undefined, 0)).toBe(false)
    })

    it('accepts an empty payload for a user without projects', () => {
        expect(isCompleteProjectsInitialData([], 0)).toBe(true)
    })
})

describe('haveSameProjectIds', () => {
    it('compares ignoring order', () => {
        expect(haveSameProjectIds(['a', 'b'], ['b', 'a'])).toBe(true)
        expect(haveSameProjectIds(['a', 'b'], ['a', 'c'])).toBe(false)
        expect(haveSameProjectIds(['a'], ['a', 'b'])).toBe(false)
        expect(haveSameProjectIds(null, ['a'])).toBe(false)
    })

    // The previous inline check sorted the arrays in place, reordering loggedUser.projectIds
    // inside the redux state as a side effect of a cache lookup.
    it('does not mutate its arguments', () => {
        const cachedIds = ['c', 'a', 'b']
        const loggedUserProjectIds = ['b', 'c', 'a']

        haveSameProjectIds(cachedIds, loggedUserProjectIds)

        expect(cachedIds).toEqual(['c', 'a', 'b'])
        expect(loggedUserProjectIds).toEqual(['b', 'c', 'a'])
    })
})
