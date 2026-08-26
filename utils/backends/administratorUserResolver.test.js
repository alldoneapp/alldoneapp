import { resolveAdministratorUser } from './administratorUserResolver'

const role = userId => ({ exists: !!userId, data: userId ? { userId } : undefined })
const foundUser = uid => ({ user: { uid }, missing: false, error: null, verified: true })
const missingUser = () => ({ user: null, missing: true, error: null, verified: true })

const setup = ({ clientRole = role('admin-1'), directRole = role('admin-1'), users = {} } = {}) => {
    const readRoleFromClient = jest.fn().mockResolvedValue(clientRole)
    const readRoleDirectly = jest.fn().mockResolvedValue(directRole)
    const readUserResult = jest.fn(async userId => users[userId] || foundUser(userId))
    const recoverRealtimeConnection = jest.fn().mockResolvedValue(undefined)
    const warn = jest.fn()

    const resolve = () =>
        resolveAdministratorUser({
            readRoleFromClient,
            readRoleDirectly,
            readUserResult,
            recoverRealtimeConnection,
            warn,
        })

    return { resolve, readRoleFromClient, readRoleDirectly, readUserResult, recoverRealtimeConnection, warn }
}

describe('resolveAdministratorUser', () => {
    it('uses the realtime role and verified user on the normal path', async () => {
        const harness = setup()

        await expect(harness.resolve()).resolves.toEqual({ uid: 'admin-1' })
        expect(harness.readRoleDirectly).not.toHaveBeenCalled()
        expect(harness.recoverRealtimeConnection).not.toHaveBeenCalled()
    })

    it('recovers a role pointer omitted by the realtime client', async () => {
        const harness = setup({ clientRole: role(null) })

        await expect(harness.resolve()).resolves.toEqual({ uid: 'admin-1' })
        expect(harness.readRoleDirectly).toHaveBeenCalledTimes(1)
        expect(harness.recoverRealtimeConnection).toHaveBeenCalledWith(
            'recover the Administrator role omitted during initial load'
        )
    })

    it('uses the direct role when the realtime role read rejects', async () => {
        const harness = setup()
        harness.readRoleFromClient.mockRejectedValue(new Error('listen stream unavailable'))

        await expect(harness.resolve()).resolves.toEqual({ uid: 'admin-1' })
        expect(harness.readRoleDirectly).toHaveBeenCalledTimes(1)
        expect(harness.recoverRealtimeConnection).toHaveBeenCalledTimes(1)
    })

    it('accepts an unconfigured role only after the direct read confirms it', async () => {
        const harness = setup({ clientRole: role(null), directRole: role(null) })

        await expect(harness.resolve()).resolves.toEqual({})
        expect(harness.readUserResult).not.toHaveBeenCalled()
    })

    it('keeps a failed role verification retryable', async () => {
        const harness = setup({ clientRole: role(null) })
        harness.readRoleDirectly.mockRejectedValue(new Error('offline'))

        await expect(harness.resolve()).rejects.toThrow('Administrator role could not be verified')
    })

    it('keeps an unverified user read retryable', async () => {
        const harness = setup({
            users: {
                'admin-1': { user: null, missing: false, error: new Error('token refresh'), verified: false },
            },
        })

        await expect(harness.resolve()).rejects.toThrow('Administrator user document')
        expect(harness.readRoleDirectly).not.toHaveBeenCalled()
    })

    it('follows an authoritative role change instead of clearing the Administrator', async () => {
        const harness = setup({
            directRole: role('admin-2'),
            users: { 'admin-1': missingUser(), 'admin-2': foundUser('admin-2') },
        })

        await expect(harness.resolve()).resolves.toEqual({ uid: 'admin-2' })
        expect(harness.readUserResult).toHaveBeenCalledWith('admin-1')
        expect(harness.readUserResult).toHaveBeenCalledWith('admin-2')
        expect(harness.recoverRealtimeConnection).toHaveBeenCalledWith('recover a stale Administrator role pointer')
    })

    it('returns empty only when the role still points to a verified missing user', async () => {
        const harness = setup({ users: { 'admin-1': missingUser() } })

        await expect(harness.resolve()).resolves.toEqual({})
        expect(harness.warn).toHaveBeenCalledWith(
            '[GlobalData] roles/administrator points to missing user document /users/admin-1.'
        )
    })
})
