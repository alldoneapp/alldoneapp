'use strict'

// Thrown when the connected email account's OAuth token is expired/revoked and
// we cannot recover it. The callable layer maps this to a typed HttpsError so the
// client can show a "Reconnect email" state instead of a generic failure.
class EmailLineAuthError extends Error {
    constructor(message = 'Email authentication expired') {
        super(message)
        this.name = 'EmailLineAuthError'
        this.code = 'EMAIL_AUTH_EXPIRED'
    }
}

const AUTH_ERROR_SIGNATURES = [
    'invalid_grant',
    'invalid credentials',
    'invalid authentication',
    'no refresh token',
    'no credentials',
    'token has been expired or revoked',
    'invalidauthenticationtoken',
    'access token has expired',
    'unauthenticated',
    'unauthorized',
    // Raised when the token document is missing or has been flagged invalid. Without these
    // the message fell through to a generic `internal` error, so the client never learned it
    // had to offer a reconnect (AT-2195).
    'not authenticated with google',
    'not authenticated with microsoft',
    'please reconnect',
    'refresh token is missing',
]

function isAuthError(error) {
    if (!error) return false
    if (error instanceof EmailLineAuthError) return true
    if (error.code === 401 || error.status === 401 || error.code === 'EMAIL_AUTH_EXPIRED') return true
    if (error.reconnectRequired === true) return true
    const message = String(error.message || '').toLowerCase()
    return AUTH_ERROR_SIGNATURES.some(signature => message.includes(signature))
}

module.exports = {
    EmailLineAuthError,
    isAuthError,
}
