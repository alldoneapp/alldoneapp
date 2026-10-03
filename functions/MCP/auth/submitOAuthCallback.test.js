const { submitOAuthCallback } = require('./submitOAuthCallback')

describe('MCP callback retry policy', () => {
    const callbackUrl = 'https://my.alldone.app/mcpOAuthCallback'
    const payload = { sessionId: 'login-test', firebaseToken: 'firebase-test', authCode: 'auth-test' }
    let originalFetch
    beforeEach(() => {
        jest.useFakeTimers()
        originalFetch = global.fetch
        global.fetch = jest.fn()
    })
    afterEach(() => {
        global.fetch = originalFetch
        jest.useRealTimers()
    })
    const success = () => ({ ok: true, status: 200, json: async () => ({ success: true }) })

    test.each([502, 503, 504])('retries a temporary HTTP %i without changing the authorization', async status => {
        global.fetch.mockResolvedValueOnce({ status }).mockResolvedValueOnce(success())
        const onRetry = jest.fn()
        const result = submitOAuthCallback(callbackUrl, payload, onRetry)
        await jest.advanceTimersByTimeAsync(1000)
        expect(await result).toEqual({ success: true })
        expect(onRetry).toHaveBeenCalledTimes(1)
        expect(global.fetch.mock.calls[0][1].body).toBe(global.fetch.mock.calls[1][1].body)
    })

    test('aborts a stalled request and retries without leaving timeout timers behind', async () => {
        global.fetch
            .mockImplementationOnce(
                (_, { signal }) =>
                    new Promise((resolve, reject) => {
                        signal.addEventListener('abort', () =>
                            reject(Object.assign(new Error('Timed out'), { name: 'AbortError' }))
                        )
                    })
            )
            .mockResolvedValueOnce(success())
        const result = submitOAuthCallback(callbackUrl, payload)
        await jest.advanceTimersByTimeAsync(16000)
        expect(await result).toEqual({ success: true })
        expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true)
        expect(jest.getTimerCount()).toBe(0)
    })

    test('retries an interrupted response body using the same authorization', async () => {
        global.fetch
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => {
                    throw new TypeError('Failed to fetch')
                },
            })
            .mockResolvedValueOnce(success())
        const result = submitOAuthCallback(callbackUrl, payload)
        await jest.advanceTimersByTimeAsync(1000)
        expect(await result).toEqual({ success: true })
        expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    test('does not retry a malformed JSON response as a network failure', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => {
                throw new SyntaxError('Invalid JSON')
            },
        })
        await expect(submitOAuthCallback(callbackUrl, payload)).rejects.toThrow('Invalid JSON')
        expect(global.fetch).toHaveBeenCalledTimes(1)
        expect(jest.getTimerCount()).toBe(0)
    })
})
