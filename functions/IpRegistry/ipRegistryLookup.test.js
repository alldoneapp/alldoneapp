const { getCallerIp, ipRegistryLookup } = require('./ipRegistryLookup')

function makeDb(count = 0) {
    const doc = { exists: count > 0, data: () => ({ windowStart: Date.now(), count }) }
    return {
        collection: () => ({ doc: () => ({}) }),
        runTransaction: async fn => fn({ get: async () => doc, set: jest.fn() }),
    }
}

const okResponse = () => ({
    ok: true,
    json: async () => ({ location: { country: { name: 'Germany' } }, time_zone: {}, currency: {} }),
})

describe('ipRegistryLookup (NV-24)', () => {
    test('looks up exactly the caller address and ignores anything the caller sends', async () => {
        const fetchImpl = jest.fn(async () => okResponse())
        const result = await ipRegistryLookup(
            {
                userId: 'u1',
                rawRequest: {
                    headers: { 'x-forwarded-for': '8.8.8.8,1.1.1.1, 203.0.113.9' },
                    body: { data: { ip: '9.9.9.9' } },
                },
            },
            { getEnv: () => ({ IP_REGISTRY_API_KEY: 'k' }), db: makeDb(), fetchImpl }
        )
        expect(result.success).toBe(true)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.ipregistry.co/203.0.113.9?key=k')
    })

    test('the address is the rightmost public X-Forwarded-For entry, not one the client prepended', () => {
        expect(getCallerIp({ headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.7' } })).toBe('198.51.100.7')
        expect(getCallerIp({ headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } })).toBe('198.51.100.7')
        expect(getCallerIp({ headers: { 'x-forwarded-for': '1.2.3.4,5.6.7.8,9.9.9.9' } })).toBe('9.9.9.9')
        expect(getCallerIp({ headers: { 'x-forwarded-for': 'garbage, 127.0.0.1' } })).toBe(null)
    })

    test('never makes a request for an unknown caller address', async () => {
        const fetchImpl = jest.fn()
        const result = await ipRegistryLookup(
            { userId: 'u1', rawRequest: { headers: {} } },
            { getEnv: () => ({ IP_REGISTRY_API_KEY: 'k' }), db: makeDb(), fetchImpl }
        )
        expect(result.success).toBe(false)
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    test('is rate limited per user', async () => {
        const fetchImpl = jest.fn()
        await expect(
            ipRegistryLookup(
                { userId: 'u1', rawRequest: { headers: { 'x-forwarded-for': '203.0.113.9' } } },
                { getEnv: () => ({ IP_REGISTRY_API_KEY: 'k' }), db: makeDb(1000), fetchImpl }
            )
        ).rejects.toMatchObject({ code: 'resource-exhausted' })
        expect(fetchImpl).not.toHaveBeenCalled()
    })
})
