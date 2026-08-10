'use strict'

const { isExpiredAccessTokenError, runWithGoogleAuthRetry } = require('./googleAuthRetry')

const makeError = (properties = {}) => Object.assign(new Error('boom'), properties)

describe('isExpiredAccessTokenError', () => {
    it('recognises a 401 in every shape googleapis reports it', () => {
        expect(isExpiredAccessTokenError(makeError({ code: 401 }))).toBe(true)
        expect(isExpiredAccessTokenError(makeError({ status: 401 }))).toBe(true)
        expect(isExpiredAccessTokenError(makeError({ response: { status: 401 } }))).toBe(true)
    })

    it('ignores everything that a token refresh cannot fix', () => {
        expect(isExpiredAccessTokenError(makeError({ code: 403 }))).toBe(false)
        expect(isExpiredAccessTokenError(makeError({ code: 429 }))).toBe(false)
        expect(isExpiredAccessTokenError(makeError({ code: 500 }))).toBe(false)
        expect(isExpiredAccessTokenError(makeError({ code: 'ENOTFOUND' }))).toBe(false)
        expect(isExpiredAccessTokenError(null)).toBe(false)
    })

    // A dead refresh token cannot be recovered by refreshing, so retrying would only spin.
    it('ignores a reconnect-required error even though it is auth-shaped', () => {
        expect(isExpiredAccessTokenError(makeError({ code: 401, reconnectRequired: true }))).toBe(false)
    })
})

describe('runWithGoogleAuthRetry', () => {
    it('does not rebuild the client when the call succeeds', async () => {
        const buildClient = jest.fn(async () => 'client')
        const run = jest.fn(async () => 'ok')

        await expect(runWithGoogleAuthRetry(buildClient, run)).resolves.toBe('ok')

        expect(buildClient).toHaveBeenCalledTimes(1)
        expect(buildClient).toHaveBeenCalledWith(false)
        expect(run).toHaveBeenCalledTimes(1)
    })

    it('rebuilds with a forced refresh and retries once after a 401', async () => {
        const buildClient = jest.fn(async forceRefresh => (forceRefresh ? 'fresh-client' : 'stale-client'))
        const run = jest.fn(async client => {
            if (client === 'stale-client') throw makeError({ code: 401 })
            return 'recovered'
        })

        await expect(runWithGoogleAuthRetry(buildClient, run)).resolves.toBe('recovered')

        expect(buildClient.mock.calls).toEqual([[false], [true]])
        expect(run).toHaveBeenCalledTimes(2)
    })

    // The whole point of a bounded retry: a token that is rejected no matter what must
    // surface, not loop.
    it('retries at most once', async () => {
        const buildClient = jest.fn(async () => 'client')
        const run = jest.fn(async () => {
            throw makeError({ code: 401 })
        })

        await expect(runWithGoogleAuthRetry(buildClient, run)).rejects.toMatchObject({ code: 401 })

        expect(run).toHaveBeenCalledTimes(2)
        expect(buildClient).toHaveBeenCalledTimes(2)
    })

    it('propagates a non-auth failure without retrying', async () => {
        const buildClient = jest.fn(async () => 'client')
        const run = jest.fn(async () => {
            throw makeError({ code: 500 })
        })

        await expect(runWithGoogleAuthRetry(buildClient, run)).rejects.toMatchObject({ code: 500 })

        expect(run).toHaveBeenCalledTimes(1)
        expect(buildClient).toHaveBeenCalledTimes(1)
    })

    it('propagates the reconnect error when the forced refresh finds a dead refresh token', async () => {
        const revoked = makeError({ code: 'EMAIL_AUTH_EXPIRED', reconnectRequired: true })
        const buildClient = jest.fn(async forceRefresh => {
            if (forceRefresh) throw revoked
            return 'stale-client'
        })
        const run = jest.fn(async () => {
            throw makeError({ code: 401 })
        })

        await expect(runWithGoogleAuthRetry(buildClient, run)).rejects.toBe(revoked)

        expect(run).toHaveBeenCalledTimes(1)
    })
})
