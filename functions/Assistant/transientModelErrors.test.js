const {
    APIError,
    APIConnectionError,
    APIConnectionTimeoutError,
    APIUserAbortError,
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    RateLimitError,
} = require('openai')

const { isTransientModelError } = require('./transientModelErrors')

const headers = () => new Headers()

describe('isTransientModelError (AT-2870)', () => {
    test("recognises OpenRouter's lost upstream connection inside a 200 stream, as the SDK throws it", () => {
        const error = new APIError(undefined, { code: 502, message: 'Network connection lost.' })

        expect(error.status).toBeUndefined()
        expect(error.message).toBe('Network connection lost.')
        expect(isTransientModelError(error)).toBe(true)
    })

    test.each([
        ['a rate limit', new RateLimitError(429, { message: 'slow down' }, undefined, headers())],
        ['a 500', new InternalServerError(500, { message: 'oops' }, undefined, headers())],
        ['a 503', new InternalServerError(503, undefined, undefined, headers())],
        ['a Cloudflare 524', new APIError(524, undefined, undefined, headers())],
        ['a connection error', new APIConnectionError({ message: 'Connection error.' })],
        ['a connection timeout', new APIConnectionTimeoutError()],
        ['an undici socket drop', Object.assign(new TypeError('terminated'), { cause: { code: 'UND_ERR_SOCKET' } })],
        ['a reset socket', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })],
        ['a provider overload event', new APIError(undefined, { code: 529, message: 'Overloaded' })],
        ['a code given as a string', Object.assign(new Error('Upstream error'), { code: '503' })],
    ])('treats %s as transient', (_label, error) => {
        expect(isTransientModelError(error)).toBe(true)
    })

    test.each([
        ['a bad request', new BadRequestError(400, { message: 'Network connection lost.' }, undefined, headers())],
        ['an authentication failure', new AuthenticationError(401, { message: 'bad key' }, undefined, headers())],
        ['missing credits mid-stream', new APIError(undefined, { code: 402, message: 'Insufficient credits' })],
        ['an abort', new APIUserAbortError()],
        ['a DOM abort', Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })],
        ['an empty truncated answer', new Error('OpenRouter returned an empty response (finish_reason: length)')],
        ['a generic failure', new Error('model unavailable')],
        ['a Firestore status code', Object.assign(new Error('5 NOT_FOUND: no document'), { code: 5 })],
        ['nothing', null],
    ])('does not treat %s as transient', (_label, error) => {
        expect(isTransientModelError(error)).toBe(false)
    })
})
