import {
    LOGIN_FAILURE_ACTIONS,
    describeLoginError,
    getErrorCode,
    isInvalidAuthenticationError,
    resolveLoginFailureAction,
} from '../../../utils/Auth/authErrorHelper'

const firebaseError = (code, message = 'boom') => {
    const error = new Error(message)
    error.code = code
    error.name = 'FirebaseError'
    return error
}

describe('isInvalidAuthenticationError', () => {
    it('is true for explicitly invalid or revoked credentials', () => {
        ;['auth/user-token-expired', 'auth/user-disabled', 'auth/user-not-found', 'auth/invalid-user-token'].forEach(
            code => {
                expect(isInvalidAuthenticationError(firebaseError(code))).toBe(true)
            }
        )
    })

    it('is case insensitive', () => {
        expect(isInvalidAuthenticationError(firebaseError('AUTH/USER-DISABLED'))).toBe(true)
    })

    // The reported incident: a TypeError while mapping startup data signed the user out, and the
    // resulting permission errors then looked like the cause.
    it('is false for data, network and permission failures', () => {
        expect(isInvalidAuthenticationError(new TypeError("Cannot set properties of null (setting 'index')"))).toBe(
            false
        )
        expect(isInvalidAuthenticationError(firebaseError('permission-denied'))).toBe(false)
        expect(isInvalidAuthenticationError(firebaseError('unavailable'))).toBe(false)
        expect(isInvalidAuthenticationError(firebaseError('auth/network-request-failed'))).toBe(false)
        expect(isInvalidAuthenticationError(firebaseError('auth/quota-exceeded'))).toBe(false)
        expect(isInvalidAuthenticationError(null)).toBe(false)
        expect(isInvalidAuthenticationError(undefined)).toBe(false)
        expect(isInvalidAuthenticationError({})).toBe(false)
    })
})

describe('resolveLoginFailureAction', () => {
    it('keeps the session for a generic initial-data failure', () => {
        expect(resolveLoginFailureAction(new TypeError('null project'))).toBe(LOGIN_FAILURE_ACTIONS.KEEP_SESSION)
        expect(resolveLoginFailureAction(firebaseError('permission-denied'))).toBe(LOGIN_FAILURE_ACTIONS.KEEP_SESSION)
    })

    it('signs out only when the authentication itself is invalid', () => {
        expect(resolveLoginFailureAction(firebaseError('auth/user-token-expired'))).toBe(LOGIN_FAILURE_ACTIONS.SIGN_OUT)
    })
})

describe('getErrorCode', () => {
    it('reads the firebase error code and tolerates other shapes', () => {
        expect(getErrorCode(firebaseError('auth/user-disabled'))).toBe('auth/user-disabled')
        expect(getErrorCode('auth/user-disabled')).toBe('auth/user-disabled')
        expect(getErrorCode(new Error('no code'))).toBe('')
        expect(getErrorCode(null)).toBe('')
    })
})

describe('describeLoginError', () => {
    it('summarizes a firebase error', () => {
        const details = describeLoginError(firebaseError('auth/user-disabled', 'The user is disabled'))

        expect(details.code).toBe('auth/user-disabled')
        expect(details.name).toBe('FirebaseError')
        expect(details.message).toBe('The user is disabled')
    })

    it('truncates the stack and handles unknown errors', () => {
        const error = new Error('deep')
        error.stack = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')

        expect(describeLoginError(error).stack.split('\n')).toHaveLength(5)
        expect(describeLoginError(null).message).toBe('Unknown error')
        expect(describeLoginError('plain string').message).toBe('plain string')
    })
})
