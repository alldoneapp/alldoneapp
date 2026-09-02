'use strict'

// AT-2195 regression suite for the Google OAuth token layer.
//
// The bug: getAccessToken handed the stored credentials to google-auth-library and let
// `oauth2Client.getAccessToken()` decide whether to refresh. That method refreshes only when
// `expiry_date` is set AND past — a document with no `tokenExpiry` reads as "never expires",
// so the long-dead access token went to Gmail, Gmail answered 401, and archiving an email
// reported EMAIL_AUTH_EXPIRED forever. No refresh was attempted, so no invalid_grant ever
// surfaced to flag the connection for reconnect either.

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
        fromDate: jest.fn(date => ({ toMillis: () => date.getTime() })),
    },
}))

jest.mock('../envFunctionsHelper.js', () => ({
    getEnvFunctions: jest.fn(() => ({
        GOOGLE_OAUTH_CLIENT_ID: 'client-id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    })),
}))

// Refresh behaviour is swapped per test. It receives the credentials the handler set and
// returns the credentials Google would answer with (or throws).
let refreshImplementation = async () => ({ access_token: 'fresh-token', expiry_date: Date.now() + 3600 * 1000 })
const oauth2Clients = []

class MockOAuth2Client {
    constructor() {
        this.credentials = {}
        this.listeners = {}
        this.setCredentials = jest.fn(credentials => {
            this.credentials = { ...credentials }
        })
        this.getAccessToken = jest.fn(async () => {
            const refreshed = await refreshImplementation(this.credentials)
            this.credentials = { ...this.credentials, ...refreshed }
            return { token: this.credentials.access_token }
        })
        this.on = jest.fn((event, callback) => {
            this.listeners[event] = callback
        })
        oauth2Clients.push(this)
    }
    emit(event, payload) {
        if (this.listeners[event]) this.listeners[event](payload)
    }
}

jest.mock('googleapis', () => ({
    google: { auth: { OAuth2: jest.fn(() => new MockOAuth2Client()) } },
}))

const {
    getAccessToken,
    getAuthorizedOAuth2Client,
    GoogleAuthRevokedError,
    __private__,
} = require('./googleOAuthHandler')

const CONNECTION_ID = 'email_google_e0d5b4af' // = buildConnectionId('email', 'google', 'karsten@alldone.app')
const USER_ID = 'user-1'
const TOKEN_PATH = `users/${USER_ID}/private/googleAuth_${CONNECTION_ID}`
const HOUR = 60 * 60 * 1000

const seedToken = (overrides = {}) => {
    docStore.set(TOKEN_PATH, {
        accessToken: 'stored-token',
        refreshToken: 'stored-refresh-token',
        email: 'karsten@alldone.app',
        scopes: ['https://www.googleapis.com/auth/gmail.modify'],
        connectionId: CONNECTION_ID,
        service: 'gmail',
        ...overrides,
    })
}

const seedUser = (data = {}) => {
    docStore.set(`users/${USER_ID}`, data)
}

const invalidGrantError = () => {
    const error = new Error('invalid_grant')
    error.response = { data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }
    return error
}

beforeEach(() => {
    jest.clearAllMocks()
    docStore.clear()
    recordedUpdates.length = 0
    oauth2Clients.length = 0
    refreshImplementation = async () => ({ access_token: 'fresh-token', expiry_date: Date.now() + HOUR })
    seedUser({ emailConnections: { [CONNECTION_ID]: { provider: 'google', emailAddress: 'karsten@alldone.app' } } })
})

describe('shouldRefreshStoredToken', () => {
    const { shouldRefreshStoredToken, TOKEN_EXPIRY_SKEW_MS } = __private__

    // The exact production state that broke archiving.
    it('treats a missing expiry as expired instead of "never expires"', () => {
        expect(shouldRefreshStoredToken({ accessToken: 'a' })).toBe(true)
        expect(shouldRefreshStoredToken({ accessToken: 'a', tokenExpiry: null })).toBe(true)
    })

    it('refreshes an expired token and one inside the safety skew', () => {
        const expired = { accessToken: 'a', tokenExpiry: { toMillis: () => Date.now() - 1000 } }
        const nearlyExpired = {
            accessToken: 'a',
            tokenExpiry: { toMillis: () => Date.now() + TOKEN_EXPIRY_SKEW_MS - 1000 },
        }
        expect(shouldRefreshStoredToken(expired)).toBe(true)
        expect(shouldRefreshStoredToken(nearlyExpired)).toBe(true)
    })

    it('keeps a comfortably fresh token', () => {
        expect(shouldRefreshStoredToken({ accessToken: 'a', tokenExpiry: { toMillis: () => Date.now() + HOUR } })).toBe(
            false
        )
    })

    it('always refreshes when forced, and when no access token is stored', () => {
        const fresh = { accessToken: 'a', tokenExpiry: { toMillis: () => Date.now() + HOUR } }
        expect(shouldRefreshStoredToken(fresh, { forceRefresh: true })).toBe(true)
        expect(shouldRefreshStoredToken({ tokenExpiry: { toMillis: () => Date.now() + HOUR } })).toBe(true)
    })

    it('reads legacy numeric and Date expiries', () => {
        const { getStoredTokenExpiryMillis } = __private__
        expect(getStoredTokenExpiryMillis({ tokenExpiry: 1700000000000 })).toBe(1700000000000)
        expect(getStoredTokenExpiryMillis({ tokenExpiry: new Date(1700000000000) })).toBe(1700000000000)
        expect(getStoredTokenExpiryMillis({ tokenExpiry: null })).toBeNull()
    })
})

describe('getAccessToken refresh behaviour', () => {
    it('refreshes a token document that has no expiry (AT-2195 root cause)', async () => {
        seedToken({ tokenExpiry: null })

        const token = await getAccessToken(USER_ID, CONNECTION_ID, 'gmail')

        expect(token).toBe('fresh-token')
        const stored = docStore.get(TOKEN_PATH)
        expect(stored.accessToken).toBe('fresh-token')
        // Storing no expiry is what suppressed refresh forever; one must always be written.
        expect(stored.tokenExpiry).toBeTruthy()
        expect(stored.tokenExpiry.toMillis()).toBeGreaterThan(Date.now())
    })

    it('refreshes an expired token', async () => {
        seedToken({ tokenExpiry: { toMillis: () => Date.now() - HOUR } })

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'gmail')).resolves.toBe('fresh-token')
        expect(docStore.get(TOKEN_PATH).accessToken).toBe('fresh-token')
    })

    it('reuses a fresh token without calling Google', async () => {
        seedToken({ tokenExpiry: { toMillis: () => Date.now() + HOUR } })

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'gmail')).resolves.toBe('stored-token')
        expect(oauth2Clients).toHaveLength(0)
        // Only the lastUsed bookkeeping write.
        expect(recordedUpdates).toHaveLength(1)
        expect(Object.keys(recordedUpdates[0].update)).toEqual(['lastUsed'])
    })

    it('forces a refresh when asked, even for a fresh token', async () => {
        seedToken({ tokenExpiry: { toMillis: () => Date.now() + HOUR } })

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'gmail', { forceRefresh: true })).resolves.toBe(
            'fresh-token'
        )
    })

    it('refreshes using only the refresh token, so the library cannot skip the refresh', async () => {
        seedToken({ tokenExpiry: null })

        await getAccessToken(USER_ID, CONNECTION_ID, 'gmail')

        expect(oauth2Clients[0].setCredentials).toHaveBeenCalledWith({ refresh_token: 'stored-refresh-token' })
    })

    it('persists a rotated refresh token', async () => {
        seedToken({ tokenExpiry: null })
        refreshImplementation = async () => ({
            access_token: 'fresh-token',
            refresh_token: 'rotated-refresh-token',
            expiry_date: Date.now() + HOUR,
        })

        await getAccessToken(USER_ID, CONNECTION_ID, 'gmail')

        expect(docStore.get(TOKEN_PATH).refreshToken).toBe('rotated-refresh-token')
    })

    it('falls back to a one-hour expiry when Google returns none', async () => {
        seedToken({ tokenExpiry: null })
        refreshImplementation = async () => ({ access_token: 'fresh-token' })

        await getAccessToken(USER_ID, CONNECTION_ID, 'gmail')

        expect(docStore.get(TOKEN_PATH).tokenExpiry.toMillis()).toBeGreaterThan(Date.now())
    })
})

