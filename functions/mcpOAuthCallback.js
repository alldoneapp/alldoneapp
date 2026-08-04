const { onRequest } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { CloudOAuthHandler } = require('./MCP/auth/cloudOAuth.js')
const { Timestamp } = require('firebase-admin/firestore')

// Ensure fetch is available (Node.js 18+ has built-in fetch)
if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch')
}

// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
    admin.initializeApp()
}

const oauthHandler = new CloudOAuthHandler()

// Helper functions for client authentication management!
function getClientId(req) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
    const userAgent = req.headers['user-agent'] || 'unknown'
    const clientId = `${ip}-${userAgent}`.substring(0, 100) // Limit length

    console.log('🔍 Generated client ID:', {
        ip: ip,
        userAgent: userAgent.substring(0, 50) + '...', // Truncate for readability
        clientId: clientId,
    })

    return clientId
}

async function storeUserAuthByEmail(email, userId, sessionId) {
    console.log('💾 storeUserAuthByEmail called with:', {
        email: email,
        userId: userId,
        sessionId: sessionId,
    })

    const db = admin.firestore()
    const authData = {
        email,
        userId,
        sessionId,
        timestamp: Timestamp.now(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), // 30 days
    }

    console.log('📝 Writing user auth data to Firestore:', {
        collection: 'mcpUserAuth',
        docId: email,
        data: {
            ...authData,
            timestamp: authData.timestamp.toDate(),
            expiresAt: authData.expiresAt.toDate(),
        },
    })

    await db.collection('mcpUserAuth').doc(email).set(authData)
    console.log('✅ Successfully stored user auth for email:', email)
}

