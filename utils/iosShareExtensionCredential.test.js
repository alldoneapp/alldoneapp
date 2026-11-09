import { ensureIosShareExtensionCredential, isTrustedIosShareEndpoint } from './iosShareExtensionCredential'

jest.mock('./backends/firestore', () => ({ mintIosShareExtensionToken: jest.fn() }))
jest.mock('./CapacitorShell', () => ({
    beginIosShareCredentialProvisioning: jest.fn(() => 1),
    getIosShareExtensionPlugin: jest.fn(),
    isCurrentIosShareCredentialProvisioning: jest.fn(() => true),
}))

describe('iOS share extension credentials', () => {
    it('keeps the existing credential for the same user', async () => {
        const plugin = {
            getCredential: jest.fn(async () => ({
                installationId: 'installation-123',
                userId: 'user-1',
                token: 'token',
                endpointUrl: 'https://europe-west1-alldonealeph.cloudfunctions.net/iosShareTask',
            })),
            setCredential: jest.fn(),
        }
        const mintToken = jest.fn()

        await expect(ensureIosShareExtensionCredential('user-1', { plugin, mintToken })).resolves.toBe(true)
        expect(mintToken).not.toHaveBeenCalled()
        expect(plugin.setCredential).not.toHaveBeenCalled()
    })

    it('mints and stores a scoped credential when the user changes', async () => {
        const plugin = {
            getCredential: jest.fn(async () => ({ installationId: 'installation-123', userId: 'old-user' })),
            setCredential: jest.fn(async () => undefined),
        }
        const mintToken = jest.fn(async () => ({
            token: 'new-token',
            endpointUrl: 'https://europe-west1-alldonealeph.cloudfunctions.net/iosShareTask',
        }))

        await expect(ensureIosShareExtensionCredential('user-2', { plugin, mintToken })).resolves.toBe(true)
        expect(mintToken).toHaveBeenCalledWith('installation-123')
        expect(plugin.setCredential).toHaveBeenCalledWith({
            installationId: 'installation-123',
            userId: 'user-2',
            token: 'new-token',
            endpointUrl: 'https://europe-west1-alldonealeph.cloudfunctions.net/iosShareTask',
        })
    })

    it('does not publish a credential after logout invalidates the request', async () => {
        const plugin = {
            getCredential: jest.fn(async () => ({ installationId: 'installation-123' })),
            setCredential: jest.fn(),
        }
        const mintToken = jest.fn(async () => ({
            token: 'new-token',
            endpointUrl: 'https://europe-west1-alldonealeph.cloudfunctions.net/iosShareTask',
        }))

        await expect(
            ensureIosShareExtensionCredential('user-1', {
                plugin,
                mintToken,
                beginProvisioning: () => 7,
                isCurrentProvisioning: () => false,
            })
        ).resolves.toBe(false)
        expect(plugin.setCredential).not.toHaveBeenCalled()
    })
    // NV-33: an endpoint planted through the native bridge used to survive every re-provisioning,
    // because a matching user id short-circuited before the endpoint was looked at.
    it('replaces a stored endpoint that is not the Alldone share function', async () => {
        const plugin = {
            getCredential: jest.fn(async () => ({
                installationId: 'installation-123',
                userId: 'user-1',
                token: 'planted',
                endpointUrl: 'https://attacker.test/collect',
            })),
            setCredential: jest.fn(async () => undefined),
        }
        const mintToken = jest.fn(async () => ({
            token: 'fresh-token',
            endpointUrl: 'https://europe-west1-alldonealeph.cloudfunctions.net/iosShareTask',
        }))

        await expect(ensureIosShareExtensionCredential('user-1', { plugin, mintToken })).resolves.toBe(true)
        expect(mintToken).toHaveBeenCalledWith('installation-123')
        expect(plugin.setCredential).toHaveBeenCalledWith(
            expect.objectContaining({
                token: 'fresh-token',
                endpointUrl: 'https://europe-west1-alldonealeph.cloudfunctions.net/iosShareTask',
            })
        )
    })

    it('never stores an endpoint outside the allowlist, even from the mint', async () => {
        const plugin = {
            getCredential: jest.fn(async () => ({ installationId: 'installation-123' })),
            setCredential: jest.fn(),
        }
        const mintToken = jest.fn(async () => ({ token: 't', endpointUrl: 'https://attacker.test/collect' }))

        await expect(ensureIosShareExtensionCredential('user-1', { plugin, mintToken })).rejects.toThrow(
            'not an Alldone endpoint'
        )
        expect(plugin.setCredential).not.toHaveBeenCalled()
    })

    it('accepts only https on the Alldone functions hosts', () => {
        expect(isTrustedIosShareEndpoint('https://europe-west1-alldonestaging.cloudfunctions.net/iosShareTask')).toBe(
            true
        )
        for (const value of [
            'http://europe-west1-alldonealeph.cloudfunctions.net/iosShareTask',
            'https://europe-west1-alldonealeph.cloudfunctions.net.attacker.test/iosShareTask',
            'https://europe-west1-alldonealeph.cloudfunctions.net/other',
            'https://europe-west1-alldonealeph.cloudfunctions.net/iosShareTask?next=x',
            'javascript:alert(1)',
            '',
        ]) {
            expect(isTrustedIosShareEndpoint(value, { allowEmulator: false })).toBe(false)
        }
        const emulator = 'http://localhost:5001/alldonestaging/europe-west1/iosShareTask'
        expect(isTrustedIosShareEndpoint(emulator, { allowEmulator: true })).toBe(true)
        expect(isTrustedIosShareEndpoint(emulator, { allowEmulator: false })).toBe(false)
    })
})
