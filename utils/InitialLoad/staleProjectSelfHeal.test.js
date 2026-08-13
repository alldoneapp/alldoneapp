import {
    getMissingProjectEntriesIds,
    pruneStaleProjectIds,
    resetStaleProjectSelfHealForTests,
} from './staleProjectSelfHeal'

describe('getMissingProjectEntriesIds', () => {
    it('returns only ids whose read succeeded with a missing project doc', () => {
        expect(
            getMissingProjectEntriesIds([
                null, // failed read — never a candidate
                { projectId: 'gone1', project: null },
                { projectId: 'ok', project: { id: 'ok' } },
                { projectId: 'gone2', project: undefined },
                { project: null }, // no projectId stamped — cannot act on it
            ])
        ).toEqual(['gone1', 'gone2'])
        expect(getMissingProjectEntriesIds(undefined)).toEqual([])
    })
})

describe('pruneStaleProjectIds', () => {
    it('never mutates membership from a boot-time missing-document signal', async () => {
        resetStaleProjectSelfHealForTests()

        await expect(pruneStaleProjectIds(['apparently-missing', 'apparently-missing'])).resolves.toEqual([])
        await expect(pruneStaleProjectIds()).resolves.toEqual([])
    })
})
