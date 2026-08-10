'use strict'

const { EmailLineAuthError, isAuthError } = require('./emailLineErrors')

describe('isAuthError', () => {
    it('matches the typed error and an explicit code', () => {
        expect(isAuthError(new EmailLineAuthError())).toBe(true)
        expect(isAuthError({ code: 'EMAIL_AUTH_EXPIRED' })).toBe(true)
        expect(isAuthError({ code: 401 })).toBe(true)
        expect(isAuthError({ status: 401 })).toBe(true)
    })

    // AT-2195: the reconnect-required errors raised by the Google token layer used to fall
    // through to a generic `internal` HttpsError, so the client never showed a reconnect
    // prompt — it just kept failing.
    it('matches a reconnect-required error from the token layer', () => {
        expect(isAuthError({ reconnectRequired: true, message: 'whatever' })).toBe(true)
    })

    it('matches the messages raised when credentials are missing or dead', () => {
        expect(isAuthError(new Error('User not authenticated with Google for gmail'))).toBe(true)
        expect(isAuthError(new Error('User not authenticated with Microsoft for email'))).toBe(true)
        expect(isAuthError(new Error('Google OAuth token is invalid or revoked. Please reconnect.'))).toBe(true)
        expect(isAuthError(new Error('Google OAuth refresh token is missing. Please reconnect.'))).toBe(true)
        expect(isAuthError(new Error('Microsoft OAuth refresh token is missing. Please reconnect.'))).toBe(true)
    })

    it('still matches the provider-level signatures', () => {
        expect(isAuthError(new Error('invalid_grant'))).toBe(true)
        expect(isAuthError(new Error('Token has been expired or revoked.'))).toBe(true)
        expect(isAuthError(new Error('Invalid Credentials'))).toBe(true)
    })

    // A refresh failure that is our fault must NOT be reported as "reconnect your account".
    it('does not match transient or unrelated failures', () => {
        expect(isAuthError(null)).toBe(false)
        expect(isAuthError(new Error('Rate limit exceeded'))).toBe(false)
        expect(isAuthError({ code: 429, message: 'Too many requests' })).toBe(false)
        expect(isAuthError({ code: 503, message: 'Backend error' })).toBe(false)
        expect(isAuthError(new Error('labelId is required for sweep actions'))).toBe(false)
    })
})