describe('dead refresh token handling', () => {
    it('keeps the document, wipes the secrets and flags the connection on invalid_grant', async () => {
        seedToken({ tokenExpiry: null })
        refreshImplementation = async () => {
            throw invalidGrantError()
        }

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'gmail')).rejects.toBeInstanceOf(GoogleAuthRevokedError)

        const stored = docStore.get(TOKEN_PATH)
        // Kept: the reconnect UI reads the account email off this document.
        expect(stored).toBeDefined()
        expect(stored.email).toBe('karsten@alldone.app')
        expect(stored.authInvalid).toBe(true)
        expect(stored.authInvalidAt).toBeTruthy()
        // No dead secret retained.
        expect(stored.refreshToken).toBeUndefined()
        expect(stored.accessToken).toBeUndefined()
        expect(stored.tokenExpiry).toBeUndefined()

        const userUpdate = recordedUpdates.find(entry => entry.path === `users/${USER_ID}`)
        expect(userUpdate.update).toEqual({ [`emailConnections.${CONNECTION_ID}.authInvalid`]: true })
    })

    it('raises a typed EMAIL_AUTH_EXPIRED the email line maps to a reconnect state', async () => {
        seedToken({ tokenExpiry: null })
        refreshImplementation = async () => {
            throw invalidGrantError()
        }

        const error = await getAccessToken(USER_ID, CONNECTION_ID, 'gmail').catch(caught => caught)
        expect(error.code).toBe('EMAIL_AUTH_EXPIRED')
        expect(error.reconnectRequired).toBe(true)

        const { isAuthError } = require('../Email/emailLine/emailLineErrors')
        expect(isAuthError(error)).toBe(true)
    })

    it('fails fast on an already-flagged document without calling Google again', async () => {
        seedToken({ authInvalid: true, refreshToken: undefined, accessToken: undefined })

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'gmail')).rejects.toBeInstanceOf(GoogleAuthRevokedError)
        expect(oauth2Clients).toHaveLength(0)
    })

    it('flags the connection when no refresh token was ever stored', async () => {
        seedToken({ tokenExpiry: null, refreshToken: undefined })

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'gmail')).rejects.toBeInstanceOf(GoogleAuthRevokedError)
        expect(docStore.get(TOKEN_PATH).authInvalid).toBe(true)
        expect(oauth2Clients).toHaveLength(0)
    })

    // Guard-rail: one bad client secret or a Google outage must not disconnect every account.
    it('keeps credentials intact when the refresh fails for any reason other than invalid_grant', async () => {
        seedToken({ tokenExpiry: null })
        refreshImplementation = async () => {
            const error = new Error('unauthorized_client')
            error.response = { data: { error: 'invalid_client' }, status: 401 }
            throw error
        }

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'gmail')).rejects.toThrow('unauthorized_client')

        const stored = docStore.get(TOKEN_PATH)
        expect(stored.refreshToken).toBe('stored-refresh-token')
        expect(stored.authInvalid).toBeUndefined()
        expect(recordedUpdates.find(entry => entry.path === `users/${USER_ID}`)).toBeUndefined()
    })

    it('materializes the connections map for pre-migration users instead of shadowing them', async () => {
        // No emailConnections map yet: the account exists only in the legacy apisConnected
        // shape, and two projects point at two different accounts.
        seedUser({
            apisConnected: {
                'project-a': { email: true, emailProvider: 'google', emailAddress: 'karsten@alldone.app' },
                'project-b': { email: true, emailProvider: 'google', emailAddress: 'other@alldone.app' },
            },
        })
        seedToken({ tokenExpiry: null })
        refreshImplementation = async () => {
            throw invalidGrantError()
        }

        await expect(getAccessToken(USER_ID, CONNECTION_ID, 'gmail')).rejects.toBeInstanceOf(GoogleAuthRevokedError)

        const userUpdate = recordedUpdates.find(entry => entry.path === `users/${USER_ID}`)
        const writtenMap = userUpdate.update.emailConnections
        // Writing a single nested field would have left a one-entry map that hides the
        // second account entirely; the whole map is written instead.
        expect(Object.keys(writtenMap)).toHaveLength(2)
        expect(writtenMap[CONNECTION_ID].authInvalid).toBe(true)
        expect(Object.values(writtenMap).filter(entry => entry.authInvalid !== true)).toHaveLength(1)
    })
})

