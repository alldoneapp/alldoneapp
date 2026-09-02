'use strict'

// AT-2491. Microsoft's invalid-auth handling was a distant relative of Google's: it never
// flagged its own token document, it threw a plain Error that `isAuthError` could not
// recognise (so a revoked mailbox surfaced as a generic `internal` and the client was never
// offered a reconnect), it matched /AADSTS/i broadly enough to flag a HEALTHY account on a
// transient or our-fault failure, and it re-attempted a refresh token the provider had
// already rejected on every single call. This suite pins the parity.

const mockDeleteSentinel = { __delete__: true }

const docStore = new Map()
const recordedUpdates = []

const makeSnapshot = path => ({
    exists: docStore.has(path),
    data: () => (docStore.has(path) ? { ...docStore.get(path) } : undefined),
})

const applyUpdate = (path, update) => {
    const current = { ...(docStore.get(path) || {}) }
    Object.entries(update).forEach(([key, value]) => {
        if (value === mockDeleteSentinel) delete current[key]
        else current[key] = value
    })
    docStore.set(path, current)
}

const mockMakeDocRef = path => ({
    path,
    get: jest.fn(async () => makeSnapshot(path)),
    set: jest.fn(async (data, options) => {
        if (options && options.merge) applyUpdate(path, data)
        else docStore.set(path, { ...data })
    }),
    update: jest.fn(async update => {
        recordedUpdates.push({ path, update })
        applyUpdate(path, update)
    }),
    delete: jest.fn(async () => {
        docStore.delete(path)
    }),
    collection: jest.fn(name => mockMakeCollectionRef(`${path}/${name}`)),
})

const mockMakeCollectionRef = path => ({
    doc: jest.fn(id => mockMakeDocRef(`${path}/${id}`)),
})

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({ collection: jest.fn(name => mockMakeCollectionRef(name)) })),
    app: jest.fn(() => ({ options: { projectId: 'alldonealeph' } })),
}))

jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { delete: jest.fn(() => mockDeleteSentinel) },
    Timestamp: {
        now: jest.fn(() => ({ toMillis: () => Date.now() })),
        fromMillis: jest.fn(millis => ({ toMillis: () => millis })),
    },
}))

jest.mock('../envFunctionsHelper.js', () => ({
    getEnvFunctions: jest.fn(() => ({
        MICROSOFT_OAUTH_CLIENT_ID: 'client-id',
        MICROSOFT_OAUTH_CLIENT_SECRET: 'client-secret',
    })),
}))

// The token endpoint is reached through global fetch; each test decides what it answers.
let tokenEndpointResponse = () => ({ ok: true, body: { access_token: 'fresh', expires_in: 3600 } })
global.fetch = jest.fn(async () => {
    const { ok, body } = tokenEndpointResponse()
    return { ok, status: ok ? 200 : 400, json: async () => body }
})

const {
    getAccessToken,
    getCredentialStatus,
    MicrosoftAuthRevokedError,
    __private__,
} = require('./microsoftOAuthHandler')
const { isAuthError } = require('../Email/emailLine/emailLineErrors')
const { buildConnectionId } = require('../Integrations/providerConnections')

const { isMicrosoftReconnectRequiredError } = __private__

const USER_ID = 'user-1'
// Derived, not hand-written: the materialization path keys the map by this exact hash, so a
// literal that does not match the seeded address silently produces an empty write.
const CONNECTION_ID = buildConnectionId('email', 'microsoft', 'person@outlook.com')
const TOKEN_PATH = `users/${USER_ID}/private/microsoftAuth_${CONNECTION_ID}`
const USER_PATH = `users/${USER_ID}`

const seedToken = (overrides = {}) => {
    docStore.set(TOKEN_PATH, {
        accessToken: 'stored-token',
        refreshToken: 'stored-refresh-token',
        email: 'person@outlook.com',
        service: 'email',
        connectionId: CONNECTION_ID,
        // Expired, so every call attempts a refresh.
        tokenExpiry: { toMillis: () => Date.now() - 60_000 },
        ...overrides,
    })
}

const seedUser = () => {
    docStore.set(USER_PATH, {
        emailConnections: {
            [CONNECTION_ID]: {
                provider: 'microsoft',
                emailAddress: 'person@outlook.com',
                defaultProjectId: 'project-1',
                isDefaultAccount: true,
                authInvalid: false,
            },
        },
    })
}

const revokedResponse = () => ({
    ok: false,
    body: {
        error: 'invalid_grant',
        error_description: 'AADSTS700082: The refresh token has expired due to inactivity.',
        error_codes: [700082],
    },
})

beforeEach(() => {
    docStore.clear()
    recordedUpdates.length = 0
    jest.clearAllMocks()
    tokenEndpointResponse = () => ({ ok: true, body: { access_token: 'fresh', expires_in: 3600 } })
})

describe('isMicrosoftReconnectRequiredError', () => {
    test('classifies a revoked grant from the structured OAuth code', () => {
        const error = new Error('AADSTS700082: The refresh token has expired due to inactivity.')
        error.oauthError = 'invalid_grant'
        error.oauthErrorCodes = [700082]

        expect(isMicrosoftReconnectRequiredError(error)).toBe(true)
    })

    test('classifies a revoked grant from the AADSTS code alone', () => {
        const error = new Error('Token revoked')
        error.oauthErrorCodes = [50173]

        expect(isMicrosoftReconnectRequiredError(error)).toBe(true)
    })

    test.each([
        ['a wrong client secret (our fault)', 'invalid_client', [7000215]],
        ['a locked account', 'unauthorized_client', [50053]],
        ['throttling', 'temporarily_unavailable', [50196]],
    ])('does NOT disconnect the account for %s', (_label, oauthError, oauthErrorCodes) => {
        // The previous /AADSTS/i catch-all matched all of these. One bad deploy would have
        // flagged every Microsoft account in the product as needing a reconnect.
        const error = new Error(`AADSTS${oauthErrorCodes[0]}: something went wrong`)
        error.oauthError = oauthError
        error.oauthErrorCodes = oauthErrorCodes

        expect(isMicrosoftReconnectRequiredError(error)).toBe(false)
    })

    test('falls back to the protocol token when the response was unparseable', () => {
        expect(isMicrosoftReconnectRequiredError(new Error('invalid_grant'))).toBe(true)
        expect(isMicrosoftReconnectRequiredError(new Error('Microsoft token request failed: 503'))).toBe(false)
        expect(isMicrosoftReconnectRequiredError(null)).toBe(false)
    })
})

