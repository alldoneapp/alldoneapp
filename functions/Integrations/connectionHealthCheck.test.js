'use strict'

// AT-2491. `getCredentialStatus` only re-reads the stored `authInvalid` flag, and that flag
// is written only when something actually TRIED to use the account — so an account nobody
// has touched since its grant died reads as perfectly healthy. This check asks the provider
// instead, by forcing a token refresh.

jest.mock('firebase-admin', () => ({ firestore: jest.fn(() => ({})) }))

const mockGoogleGetAccessToken = jest.fn()
const mockMicrosoftGetAccessToken = jest.fn()

jest.mock('../GoogleOAuth/googleOAuthHandler', () => ({
    getAccessToken: (...args) => mockGoogleGetAccessToken(...args),
}))
jest.mock('../MicrosoftOAuth/microsoftOAuthHandler', () => ({
    getAccessToken: (...args) => mockMicrosoftGetAccessToken(...args),
}))

const {
    checkConnectionHealth,
    HEALTH_OK,
    HEALTH_RECONNECT_REQUIRED,
    HEALTH_UNKNOWN,
} = require('./connectionHealthCheck')
const { buildConnectionId } = require('./providerConnections')

const USER_ID = 'user-1'
const EMAIL = 'karsten.wysk@gmail.com'
const GOOGLE_EMAIL_ID = buildConnectionId('email', 'google', EMAIL)
const GOOGLE_CALENDAR_ID = buildConnectionId('calendar', 'google', EMAIL)
const MICROSOFT_EMAIL_ID = buildConnectionId('email', 'microsoft', 'person@outlook.com')

function userData({ authInvalid = false, provider = 'google', connectionId = GOOGLE_EMAIL_ID } = {}) {
    const field = connectionId.startsWith('calendar_') ? 'calendarConnections' : 'emailConnections'
    return {
        [field]: {
            [connectionId]: {
                provider,
                emailAddress: provider === 'microsoft' ? 'person@outlook.com' : EMAIL,
                defaultProjectId: 'project-1',
                authInvalid,
            },
        },
    }
}

beforeEach(() => {
    jest.clearAllMocks()
    mockGoogleGetAccessToken.mockResolvedValue('fresh-token')
    mockMicrosoftGetAccessToken.mockResolvedValue('fresh-token')
})

describe('checkConnectionHealth', () => {
    test('reports a working Google account as connected, having actually refreshed', async () => {
        const result = await checkConnectionHealth(USER_ID, GOOGLE_EMAIL_ID, { userData: userData() })

        expect(result.status).toBe(HEALTH_OK)
        expect(result.healthy).toBe(true)
        // forceRefresh is the whole point: an unexpired ACCESS token says nothing about
        // whether the REFRESH token still works, and that is the failure mode.
        expect(mockGoogleGetAccessToken).toHaveBeenCalledWith(USER_ID, GOOGLE_EMAIL_ID, 'gmail', {
            forceRefresh: true,
        })
    })

    test('discovers a dead grant the stored flag did not know about', async () => {
        const revoked = new Error('Google OAuth access was revoked')
        revoked.code = 'EMAIL_AUTH_EXPIRED'
        mockGoogleGetAccessToken.mockRejectedValue(revoked)

        const result = await checkConnectionHealth(USER_ID, GOOGLE_EMAIL_ID, { userData: userData() })

        expect(result.status).toBe(HEALTH_RECONNECT_REQUIRED)
        expect(result.authInvalid).toBe(true)
        expect(result.email).toBe(EMAIL)
    })

    test('answers an already-flagged account from the flag, without a round trip', async () => {
        const result = await checkConnectionHealth(USER_ID, GOOGLE_EMAIL_ID, {
            userData: userData({ authInvalid: true }),
        })

        expect(result.status).toBe(HEALTH_RECONNECT_REQUIRED)
        // A revoked grant cannot be un-revoked by asking again; the refresh would be a
        // guaranteed failed round trip on every page open.
        expect(mockGoogleGetAccessToken).not.toHaveBeenCalled()
    })

    test('a provider outage is UNKNOWN, never "reconnect"', async () => {
        mockGoogleGetAccessToken.mockRejectedValue(new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com'))
        const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})

        const result = await checkConnectionHealth(USER_ID, GOOGLE_EMAIL_ID, { userData: userData() })

        // Telling a user to reconnect a working mailbox because Google was briefly
        // unreachable is worse than saying nothing.
        expect(result.status).toBe(HEALTH_UNKNOWN)
        expect(result.authInvalid).toBe(false)
        consoleWarn.mockRestore()
    })

    test('routes a calendar connection to the calendar service', async () => {
        await checkConnectionHealth(USER_ID, GOOGLE_CALENDAR_ID, {
            userData: userData({ connectionId: GOOGLE_CALENDAR_ID }),
        })

        expect(mockGoogleGetAccessToken).toHaveBeenCalledWith(USER_ID, GOOGLE_CALENDAR_ID, 'calendar', {
            forceRefresh: true,
        })
    })

    test('routes a Microsoft connection to the Microsoft handler', async () => {
        await checkConnectionHealth(USER_ID, MICROSOFT_EMAIL_ID, {
            userData: userData({ provider: 'microsoft', connectionId: MICROSOFT_EMAIL_ID }),
        })

        expect(mockMicrosoftGetAccessToken).toHaveBeenCalledWith(USER_ID, MICROSOFT_EMAIL_ID, 'email', {
            forceRefresh: true,
        })
        expect(mockGoogleGetAccessToken).not.toHaveBeenCalled()
    })

    test('an unknown connection id is unknown, not broken', async () => {
        const result = await checkConnectionHealth(USER_ID, 'email_google_deadbeef', { userData: userData() })

        expect(result.status).toBe(HEALTH_UNKNOWN)
        expect(mockGoogleGetAccessToken).not.toHaveBeenCalled()
    })
})
