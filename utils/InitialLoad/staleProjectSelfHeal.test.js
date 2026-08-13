import store from '../../redux/store'
import { getDb } from '../backends/firestore'
import {
    getMissingProjectEntriesIds,
    pruneStaleProjectIds,
    resetStaleProjectSelfHealForTests,
} from './staleProjectSelfHeal'

jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {
        firestore: {
            FieldValue: {
                arrayRemove: (...ids) => ({ op: 'arrayRemove', ids }),
            },
        },
    },
}))

jest.mock('../../redux/store', () => ({
    getState: jest.fn(),
}))

jest.mock('../backends/firestore', () => ({
    getDb: jest.fn(),
}))

// `canaryState` drives the own-user-doc read that gates the prune ('exists' | 'missing' | 'error').
const buildDbMock = ({ serverProjectStates = {}, updateError = null, canaryState = 'exists' } = {}) => {
    const update = jest.fn(() => (updateError ? Promise.reject(updateError) : Promise.resolve()))
    const get = jest.fn(options => {
        expect(options).toEqual({ source: 'server' })
        if (canaryState === 'error') return Promise.reject(new Error('client is offline'))
        return Promise.resolve({ exists: canaryState === 'exists' })
    })
    const doc = jest.fn(path => {
        if (path.startsWith('projects/')) {
            const projectId = path.slice('projects/'.length)
            const state = serverProjectStates[projectId]
            return {
                get: jest.fn(options => {
                    expect(options).toEqual({ source: 'server' })
                    if (state === 'error') return Promise.reject(new Error('client is offline'))
                    return Promise.resolve({ exists: state === 'exists' })
                }),
            }
        }
        return { get, update }
    })
    return { doc, update }
}

const setLoggedUser = loggedUser => store.getState.mockReturnValue({ loggedUser })

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
    let consoleWarn

    beforeEach(() => {
        resetStaleProjectSelfHealForTests()
        store.getState.mockReset()
        getDb.mockReset()
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarn.mockRestore()
    })

    it('removes server-confirmed gone ids from every project id list on the user doc', async () => {
        const db = buildDbMock({ serverProjectStates: { gone: 'missing' } })
        getDb.mockReturnValue(db)
        setLoggedUser({ uid: 'user1', projectIds: ['gone', 'alive'] })

        await expect(pruneStaleProjectIds(['gone'])).resolves.toEqual(['gone'])

        expect(db.doc).toHaveBeenCalledWith('users/user1')
        const removal = { op: 'arrayRemove', ids: ['gone'] }
        expect(db.update).toHaveBeenCalledWith({
            projectIds: removal,
            archivedProjectIds: removal,
            templateProjectIds: removal,
            guideProjectIds: removal,
            copyProjectIds: removal,
            invitedProjectIds: removal,
        })
    })

    it('does not prune when the server read fails (offline / permission denied)', async () => {
        const db = buildDbMock({ serverProjectStates: { gone: 'error' } })
        getDb.mockReturnValue(db)
        setLoggedUser({ uid: 'user1', projectIds: ['gone'] })

        await expect(pruneStaleProjectIds(['gone'])).resolves.toEqual([])
        expect(db.update).not.toHaveBeenCalled()
    })

    it('does not prune when the project still exists on the server (stale cache signal)', async () => {
        const db = buildDbMock({ serverProjectStates: { cached: 'exists' } })
        getDb.mockReturnValue(db)
        setLoggedUser({ uid: 'user1', projectIds: ['cached'] })

        await expect(pruneStaleProjectIds(['cached'])).resolves.toEqual([])
        expect(db.update).not.toHaveBeenCalled()
    })

    it('ignores ids that are not in the logged user projectIds', async () => {
        const db = buildDbMock()
        getDb.mockReturnValue(db)
        setLoggedUser({ uid: 'user1', projectIds: ['other'] })

        await expect(pruneStaleProjectIds(['gone'])).resolves.toEqual([])
        expect(db.doc).not.toHaveBeenCalled()
    })

    it('ignores ids of project copies in flight', async () => {
        const db = buildDbMock({ serverProjectStates: { copying: 'missing' } })
        getDb.mockReturnValue(db)
        setLoggedUser({ uid: 'user1', projectIds: ['copying'], copyProjectIds: ['copying'] })

        await expect(pruneStaleProjectIds(['copying'])).resolves.toEqual([])
        expect(db.update).not.toHaveBeenCalled()
    })

    it('does nothing for anonymous users or when logged out', async () => {
        const db = buildDbMock()
        getDb.mockReturnValue(db)

        setLoggedUser({ uid: 'anon1', isAnonymous: true, projectIds: ['gone'] })
        await expect(pruneStaleProjectIds(['gone'])).resolves.toEqual([])

        setLoggedUser(undefined)
        await expect(pruneStaleProjectIds(['gone'])).resolves.toEqual([])

        expect(db.doc).not.toHaveBeenCalled()
    })

    it('handles each id at most once per session across overlapping call sites', async () => {
        const db = buildDbMock({ serverProjectStates: { gone: 'missing' } })
        getDb.mockReturnValue(db)
        setLoggedUser({ uid: 'user1', projectIds: ['gone'] })

        await expect(pruneStaleProjectIds(['gone', 'gone'])).resolves.toEqual(['gone'])
        await expect(pruneStaleProjectIds(['gone'])).resolves.toEqual([])
        expect(db.update).toHaveBeenCalledTimes(1)
    })

    it('does not prune when the transport canary reports the own user doc as missing', async () => {
        // The client has been observed reporting existing docs as missing (2026-08-13). If even
        // the logged user's own doc reads as absent, no absence signal may be trusted.
        const lyingDb = buildDbMock({ serverProjectStates: { gone: 'missing' }, canaryState: 'missing' })
        getDb.mockReturnValue(lyingDb)
        setLoggedUser({ uid: 'user1', projectIds: ['gone'] })

        await expect(pruneStaleProjectIds(['gone'])).resolves.toEqual([])
        expect(lyingDb.update).not.toHaveBeenCalled()

        // Re-armed: once the transport answers honestly again, the prune goes through.
        const honestDb = buildDbMock({ serverProjectStates: { gone: 'missing' } })
        getDb.mockReturnValue(honestDb)
        await expect(pruneStaleProjectIds(['gone'])).resolves.toEqual(['gone'])
    })

    it('does not prune when the transport canary read fails', async () => {
        const db = buildDbMock({ serverProjectStates: { gone: 'missing' }, canaryState: 'error' })
        getDb.mockReturnValue(db)
        setLoggedUser({ uid: 'user1', projectIds: ['gone'] })

        await expect(pruneStaleProjectIds(['gone'])).resolves.toEqual([])
        expect(db.update).not.toHaveBeenCalled()
    })

    it('re-arms the id when the user doc write fails so a later session can retry', async () => {
        const failingDb = buildDbMock({ serverProjectStates: { gone: 'missing' }, updateError: new Error('boom') })
        getDb.mockReturnValue(failingDb)
        setLoggedUser({ uid: 'user1', projectIds: ['gone'] })

        await expect(pruneStaleProjectIds(['gone'])).resolves.toEqual([])

        const workingDb = buildDbMock({ serverProjectStates: { gone: 'missing' } })
        getDb.mockReturnValue(workingDb)
        await expect(pruneStaleProjectIds(['gone'])).resolves.toEqual(['gone'])
        expect(workingDb.update).toHaveBeenCalledTimes(1)
    })
})
