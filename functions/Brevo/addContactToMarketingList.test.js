'use strict'

// Security audit 2026-11: addContactToBrevoMarketingList subscribed whatever address the request
// named, for any session including anonymous ones.

jest.mock('firebase-admin', () => ({ firestore: () => ({ doc: () => ({ get: async () => ({ data: () => null }) }) }) }))
jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: () => ({ SIB_API_KEY: 'test-key', SIB_MARKETING_SERVICE_LIST: '7' }),
}))

const { resolveMarketingSubscriptionRequest, addContactToMarketingList } = require('./addContactToMarketingList')

const request = (auth, data = {}) => ({ auth, data })
const verifiedAuth = (overrides = {}) => ({
    uid: 'u1',
    token: {
        email: 'me@example.com',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
        ...overrides,
    },
})

describe('resolveMarketingSubscriptionRequest', () => {
    test("subscribes the caller's own verified address and ignores data.email", () => {
        const resolved = resolveMarketingSubscriptionRequest(
            request(verifiedAuth(), { email: 'victim@example.com', languageIndex: '1', initialUrl: '/x' })
        )
        expect(resolved).toEqual({ email: 'me@example.com', initialUrl: '/x', languageIndex: '1', userId: 'u1' })
    })

    test('refuses an anonymous session', () => {
        expect(() =>
            resolveMarketingSubscriptionRequest(
                request(verifiedAuth({ firebase: { sign_in_provider: 'anonymous' } }), { email: 'victim@example.com' })
            )
        ).toThrow(expect.objectContaining({ code: 'permission-denied' }))
    })

    test('refuses an unverified or missing address', () => {
        expect(() => resolveMarketingSubscriptionRequest(request(verifiedAuth({ email_verified: false })))).toThrow(
            expect.objectContaining({ code: 'permission-denied' })
        )
        expect(() => resolveMarketingSubscriptionRequest(request(verifiedAuth({ email: undefined })))).toThrow(
            expect.objectContaining({ code: 'permission-denied' })
        )
        expect(() => resolveMarketingSubscriptionRequest(request(null))).toThrow(
            expect.objectContaining({ code: 'unauthenticated' })
        )
    })

    test('drops a language index Brevo does not define', () => {
        expect(
            resolveMarketingSubscriptionRequest(request(verifiedAuth(), { languageIndex: '<script>' })).languageIndex
        ).toBeUndefined()
    })

    test('only the resolved address reaches Brevo', async () => {
        const fetchMock = jest.fn(async () => ({ ok: true, status: 204, headers: { get: () => null } }))
        global.fetch = fetchMock
        jest.spyOn(console, 'log').mockImplementation(() => {})
        await addContactToMarketingList(
            resolveMarketingSubscriptionRequest(request(verifiedAuth(), { email: 'victim@example.com' }))
        )
        const payload = JSON.parse(fetchMock.mock.calls[0][1].body)
        expect(payload.email).toBe('me@example.com')
        expect(payload.attributes.EXT_ID).toBe('u1')
        console.log.mockRestore()
        delete global.fetch
    })
})