describe('dead refresh token handling', () => {
    test('keeps the document, wipes the secrets and flags both the doc and the connection', async () => {
        seedToken()
        seedUser()
        tokenEndpointResponse = revokedResponse

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'email')).rejects.toBeInstanceOf(MicrosoftAuthRevokedError)

        const stored = docStore.get(TOKEN_PATH)
        // Kept: the reconnect UI reads the account email off this document.
        expect(stored.email).toBe('person@outlook.com')
        expect(stored.authInvalid).toBe(true)
        expect(stored.authInvalidAt).toBeTruthy()
        // No dead secret retained.
        expect(stored.refreshToken).toBeUndefined()
        expect(stored.accessToken).toBeUndefined()

        const userUpdate = recordedUpdates.find(entry => entry.path === USER_PATH)
        expect(userUpdate.update[`emailConnections.${CONNECTION_ID}.authInvalid`]).toBe(true)
        expect(userUpdate.update[`emailConnections.${CONNECTION_ID}.authInvalidAt`]).toBeTruthy()
    })

    test('raises an error the email line maps to a reconnect state, not a generic failure', async () => {
        seedToken()
        seedUser()
        tokenEndpointResponse = revokedResponse

        const error = await getAccessToken(USER_ID, CONNECTION_ID, 'email').catch(caught => caught)

        // The whole point: Microsoft's own message ("AADSTS700082: The refresh token has
        // expired due to inactivity") matches none of isAuthError's string signatures, so
        // before AT-2491 this surfaced as `internal` and no reconnect was ever offered.
        expect(isAuthError(error)).toBe(true)
        expect(error.code).toBe('EMAIL_AUTH_EXPIRED')
        expect(error.reconnectRequired).toBe(true)
    })

    test('never re-attempts a refresh token already known to be dead', async () => {
        seedToken({ authInvalid: true, accessToken: undefined, refreshToken: undefined })
        seedUser()

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'email')).rejects.toBeInstanceOf(MicrosoftAuthRevokedError)
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('flags the account when the stored refresh token is missing entirely', async () => {
        seedToken({ refreshToken: undefined })
        seedUser()

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'email')).rejects.toBeInstanceOf(MicrosoftAuthRevokedError)
        expect(docStore.get(TOKEN_PATH).authInvalid).toBe(true)
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('a transient token-endpoint failure leaves the credentials intact', async () => {
        seedToken()
        seedUser()
        tokenEndpointResponse = () => ({
            ok: false,
            body: {
                error: 'temporarily_unavailable',
                error_description: 'AADSTS50196: throttled',
                error_codes: [50196],
            },
        })

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'email')).rejects.not.toBeInstanceOf(
            MicrosoftAuthRevokedError
        )

        const stored = docStore.get(TOKEN_PATH)
        expect(stored.authInvalid).toBeUndefined()
        expect(stored.refreshToken).toBe('stored-refresh-token')
        expect(recordedUpdates.find(entry => entry.path === USER_PATH)).toBeUndefined()
    })

    test('a healthy refresh stores the new token and touches nothing else', async () => {
        seedToken()
        seedUser()

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'email')).resolves.toBe('fresh')
        expect(docStore.get(TOKEN_PATH).authInvalid).toBeUndefined()
    })

    test('materializes the whole map for a pre-migration user instead of shadowing connections', async () => {
        seedToken()
        // No stored emailConnections map: a single nested field write would create a
        // one-entry map that hides every connection living only in apisConnected.
        docStore.set(USER_PATH, {
            apisConnected: {
                'project-1': { email: true, emailProvider: 'microsoft', emailAddress: 'person@outlook.com' },
                'project-2': { gmail: true, gmailEmail: 'other@gmail.com' },
            },
        })
        tokenEndpointResponse = revokedResponse

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'email')).rejects.toBeInstanceOf(MicrosoftAuthRevokedError)

        const written = recordedUpdates.find(entry => entry.path === USER_PATH).update.emailConnections
        expect(Object.keys(written)).toHaveLength(2)
        expect(written[CONNECTION_ID].authInvalid).toBe(true)
        expect(Object.values(written).filter(entry => entry.authInvalid !== true)).toHaveLength(1)
    })
})

describe('getCredentialStatus', () => {
    test('reports a revoked account as unusable while still naming it', async () => {
        seedToken({ authInvalid: true, accessToken: undefined, refreshToken: undefined })

        await expect(getCredentialStatus(USER_ID, CONNECTION_ID, 'email')).resolves.toEqual({
            hasCredentials: false,
            email: 'person@outlook.com',
            scopes: [],
            hasModifyScope: false,
            provider: 'microsoft',
            authInvalid: true,
        })
    })

    test('reports a healthy account as connected', async () => {
        seedToken({ scopes: ['Mail.ReadWrite'] })

        const status = await getCredentialStatus(USER_ID, CONNECTION_ID, 'email')

        expect(status.hasCredentials).toBe(true)
        expect(status.hasModifyScope).toBe(true)
    })
})
