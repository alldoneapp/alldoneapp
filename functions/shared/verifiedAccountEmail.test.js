'use strict'

const fs = require('fs')
const path = require('path')
const { getVerifiedAccountEmail, findUserIdByVerifiedEmail, __private__ } = require('./verifiedAccountEmail')

const authWith = (users, { failWith = null } = {}) => {
    const notFound = () => Object.assign(new Error('no user'), { code: 'auth/user-not-found' })
    return {
        getUser: jest.fn(async uid => {
            if (failWith) throw failWith
            if (!users[uid]) throw notFound()
            return { uid, ...users[uid] }
        }),
        getUserByEmail: jest.fn(async email => {
            if (failWith) throw failWith
            const entry = Object.entries(users).find(([, user]) => (user.email || '').toLowerCase() === email)
            if (!entry) throw notFound()
            return { uid: entry[0], ...entry[1] }
        }),
    }
}

beforeEach(() => {
    __private__.clearCache()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    console.warn.mockRestore()
})

describe('getVerifiedAccountEmail', () => {
    test('returns the verified login email from Auth, normalized', async () => {
        const auth = authWith({ owner: { email: ' Owner@Example.com ', emailVerified: true } })
        await expect(getVerifiedAccountEmail('owner', { auth })).resolves.toBe('owner@example.com')
    })

    test.each([
        ['unverified', { email: 'owner@example.com', emailVerified: false }],
        ['disabled', { email: 'owner@example.com', emailVerified: true, disabled: true }],
        ['anonymous', { emailVerified: false }],
    ])('returns nothing for an %s account', async (_, record) => {
        const auth = authWith({ owner: record })
        await expect(getVerifiedAccountEmail('owner', { auth })).resolves.toBe('')
    })

    test('returns nothing for an unknown or empty user id', async () => {
        const auth = authWith({})
        await expect(getVerifiedAccountEmail('missing', { auth })).resolves.toBe('')
        await expect(getVerifiedAccountEmail('', { auth })).resolves.toBe('')
        expect(auth.getUser).toHaveBeenCalledTimes(1)
    })

    test('caches an answer but retries after a failed lookup', async () => {
        const failing = authWith({}, { failWith: new Error('auth unavailable') })
        await expect(getVerifiedAccountEmail('owner', { auth: failing, now: 0 })).resolves.toBe('')

        const auth = authWith({ owner: { email: 'owner@example.com', emailVerified: true } })
        await expect(getVerifiedAccountEmail('owner', { auth, now: 1 })).resolves.toBe('owner@example.com')
        await expect(getVerifiedAccountEmail('owner', { auth, now: 2 })).resolves.toBe('owner@example.com')
        expect(auth.getUser).toHaveBeenCalledTimes(1)
    })
})

describe('findUserIdByVerifiedEmail', () => {
    test('finds the account whose verified login email this is', async () => {
        const auth = authWith({ owner: { email: 'owner@example.com', emailVerified: true } })
        await expect(findUserIdByVerifiedEmail(' OWNER@example.com', { auth })).resolves.toBe('owner')
    })

    test('ignores an unverified or disabled account and an unknown address', async () => {
        const auth = authWith({
            unverified: { email: 'a@example.com', emailVerified: false },
            disabled: { email: 'b@example.com', emailVerified: true, disabled: true },
        })
        await expect(findUserIdByVerifiedEmail('a@example.com', { auth })).resolves.toBeNull()
        await expect(findUserIdByVerifiedEmail('b@example.com', { auth })).resolves.toBeNull()
        await expect(findUserIdByVerifiedEmail('c@example.com', { auth })).resolves.toBeNull()
        await expect(findUserIdByVerifiedEmail('', { auth })).resolves.toBeNull()
    })

    test('lets an outage surface instead of answering "unknown address"', async () => {
        const auth = authWith({}, { failWith: new Error('auth unavailable') })
        await expect(findUserIdByVerifiedEmail('owner@example.com', { auth })).rejects.toThrow('auth unavailable')
    })
})

// The address alldone.app hands to alldone.team is an identity. These call sites used to read
// users/{uid}.email (and notificationEmail), which the owner can overwrite; a mock-based test
// of their callers would need half the assistant stack, so the source is pinned instead.
describe('identity call sites', () => {
    const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')

    const functionBody = (source, signature) => {
        const start = source.indexOf(signature)
        expect(start).toBeGreaterThan(-1)
        const nextFunction = source.indexOf('\nasync function ', start + signature.length)
        const nextSyncFunction = source.indexOf('\nfunction ', start + signature.length)
        const ends = [nextFunction, nextSyncFunction].filter(index => index > -1)
        return source.slice(start, ends.length ? Math.min(...ends) : undefined)
    }

    test('external tools send the verified Auth email and nothing from the user document', () => {
        const source = read('Assistant/assistantHelper.js')
        const identity = functionBody(source, 'async function getExternalToolUserIdentity(')
        expect(identity).toContain('getVerifiedAccountEmail(')
        expect(identity).not.toMatch(/users\/|userData|notificationEmail/)
        expect(source).not.toContain('userIdentity.notificationEmail')
    })

    test('the menubar token, session and Gold webhook resolve accounts through Auth', () => {
        const source = read('MenubarApp/menubarApp.js')
        for (const signature of [
            'async function mintMenubarAppToken(',
            'async function resolveTokenSession(',
            'async function findUserByEmail(',
        ]) {
            expect(functionBody(source, signature)).not.toMatch(/userData\.email|where\('email'/)
        }
        expect(functionBody(source, 'async function resolveTokenSession(')).toContain('getVerifiedAccountEmail(')
        expect(functionBody(source, 'async function findUserByEmail(')).toContain('findUserIdByVerifiedEmail(')
    })
})
