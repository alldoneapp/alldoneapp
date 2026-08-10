/**
 * Decides whether a failure seen during the login/startup flow means the authentication itself is
 * invalid (sign the user out) or is "just" a data/loading problem (keep the session).
 *
 * Background: the login path used to sign the user out on ANY error thrown while loading initial
 * data. A single malformed project payload therefore ended a perfectly valid session, and every
 * follow-up Firestore read then failed with `Missing or insufficient permissions` — which looks
 * like an auth problem in the logs but is only the consequence of the sign-out.
 */

/**
 * Only explicit "this credential is not valid any more" conditions. Everything else (network
 * errors, Firestore `permission-denied`/`unavailable`, malformed data, bugs) must NOT sign out.
 *
 * `permission-denied` is deliberately absent: it is transient while the ID token is being
 * refreshed, and it is exactly the error that floods the console *after* an unwanted sign-out.
 */
export const INVALID_AUTH_ERROR_CODES = [
    'auth/user-token-expired',
    'auth/user-disabled',
    'auth/user-not-found',
    'auth/invalid-user-token',
    'auth/user-signed-out',
    'auth/invalid-credential',
    'auth/invalid-auth-event',
    'auth/token-expired',
    'auth/id-token-expired',
    'auth/id-token-revoked',
    'auth/session-cookie-expired',
    'auth/session-cookie-revoked',
]

export function getErrorCode(error) {
    if (!error) return ''
    if (typeof error === 'string') return error
    return typeof error.code === 'string' ? error.code : ''
}

/**
 * True only for an explicitly invalid/revoked authentication.
 */
export function isInvalidAuthenticationError(error) {
    const code = getErrorCode(error).toLowerCase()
    if (!code) return false
    return INVALID_AUTH_ERROR_CODES.includes(code)
}

export const LOGIN_FAILURE_ACTIONS = {
    SIGN_OUT: 'sign-out',
    KEEP_SESSION: 'keep-session',
}

/**
 * Single decision point used by the login flow.
 */
export function resolveLoginFailureAction(error) {
    return isInvalidAuthenticationError(error) ? LOGIN_FAILURE_ACTIONS.SIGN_OUT : LOGIN_FAILURE_ACTIONS.KEEP_SESSION
}

/**
 * Compact, log-friendly description of a startup failure (the raw error is logged next to it).
 */
export function describeLoginError(error) {
    if (!error) return { name: 'UnknownError', code: '', message: 'Unknown error' }

    if (typeof error === 'string') return { name: 'Error', code: '', message: error }

    return {
        name: error.name || 'Error',
        code: getErrorCode(error),
        message: error.message || 'Unknown error',
        // First frames only — enough to locate the throwing module without flooding the console.
        stack: typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 5).join('\n') : undefined,
    }
}
