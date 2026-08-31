import { initializeGoogleIdentity } from './googleIdentityInitialization'

describe('initializeGoogleIdentity', () => {
    it('does not initialize the same Google client and callback twice', () => {
        const accountsId = { initialize: jest.fn() }
        const callback = jest.fn()

        expect(initializeGoogleIdentity({ accountsId, clientId: 'client-1', callback })).toBe(true)
        expect(initializeGoogleIdentity({ accountsId, clientId: 'client-1', callback })).toBe(false)
        expect(accountsId.initialize).toHaveBeenCalledTimes(1)
        expect(accountsId.initialize).toHaveBeenCalledWith({
            client_id: 'client-1',
            callback,
            itp_support: true,
        })
    })

    it('initializes a newly loaded Google client instance', () => {
        const accountsId = { initialize: jest.fn() }

        expect(initializeGoogleIdentity({ accountsId, clientId: 'client-1', callback: jest.fn() })).toBe(true)
        expect(accountsId.initialize).toHaveBeenCalledTimes(1)
    })
})
