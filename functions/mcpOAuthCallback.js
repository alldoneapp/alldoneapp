const { onRequest } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { CloudOAuthHandler } = require('./MCP/auth/cloudOAuth.js')
const { Timestamp } = require('firebase-admin/firestore')

if (!admin.apps.length) admin.initializeApp()
const oauthHandler = new CloudOAuthHandler()

exports.mcpOAuthCallback = onRequest(
    {
        timeoutSeconds: 300,
        memory: '512MiB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['*'],
            credentials: false,
        },
    },
    async (req, res) => {
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            'Cache-Control': 'no-store',
        })
        if (req.method === 'OPTIONS') {
            res.status(200).end()
            return
        }
        if (req.method !== 'GET' && req.method !== 'POST') {
            res.status(405).json({ success: false, error: 'Method not allowed' })
            return
        }

        // Keep GET for already-open login pages. New pages send tokens in a POST
        // body so they never enter browser history or HTTP request URL logs.
        const params = (req.method === 'POST' ? req.body : req.query) || {}
        const { sessionId, authCode, redirectUri, state } = params
        const firebaseToken = params.firebaseToken || params.idToken
        console.log('MCP OAuth callback', { method: req.method, hasAuthorization: !!authCode })
        if (typeof sessionId !== 'string' || typeof firebaseToken !== 'string' || !sessionId || !firebaseToken) {
            res.status(400).json({ success: false, error: 'Missing required parameters: sessionId and firebaseToken' })
            return
        }

        try {
            const result = await oauthHandler.handleOAuthCallback(sessionId, firebaseToken, {
                authCode,
                redirectUri,
                state,
            })
            if (!result.success) {
                res.status(result.retryable ? 503 : 400).json(result)
                return
            }
            if (authCode) {
                // The handler uses the saved authorization's redirect and state
                // and atomically reuses any session completed by an earlier call.
                res.json({ ...result, message: 'OAuth authorization completed' })
                return
            }

            // Preserve the legacy non-authorization-code authentication flow.
            const decodedToken = await admin.auth().verifyIdToken(firebaseToken)
            await admin
                .firestore()
                .collection('mcpUserAuth')
                .doc(decodedToken.email)
                .set({
                    email: decodedToken.email,
                    userId: result.userId,
                    sessionId: result.sessionId,
                    timestamp: Timestamp.now(),
                    expiresAt: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
                })
            res.json(result)
        } catch (error) {
            // Do not log request URLs, bodies, tokens, or SDK errors containing credentials.
            console.error('MCP OAuth callback failed', { code: error.code || 'internal' })
            res.status(503).json({ success: false, error: 'Authentication temporarily unavailable. Please retry.' })
        }
    }
)