/**
 * Dedicated Cloud Function for MCP OAuth callbacks
 * This handles the OAuth callback requests from the authentication page
 */
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
        try {
            console.log('🚀 === MCP OAUTH CALLBACK FUNCTION START ===')
            console.log('📨 Request details:', {
                method: req.method,
                url: req.url,
                path: req.path,
                ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
                userAgent: req.headers['user-agent']?.substring(0, 100) || 'unknown',
            })
            console.log('🔍 Query parameters:', req.query)
            console.log('📋 Request body:', req.body)
            console.log('🌐 Request headers:', {
                origin: req.headers.origin,
                referer: req.headers.referer,
                'content-type': req.headers['content-type'],
            })

            // Set CORS headers
            console.log('🌍 Setting CORS headers...')
            res.set({
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400',
            })

            if (req.method === 'OPTIONS') {
                console.log('✈️ OPTIONS preflight request - returning 200')
                res.status(200).end()
                return
            }

            let sessionId, firebaseToken, authCode, redirectUri, state

            if (req.method === 'GET') {
                // Extract parameters from query string
                ;({ sessionId, firebaseToken, authCode, redirectUri, state } = req.query)
                console.log('📥 GET OAuth callback params:', {
                    sessionId: !!sessionId,
                    firebaseToken: !!firebaseToken,
                    authCode: !!authCode,
                    redirectUri: !!redirectUri,
                    state: !!state,
                })
                console.log('Full GET params:', req.query)
            } else if (req.method === 'POST') {
                // Extract parameters from request body
                ;({ sessionId, firebaseToken, idToken, authCode, redirectUri, state } = req.body)
                firebaseToken = firebaseToken || idToken // Accept both parameter names
                console.log('📥 POST OAuth callback params:', {
                    sessionId: !!sessionId,
                    firebaseToken: !!firebaseToken,
                    authCode: !!authCode,
                    redirectUri: !!redirectUri,
                    state: !!state,
                })
                console.log('Full POST body:', req.body)
            } else {
                console.log('❌ Method not allowed:', req.method)
                res.status(405).json({ error: 'Method not allowed' })
                return
            }

            if (!sessionId || !firebaseToken) {
                console.log('❌ Missing required parameters:', {
                    sessionId: !!sessionId,
                    firebaseToken: !!firebaseToken,
                })
                res.status(400).json({
                    success: false,
                    error: 'Missing required parameters: sessionId and firebaseToken',
                })
                return
            }

            console.log('✅ All required parameters present, proceeding with OAuth callback')

            try {
                console.log('🔄 Starting OAuth callback processing...')
                console.log('Session ID:', sessionId)
                console.log('Firebase token length:', firebaseToken?.length || 0)

                // Handle Firebase authentication
                console.log('🔑 Processing OAuth callback with CloudOAuthHandler...')
                const result = await oauthHandler.handleOAuthCallback(sessionId, firebaseToken)
                console.log('📋 OAuth callback result:', {
                    success: result.success,
                    userId: result.userId,
                    sessionId: result.sessionId,
                    hasToken: !!result.bearerToken,
                    error: result.error,
                })

                if (!result.success) {
                    console.log('❌ OAuth callback failed:', result.error)
                    res.json(result)
                    return
                }

                console.log('🔍 Decoding Firebase token for user email...')
                // Get user email from Firebase token for stable identification
                const decodedToken = await admin.auth().verifyIdToken(firebaseToken)
                const userEmail = decodedToken.email
                console.log('👤 User email extracted:', userEmail)
                console.log('🆔 User ID from token:', decodedToken.uid)

                // Store authentication by email (not client ID) for reliable cross-context access
                console.log('💾 Storing user authentication by email...')
                await storeUserAuthByEmail(userEmail, result.userId, result.sessionId)
                console.log('✅ Successfully stored user authentication for email:', userEmail)

                // If this is part of OAuth authorization flow, complete it
                if (authCode) {
                    console.log('🔄 Completing OAuth authorization flow...')
                    console.log('📝 Auth code received:', authCode)
                    console.log('🔗 Redirect URI:', redirectUri)
                    console.log('🎫 State parameter:', state)

                    const db = admin.firestore()
                    console.log('🗄️ Updating OAuth auth session in Firestore...')

                    // Update the OAuth auth session with completion
                    const updateData = {
                        status: 'completed',
                        userId: result.userId,
                        mcpSessionId: result.sessionId,
                        completedAt: Timestamp.now(),
                    }
                    console.log('📊 Auth session update data:', updateData)

                    await db.collection('oauthAuthSessions').doc(authCode).update(updateData)
                    console.log('✅ Successfully updated OAuth auth session:', authCode)

                    // Process OAuth callback with the provided redirect URI
                    if (redirectUri) {
                        console.log('🚀 Processing OAuth callback for redirectUri:', redirectUri)

                        // Prepare OAuth callback URL for browser redirect
                        console.log('🌐 Preparing OAuth callback redirect to:', redirectUri)
                        const redirectUrl = new URL(redirectUri)
                        redirectUrl.searchParams.set('code', authCode)

                        if (state) {
                            redirectUrl.searchParams.set('state', state)
                        }

                        console.log('✅ OAuth callback URL prepared for browser redirect:', {
                            url: redirectUrl.toString(),
                        })

                        // Return success response with redirect instruction
                        const responseData = {
                            success: true,
                            message: 'OAuth authorization completed',
                            authCode: authCode,
                            sessionId: result.sessionId,
                            userId: result.userId,
                            bearerToken: result.bearerToken, // Include bearer token for Claude
                            redirect_to: redirectUrl.toString(), // ✅ Tell browser to redirect to Claude
                        }
                        console.log('📤 Sending OAuth completion response:', {
                            success: responseData.success,
                            sessionId: responseData.sessionId,
                            userId: responseData.userId,
                            hasToken: !!responseData.bearerToken,
                        })

                        res.json(responseData)
                        return
                    } else {
                        console.log('⚠️ No redirect URI provided - OAuth flow completed but no callback made')
                    }
                } else {
                    console.log('ℹ️ No auth code provided - standard MCP auth callback (not OAuth flow)')
                }

                // Standard MCP auth response
                console.log('📤 Sending standard MCP auth response')
                console.log('Response data:', {
                    success: result.success,
                    userId: result.userId,
                    sessionId: result.sessionId,
                    hasToken: !!result.bearerToken,
                })
                res.json(result)
                return
            } catch (error) {
                console.error('❌ OAuth callback processing error:', error)
                console.error('Error details:', {
                    message: error.message,
                    stack: error.stack,
                    sessionId: sessionId,
                    authCode: authCode,
                })

                const errorResponse = {
                    success: false,
                    error: 'Authentication processing failed: ' + error.message,
                }
                console.log('📤 Sending error response:', errorResponse)
                res.status(500).json(errorResponse)
                return
            }
        } catch (error) {
            console.error('❌ MCP OAuth callback function error (outer catch):', error)
            console.error('Outer error details:', {
                message: error.message,
                stack: error.stack,
                method: req.method,
                url: req.url,
            })

            const errorResponse = {
                success: false,
                error: 'Internal server error',
            }
            console.log('📤 Sending outer error response:', errorResponse)
            res.status(500).json(errorResponse)
        }
    }
)
