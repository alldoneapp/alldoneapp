const mockHandleOAuthCallback = jest.fn()
jest.mock('./MCP/auth/cloudOAuth.js', () => ({
    CloudOAuthHandler: jest.fn().mockImplementation(() => ({ handleOAuthCallback: mockHandleOAuthCallback })),
}))
jest.mock('firebase-functions/v2/https', () => ({ onRequest: (_, handler) => handler }))
jest.mock('firebase-admin', () => ({ apps: [{}] }))
const { mcpOAuthCallback } = require('./mcpOAuthCallback')

describe('MCP OAuth callback HTTP endpoint', () => {
    let res, log, errorLog
    const params = {
        sessionId: 'login-test',
        firebaseToken: 'secret-firebase-token',
        authCode: 'auth-test',
        redirectUri: 'https://chatgpt.com/connector/oauth/test',
        state: 'secret-state',
    }
    beforeEach(() => {
        jest.clearAllMocks()
        res = {
            status: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            end: jest.fn(),
        }
        log = jest.spyOn(console, 'log').mockImplementation(() => {})
        errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
        mockHandleOAuthCallback.mockResolvedValue({
            success: true,
            sessionId: 'mcp-session',
            redirect_to: 'https://chatgpt.com/connector/oauth/test?code=auth-test',
        })
    })
    afterEach(() => jest.restoreAllMocks())

    test.each(['POST', 'GET'])('supports %s without logging credentials or callback URLs', async method => {
        await mcpOAuthCallback(
            { method, body: params, query: params, url: '/callback?firebaseToken=secret-firebase-token' },
            res
        )
        expect(mockHandleOAuthCallback).toHaveBeenCalledWith(params.sessionId, params.firebaseToken, {
            authCode: params.authCode,
            redirectUri: params.redirectUri,
            state: params.state,
        })
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ success: true, redirect_to: expect.any(String) })
        )
        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Cache-Control': 'no-store' }))
        expect(JSON.stringify([...log.mock.calls, ...errorLog.mock.calls])).not.toMatch(
            /secret-firebase-token|secret-state|auth-test/
        )
    })

    test('accepts the idToken alias in a POST body', async () => {
        const { firebaseToken, ...otherParams } = params
        await mcpOAuthCallback({ method: 'POST', body: { ...otherParams, idToken: firebaseToken } }, res)
        expect(mockHandleOAuthCallback.mock.calls[0][1]).toBe(firebaseToken)
    })

    test('rejected authorizations return a terminal 400 response', async () => {
        mockHandleOAuthCallback.mockResolvedValue({ success: false, error: 'Authorization expired' })
        await mcpOAuthCallback({ method: 'POST', body: params }, res)
        expect(res.status).toHaveBeenCalledWith(400)
    })

    test('temporary storage failures return 503 so the browser can retry', async () => {
        mockHandleOAuthCallback.mockResolvedValue({ success: false, retryable: true, error: 'Temporarily unavailable' })
        await mcpOAuthCallback({ method: 'POST', body: params }, res)
        expect(res.status).toHaveBeenCalledWith(503)
    })

    test('unexpected SDK failures do not leak error messages containing credentials', async () => {
        mockHandleOAuthCallback.mockRejectedValue(new Error('secret-firebase-token'))
        await mcpOAuthCallback({ method: 'POST', body: params }, res)
        expect(res.status).toHaveBeenCalledWith(503)
        expect(JSON.stringify([...errorLog.mock.calls, ...res.json.mock.calls])).not.toContain('secret-firebase-token')
    })
})
