import store from '../../redux/store'
import { addProjectData } from '../../redux/actions'
import { getInitialProjectData } from './initialLoadHelper'
import { recoverDroppedProject, resetProjectRecoveryForTests } from './projectRecovery'

jest.mock('../../redux/store', () => ({
    getState: jest.fn(),
    dispatch: jest.fn(),
}))

jest.mock('../../redux/actions', () => ({
    addProjectData: jest.fn((project, users, workstreams, contacts, assistants) => ({
        type: 'Add project data',
        project,
        users,
        workstreams,
        contacts,
        assistants,
    })),
}))

jest.mock('./initialLoadHelper', () => ({
    getInitialProjectData: jest.fn(),
}))

const setState = ({ loggedUser, loggedUserProjectsMap = {} }) =>
    store.getState.mockReturnValue({ loggedUser, loggedUserProjectsMap })

describe('recoverDroppedProject', () => {
    let consoleWarn

    beforeEach(() => {
        resetProjectRecoveryForTests()
        store.getState.mockReset()
        store.dispatch.mockReset()
        getInitialProjectData.mockReset()
        addProjectData.mockClear()
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarn.mockRestore()
    })

    it('inserts the full project bundle for a dropped project', async () => {
        setState({ loggedUser: { uid: 'user1', projectIds: ['p1'] } })
        getInitialProjectData.mockResolvedValue({
            project: { id: 'p1', name: 'Recovered' },
            users: [{ uid: 'user1' }],
            contacts: [{ uid: 'c1' }],
            workstreams: [{ uid: 'ws1' }],
            assistants: [],
        })

        await expect(recoverDroppedProject('p1')).resolves.toBe(true)

        expect(addProjectData).toHaveBeenCalledWith(
            { id: 'p1', name: 'Recovered' },
            [{ uid: 'user1' }],
            [{ uid: 'ws1' }],
            [{ uid: 'c1' }],
            []
        )
        expect(store.dispatch).toHaveBeenCalledTimes(1)
    })

    it('does nothing when the project is already in the map', async () => {
        setState({
            loggedUser: { uid: 'user1', projectIds: ['p1'] },
            loggedUserProjectsMap: { p1: { id: 'p1' } },
        })

        await expect(recoverDroppedProject('p1')).resolves.toBe(false)
        expect(getInitialProjectData).not.toHaveBeenCalled()
    })

    it('does nothing for anonymous users or projects outside projectIds', async () => {
        setState({ loggedUser: { uid: 'anon', isAnonymous: true, projectIds: ['p1'] } })
        await expect(recoverDroppedProject('p1')).resolves.toBe(false)

        setState({ loggedUser: { uid: 'user1', projectIds: ['other'] } })
        await expect(recoverDroppedProject('p1')).resolves.toBe(false)

        expect(getInitialProjectData).not.toHaveBeenCalled()
    })

    it('skips a degraded bundle (no users) so a later watcher snapshot can retry', async () => {
        setState({ loggedUser: { uid: 'user1', projectIds: ['p1'] } })
        getInitialProjectData.mockResolvedValue({
            project: { id: 'p1' },
            users: [],
            contacts: [],
            workstreams: [],
            assistants: [],
        })

        await expect(recoverDroppedProject('p1')).resolves.toBe(false)
        expect(store.dispatch).not.toHaveBeenCalled()

        // The in-flight guard must have been released: a later snapshot retries successfully.
        getInitialProjectData.mockResolvedValue({
            project: { id: 'p1' },
            users: [{ uid: 'user1' }],
            contacts: [],
            workstreams: [],
            assistants: [],
        })
        await expect(recoverDroppedProject('p1')).resolves.toBe(true)
    })

    it('runs one recovery per project at a time', async () => {
        setState({ loggedUser: { uid: 'user1', projectIds: ['p1'] } })
        let resolveBundle
        getInitialProjectData.mockReturnValue(new Promise(resolve => (resolveBundle = resolve)))

        const first = recoverDroppedProject('p1')
        const second = recoverDroppedProject('p1')
        await expect(second).resolves.toBe(false)

        resolveBundle({
            project: { id: 'p1' },
            users: [{ uid: 'user1' }],
            contacts: [],
            workstreams: [],
            assistants: [],
        })
        await expect(first).resolves.toBe(true)
        expect(getInitialProjectData).toHaveBeenCalledTimes(1)
    })

    it('swallows fetch errors and releases the in-flight guard', async () => {
        setState({ loggedUser: { uid: 'user1', projectIds: ['p1'] } })
        getInitialProjectData.mockRejectedValue(new Error('offline'))

        await expect(recoverDroppedProject('p1')).resolves.toBe(false)
        expect(store.dispatch).not.toHaveBeenCalled()
    })
})
