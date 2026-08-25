import { ensureIosShareExtensionCredential } from './iosShareExtensionCredential'

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
                endpointUrl: 'https://example.com/task',
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
            endpointUrl: 'https://example.com/task',
        }))

        await expect(ensureIosShareExtensionCredential('user-2', { plugin, mintToken })).resolves.toBe(true)
        expect(mintToken).toHaveBeenCalledWith('installation-123')
        expect(plugin.setCredential).toHaveBeenCalledWith({
            installationId: 'installation-123',
            userId: 'user-2',
            token: 'new-token',
            endpointUrl: 'https://example.com/task',
        })
    })

    it('does not publish a credential after logout invalidates the request', async () => {
        const plugin = {
            getCredential: jest.fn(async () => ({ installationId: 'installation-123' })),
            setCredential: jest.fn(),
        }
        const mintToken = jest.fn(async () => ({
            token: 'new-token',
            endpointUrl: 'https://example.com/task',
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
})