// The token document now survives a revocation, so anything that used to infer "connected"
// from the document merely existing has to check the flag instead.
describe('credential status after a revocation', () => {
    const { hasValidCredentials, getCredentialStatus } = require('./googleOAuthHandler')

    it('reports a healthy connection as connected', async () => {
        seedToken({ tokenExpiry: { toMillis: () => Date.now() + HOUR } })

        await expect(hasValidCredentials(USER_ID, CONNECTION_ID, 'gmail')).resolves.toBe(true)
        await expect(getCredentialStatus(USER_ID, CONNECTION_ID, 'gmail')).resolves.toMatchObject({
            hasCredentials: true,
            email: 'karsten@alldone.app',
            hasModifyScope: true,
        })
    })

    it('does not report a flagged connection as connected', async () => {
        seedToken({ authInvalid: true, accessToken: undefined, refreshToken: undefined, tokenExpiry: undefined })

        await expect(hasValidCredentials(USER_ID, CONNECTION_ID, 'gmail')).resolves.toBe(false)
        await expect(getCredentialStatus(USER_ID, CONNECTION_ID, 'gmail')).resolves.toMatchObject({
            hasCredentials: false,
            authInvalid: true,
            // Still known, so the UI can say which account to reconnect.
            email: 'karsten@alldone.app',
        })
    })
})

