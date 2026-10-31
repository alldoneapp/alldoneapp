'use strict'

// alldone.team identifies an alldone.app account by the email address this module reports
// (menubar session, embedded tools) and names it again when it charges Gold. That address
// must be the account's verified Auth email: users/{uid}.email is written by the client.

const crypto = require('crypto')

const mockDocs = new Map()
const mockAuthUsers = {}
const mockDeductGold = jest.fn(async userId => ({ success: true, newBalance: 90, userId }))

jest.mock('firebase-admin', () => {
    const snapshot = path => ({
        id: path.split('/').at(-1),
        exists: mockDocs.has(path),
        data: () => mockDocs.get(path),
    })
    const doc = path => ({
        id: path.split('/').at(-1),
        get: async () => snapshot(path),
        set: async data => mockDocs.set(path, { ...(mockDocs.get(path) || {}), ...data }),
    })
    const notFound = () => Object.assign(new Error('no user'), { code: 'auth/user-not-found' })
    return {
        firestore: () => ({
            doc,
            collection: name => ({
                doc: id => doc(`${name}/${id}`),
                where: (field, _, value) => ({
                    limit: () => ({
                        get: async () => {
                            const docs = [...mockDocs.keys()]
                                .filter(key => key.startsWith(`${name}/`) && mockDocs.get(key)[field] === value)
                                .map(snapshot)
                            return { empty: docs.length === 0, size: docs.length, docs }
                        },
                    }),
                }),
            }),
        }),
        auth: () => ({
            getUser: async uid => {
                if (!mockAuthUsers[uid]) throw notFound()
                return { uid, ...mockAuthUsers[uid] }
            },
            getUserByEmail: async email => {
                const entry = Object.entries(mockAuthUsers).find(([, user]) => user.email === email)
                if (!entry) throw notFound()
                return { uid: entry[0], ...entry[1] }
            },
        }),
    }
})
jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: () => ({ MENUBAR_APP_WEBHOOK_SECRET: 'secret' }) }))
jest.mock('../Gold/goldHelper', () => ({ deductGold: mockDeductGold, refundGold: jest.fn() }))

const { handleMenubarSession, handleMenubarGoldWebhook, getAlldoneTeamMcpToken } = require('./menubarApp')
const { __private__: verifiedEmail } = require('../shared/verifiedAccountEmail')

const TOKEN = `adapp_${'a'.repeat(64)}`

const response = () => {
    const res = { statusCode: 200, body: null }
    res.set = () => res
    res.status = code => {
        res.statusCode = code
        return res
    }
    res.json = body => {
        res.body = body
        return res
    }
    return res
}

const signedGoldRequest = body => {
    const rawBody = JSON.stringify(body)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = crypto.createHmac('sha256', 'secret').update(`${timestamp}.${rawBody}`).digest('hex')
    return {
        method: 'POST',
        headers: { 'x-alldone-timestamp': timestamp, 'x-alldone-signature': signature },
        body,
        rawBody: Buffer.from(rawBody),
        ip: '203.0.113.1',
    }
}

beforeEach(() => {
    mockDocs.clear()
    Object.keys(mockAuthUsers).forEach(uid => delete mockAuthUsers[uid])
    mockDeductGold.mockClear()
    verifiedEmail.clearCache()

    // The attacker wrote the victim's address into its own user document.
    mockAuthUsers.attacker = { email: 'attacker@example.com', emailVerified: true }
    mockAuthUsers.victim = { email: 'victim@example.com', emailVerified: true }
    mockDocs.set('users/attacker', { email: 'victim@example.com', name: 'Mallory', gold: 5 })
    mockDocs.set('users/victim', { email: 'victim@example.com', name: 'Victim', gold: 100 })
    const tokenHash = crypto.createHash('sha256').update(TOKEN).digest('hex')
    mockDocs.set(`menubarAppTokens/${tokenHash}`, { userId: 'attacker', revoked: false, lastUsedAt: null })
})

test('a menubar session reports the verified Auth email, not the document field', async () => {
    const res = response()
    await handleMenubarSession({ method: 'POST', body: { token: TOKEN }, headers: {}, ip: '203.0.113.1' }, res)

    expect(res.body).toEqual({
        valid: true,
        email: 'attacker@example.com',
        name: 'Mallory',
        gold: 5,
        accountId: 'attacker',
        appId: 'anna-menubar',
    })
})

test('a session for an account without a verified email names no address', async () => {
    mockAuthUsers.attacker.emailVerified = false
    const res = response()
    await handleMenubarSession({ method: 'POST', body: { token: TOKEN }, headers: {}, ip: '203.0.113.1' }, res)

    expect(res.body).toMatchObject({ valid: true, email: '' })
})

test('Gold is charged to the account that owns the address in Auth', async () => {
    // A users query on the email field matches the attacker's document first (it was written first).
    const res = response()
    await handleMenubarGoldWebhook(
        signedGoldRequest({ type: 'DEDUCT_GOLD', userEmail: 'victim@example.com', amount: 10 }),
        res
    )

    expect(res.body).toEqual({ success: true, newBalance: 90 })
    expect(mockDeductGold).toHaveBeenCalledTimes(1)
    expect(mockDeductGold.mock.calls[0][0]).toBe('victim')
})

test('Gold for an address no verified account owns is refused', async () => {
    const res = response()
    await handleMenubarGoldWebhook(
        signedGoldRequest({ type: 'DEDUCT_GOLD', userEmail: 'nobody@example.com', amount: 10 }),
        res
    )

    expect(res.body).toEqual({ success: false, error: 'User not found' })
    expect(mockDeductGold).not.toHaveBeenCalled()
})

describe('tokens for alldone.team/mcp', () => {
    const session = async token => {
        const res = response()
        await handleMenubarSession({ method: 'POST', body: { token }, headers: {}, ip: '203.0.113.9' }, res)
        return res.body
    }

    test('are minted for the account, name their app and are reused while they last', async () => {
        const token = await getAlldoneTeamMcpToken('victim')
        expect(token).toMatch(/^adapp_[a-f0-9]{64}$/)
        expect(await getAlldoneTeamMcpToken('victim')).toBe(token)
        const stored = mockDocs.get(`menubarAppTokens/${crypto.createHash('sha256').update(token).digest('hex')}`)
        expect(stored).toMatchObject({ userId: 'victim', appId: 'alldone-team-mcp', revoked: false })
        expect(stored.expiresAt.toMillis()).toBeGreaterThan(Date.now() + 50 * 60 * 1000)
        expect(await session(token)).toMatchObject({
            valid: true,
            email: 'victim@example.com',
            accountId: 'victim',
            appId: 'alldone-team-mcp',
        })
    })

    test('stop counting once they expire', async () => {
        const token = `adapp_${'b'.repeat(64)}`
        const { Timestamp } = require('firebase-admin/firestore')
        mockDocs.set(`menubarAppTokens/${crypto.createHash('sha256').update(token).digest('hex')}`, {
            userId: 'victim',
            appId: 'alldone-team-mcp',
            revoked: false,
            expiresAt: Timestamp.fromMillis(Date.now() - 1000),
        })
        expect(await session(token)).toEqual({ valid: false })
    })

    test('are not minted for an account without a verified email', async () => {
        mockAuthUsers.victim.emailVerified = false
        await expect(getAlldoneTeamMcpToken('victim-unverified')).rejects.toThrow(/verified account email/)
    })
})
