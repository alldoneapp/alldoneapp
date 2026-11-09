jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => ({ loggedUser: { uid: 'bob' }, globalAssistants: [{ uid: 'global-anna' }] }),
        dispatch: jest.fn(),
    },
}))
const mockRunCallable = jest.fn()
jest.mock('../firestore', () => ({
    ...jest.requireActual('../firestore'),
    runHttpsCallableFunction: (...args) => mockRunCallable(...args),
}))

const {
    getAssistantHeartbeatOptIn,
    refreshOwnHeartbeatConfirmation,
    setAssistantHeartbeatOptIn,
} = require('./assistantsFirestore')

// NV-17: the heartbeat confirmation is the server's; the client only asks for it.
describe('heartbeat confirmation client calls', () => {
    beforeEach(() => mockRunCallable.mockReset().mockResolvedValue({ success: true, state: 'confirmed' }))

    test('reads, confirms and revokes through the callable', async () => {
        await getAssistantHeartbeatOptIn('p1', 'a1')
        await setAssistantHeartbeatOptIn('p1', 'a1', true)
        await setAssistantHeartbeatOptIn('p1', 'a1', false)
        expect(mockRunCallable.mock.calls).toEqual([
            ['assistantHeartbeatOptIn', { projectId: 'p1', assistantId: 'a1', action: 'get' }],
            ['assistantHeartbeatOptIn', { projectId: 'p1', assistantId: 'a1', action: 'confirm' }],
            ['assistantHeartbeatOptIn', { projectId: 'p1', assistantId: 'a1', action: 'revoke' }],
        ])
    })

    test('a member’s own edit only refreshes, never confirms, and never throws', async () => {
        await refreshOwnHeartbeatConfirmation('p1', 'a1')
        expect(mockRunCallable).toHaveBeenCalledWith('assistantHeartbeatOptIn', {
            projectId: 'p1',
            assistantId: 'a1',
            action: 'refresh',
        })
        mockRunCallable.mockRejectedValueOnce(new Error('offline'))
        await expect(refreshOwnHeartbeatConfirmation('p1', 'a1')).resolves.toBeNull()
        // Global assistants have no project heartbeat of their own.
        mockRunCallable.mockClear()
        await refreshOwnHeartbeatConfirmation('p1', 'global-anna')
        expect(mockRunCallable).not.toHaveBeenCalled()
    })
})