describe('getAuthorizedOAuth2Client', () => {
    it('hands the API client full refreshable credentials, not a bare access token', async () => {
        const expiry = Date.now() + HOUR
        seedToken({ tokenExpiry: { toMillis: () => expiry } })

        await getAuthorizedOAuth2Client(USER_ID, CONNECTION_ID, 'gmail')

        // A bare {access_token} client can never recover from a mid-request expiry — that is
        // half of why AT-2195 was terminal rather than transient.
        expect(oauth2Clients[0].setCredentials).toHaveBeenCalledWith({
            access_token: 'stored-token',
            refresh_token: 'stored-refresh-token',
            expiry_date: expiry,
        })
    })

    it('persists a refresh the library performs on its own', async () => {
        seedToken({ tokenExpiry: { toMillis: () => Date.now() + HOUR } })

        const client = await getAuthorizedOAuth2Client(USER_ID, CONNECTION_ID, 'gmail')
        const libraryExpiry = Date.now() + 2 * HOUR
        client.emit('tokens', { access_token: 'library-refreshed', expiry_date: libraryExpiry })
        await Promise.resolve()

        const stored = docStore.get(TOKEN_PATH)
        expect(stored.accessToken).toBe('library-refreshed')
        expect(stored.tokenExpiry.toMillis()).toBe(libraryExpiry)
    })
})
