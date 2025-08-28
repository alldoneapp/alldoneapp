const admin = require('firebase-admin')
const { v4: uuidv4 } = require('uuid')
const { getEnvironmentConfig } = require('../config/environments.js')

// Helper function to get the correct base URL based on environment
function getBaseUrl() {
    const { inProductionEnvironment } = require('../Utils/HelperFunctionsCloud.js')

    if (process.env.FUNCTIONS_EMULATOR) {
        return 'http://localhost:5000'
    }

    const isProduction = inProductionEnvironment()

    if (isProduction) {
        return 'https://alldonealeph.web.app'
    } else {
        return 'https://alldonestaging.web.app'
    }
}

// Simple session storage using Firestore
class CloudSessionManager {
    constructor() {
        this.collection = 'mcpSessions'
    }

    get db() {
        // Lazy initialization - only access Firestore when needed. cool
        if (!this._db) {
            this._db = admin.firestore()
        }
        return this._db
    }

    async createSession(userId, userData) {
        const sessionId = uuidv4()
        const session = {
            sessionId,
            userId,
            userData,
            createdAt: admin.firestore.Timestamp.now(),
            expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), // 30 days
        }

        await this.db.collection(this.collection).doc(sessionId).set(session)
        return sessionId
    }

    async getSession(sessionId) {
        if (!sessionId) return null

        const doc = await this.db.collection(this.collection).doc(sessionId).get()
        if (!doc.exists) return null

        const session = doc.data()

        // Check if session is expired
        if (session.expiresAt.toDate() < new Date()) {
            await this.deleteSession(sessionId)
            return null
        }

        return session
    }

    async deleteSession(sessionId) {
        if (!sessionId) return
        await this.db.collection(this.collection).doc(sessionId).delete()
    }

    async findSessionByUserId(userId) {
        const snapshot = await this.db
            .collection(this.collection)
            .where('userId', '==', userId)
            .where('expiresAt', '>', admin.firestore.Timestamp.now())
            .orderBy('expiresAt', 'desc')
            .limit(1)
            .get()

        if (snapshot.empty) return null
        return snapshot.docs[0].data()
    }
}

// User session manager for MCP authentication
class UserSessionManager {
    constructor() {
        this.collection = 'mcpUserSessions'
    }

    get db() {
        // Lazy initialization - only access Firestore when needed
        if (!this._db) {
            this._db = admin.firestore()
        }
        return this._db
    }

    async createUserSession(userId, email, bearerToken, mcpSessionId) {
        const session = {
            userId,
            email,
            bearerToken,
            sessionId: mcpSessionId,
            createdAt: admin.firestore.Timestamp.now(),
            expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), // 30 days
            lastUsed: admin.firestore.Timestamp.now(),
        }

        await this.db.collection(this.collection).doc(userId).set(session)
        return userId
    }

    async getUserSession(userId) {
        if (!userId) return null

        const doc = await this.db.collection(this.collection).doc(userId).get()
        if (!doc.exists) return null

        const session = doc.data()

        // Check if session is expired
        if (session.expiresAt.toDate() < new Date()) {
            await this.deleteUserSession(userId)
            return null
        }

        return session
    }

    async updateLastUsed(userId) {
        if (!userId) return

        await this.db.collection(this.collection).doc(userId).update({
            lastUsed: admin.firestore.Timestamp.now(),
        })
    }

    async deleteUserSession(userId) {
        if (!userId) return
        await this.db.collection(this.collection).doc(userId).delete()
    }

    async validateSession(userId) {
        const session = await this.getUserSession(userId)
        if (!session) return null

        try {
            // Validate Bearer token with Firebase Auth
            const decodedToken = await admin.auth().verifyIdToken(session.bearerToken)

            // Update last used timestamp
            await this.updateLastUsed(userId)

            return {
                userId: decodedToken.uid,
                email: decodedToken.email,
                bearerToken: session.bearerToken,
            }
        } catch (error) {
            console.error('Bearer token validation failed for user:', userId, error.message)
            // Clean up invalid session
            await this.deleteUserSession(userId)
            return null
        }
    }

    async cleanupExpiredSessions() {
        try {
            const now = admin.firestore.Timestamp.now()
            const expiredSessions = await this.db.collection(this.collection).where('expiresAt', '<', now).get()

            const deletePromises = expiredSessions.docs.map(doc => doc.ref.delete())
            await Promise.all(deletePromises)

            console.log(`Cleaned up ${expiredSessions.size} expired user sessions`)
        } catch (error) {
            console.error('Error during user session cleanup:', error)
        }
    }
}

// OAuth handler for Cloud Functions
class CloudOAuthHandler {
    constructor() {
        this.sessionManager = new CloudSessionManager()
        this.userSessionManager = new UserSessionManager()
        this.pendingAuthCollection = 'mcpPendingAuth' // Store pending auth in Firestore
    }

    get db() {
        // Lazy initialization - only access Firestore when needed
        if (!this._db) {
            this._db = admin.firestore()
        }
        return this._db
    }

    // Generate OAuth login URL
    generateOAuthUrl(sessionId) {
        // For Cloud Functions, we'll generate a simple Firebase Auth URL
        // Users will authenticate via Firebase Auth in their browser
        const baseUrl = `${getBaseUrl()}/mcpServer`

        return `${baseUrl}/auth/login?session_id=${sessionId}`
    }

    // Create a pending auth session
    async createPendingAuth() {
        const sessionId = uuidv4()
        const authData = {
            sessionId,
            createdAt: admin.firestore.Timestamp.now(),
            expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000)), // 30 minutes
            status: 'pending',
        }

        await this.db.collection(this.pendingAuthCollection).doc(sessionId).set(authData)
        return sessionId
    }

    // Handle OAuth callback
    async handleOAuthCallback(sessionId, firebaseToken) {
        try {
            // Verify the Firebase token
            const decodedToken = await admin.auth().verifyIdToken(firebaseToken)
            const userId = decodedToken.uid
            const userData = {
                email: decodedToken.email,
                name: decodedToken.name || decodedToken.email,
                uid: userId,
                bearerToken: firebaseToken, // Store the Firebase token as Bearer token
            }

            // Create persistent session with Bearer token
            const mcpSessionId = await this.sessionManager.createSession(userId, userData)

            // Create user session for automatic authentication
            await this.userSessionManager.createUserSession(userId, decodedToken.email, firebaseToken, mcpSessionId)

            // Update pending auth with Bearer token in Firestore
            const pendingAuthDoc = this.db.collection(this.pendingAuthCollection).doc(sessionId)
            const pendingAuthSnapshot = await pendingAuthDoc.get()

            if (pendingAuthSnapshot.exists) {
                await pendingAuthDoc.update({
                    status: 'completed',
                    mcpSessionId,
                    userId,
                    bearerToken: firebaseToken, // Include Bearer token for immediate use
                    completedAt: admin.firestore.Timestamp.now(),
                })
            }

            return { success: true, sessionId: mcpSessionId, userId, bearerToken: firebaseToken }
        } catch (error) {
            console.error('OAuth callback error:', error)
            return { success: false, error: error.message }
        }
    }

    // Check auth status
    async checkAuthStatus(sessionId) {
        try {
            console.log(`🔍 Checking auth status for sessionId: ${sessionId}`)
            const pendingAuthDoc = await this.db.collection(this.pendingAuthCollection).doc(sessionId).get()

            if (!pendingAuthDoc.exists) {
                console.log(`❌ Session not found in pendingAuth collection: ${sessionId}`)
                return { status: 'not_found' }
            }

            const pending = pendingAuthDoc.data()
            console.log('📋 Found pending auth data:', {
                status: pending.status,
                userId: pending.userId,
                hasToken: !!pending.bearerToken,
                expiresAt: pending.expiresAt.toDate(),
            })

            // Check if session is expired
            if (pending.expiresAt.toDate() < new Date()) {
                console.log(`⏰ Session expired, deleting: ${sessionId}`)
                await this.db.collection(this.pendingAuthCollection).doc(sessionId).delete()
                return { status: 'expired' }
            }

            console.log(`✅ Returning auth status: ${pending.status}`)
            return {
                status: pending.status,
                sessionId: pending.mcpSessionId,
                userId: pending.userId,
                bearerToken: pending.bearerToken, // Return Bearer token when auth is completed
            }
        } catch (error) {
            console.error('❌ Error checking auth status:', error)
            return { status: 'error', error: error.message }
        }
    }

    // Generate Firebase Auth HTML page
    generateAuthPage(sessionId, authCode = null, redirectUri = null, state = null) {
        const config = getEnvironmentConfig()
        const firebaseConfig = config.firebaseWeb

        return `
<!DOCTYPE html>
<html>
<head>
    <title>Alldone MCP - Authenticate</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 400px;
            width: 100%;
        }
        .logo {
            font-size: 2em;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 20px;
        }
        .button {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.3s;
        }
        .button:hover {
            background: #5a6fd8;
        }
        .button.close {
            background: #28a745;
        }
        .button.close:hover {
            background: #218838;
        }
        .hidden {
            display: none;
        }
        .status {
            margin-top: 20px;
            padding: 10px;
            border-radius: 4px;
        }
        .success {
            background: #d4edda;
            color: #155724;
        }
        .error {
            background: #f8d7da;
            color: #721c24;
        }
    </style>
    <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-auth-compat.js"></script>
</head>
<body>
    <div class="container">
        <div class="logo">🚀 Alldone MCP</div>
        <h2>Authenticate with Claude</h2>
        <p>Sign in with your Alldone account to use the MCP server with Claude.ai</p>
        ${
            authCode
                ? `
        <div style="background: #f8f9fa; border: 2px solid #667eea; border-radius: 8px; padding: 15px; margin: 20px 0; text-align: left;">
            <div style="font-weight: bold; color: #667eea; margin-bottom: 8px;">🔑 Authorization Code:</div>
            <code style="background: white; padding: 8px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 14px; word-break: break-all; display: block;">${authCode}</code>
            <div style="font-size: 12px; color: #666; margin-top: 8px;">This authorization code will be exchanged for an access token after authentication.</div>
        </div>`
                : ''
        }
        <button id="loginBtn" class="button">Sign in with Google</button>
        <button id="closeBtn" class="button close hidden">Close this window</button>
        <div id="status"></div>
    </div>

    <script>
        // Firebase configuration from environment
        const firebaseConfig = ${JSON.stringify(firebaseConfig)};

        // Initialize Firebase
        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();

        const loginBtn = document.getElementById('loginBtn');
        const closeBtn = document.getElementById('closeBtn');
        const status = document.getElementById('status');
        const sessionId = '${sessionId}';

        function showStatus(message, isError = false) {
            status.innerHTML = \`<div class="status \${isError ? 'error' : 'success'}">\${message}</div>\`;
        }

        function showCloseButton() {
            loginBtn.classList.add('hidden');
            closeBtn.classList.remove('hidden');
        }

        function showLoginButton() {
            loginBtn.classList.remove('hidden');
            closeBtn.classList.add('hidden');
        }

        closeBtn.addEventListener('click', () => {
            try {
                window.close();
                // Fallback message if window.close() doesn't work
                setTimeout(() => {
                    showStatus('Please close this window manually.', false);
                }, 100);
            } catch (error) {
                showStatus('Please close this window manually.', false);
            }
        });

        loginBtn.addEventListener('click', async () => {
            try {
                loginBtn.disabled = true;
                loginBtn.textContent = 'Signing in...';
                
                const provider = new firebase.auth.GoogleAuthProvider();
                provider.addScope('email');
                provider.addScope('profile');
                
                const result = await auth.signInWithPopup(provider);
                const user = result.user;
                const token = await user.getIdToken();
                
                // Use dedicated OAuth callback endpoint
                const params = new URLSearchParams({
                    sessionId: sessionId,
                    firebaseToken: token,
                    authCode: '${authCode || ''}',
                    redirectUri: '${redirectUri || ''}',
                    state: '${state || ''}'
                });
                
                // Use the dedicated OAuth callback Cloud Function  
                const callbackUrl = window.location.origin + '/mcpOAuthCallback';
                const response = await fetch(callbackUrl + '?' + params.toString(), {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                    }
                });
                
                let data;
                try {
                    data = await response.json();
                } catch (jsonError) {
                    console.error('JSON parse error:', jsonError);
                    console.log('Response status:', response.status);
                    console.log('Response text:', await response.text());
                    showStatus('❌ Authentication failed: Invalid response from server (status: ' + response.status + ')', true);
                    return;
                }
                
                if (data.success) {
                    // Check if we need to redirect to Claude's callback
                    if (data.redirect_to) {
                        console.log('🔀 Redirecting browser to OAuth callback:', data.redirect_to);
                        showStatus('✅ Authentication successful! Redirecting to Claude...', false);
                        
                        // Redirect browser to Claude's callback URL with authorization code
                        setTimeout(() => {
                            window.location.href = data.redirect_to;
                        }, 1000); // Small delay to show success message
                        return;
                    }
                    
                    // Fallback: Show success message if no redirect needed
                    let successMessage = '✅ Authentication successful! You can now close this window and return to Claude.';
                    
                    // Show access token if available
                    if (data.bearerToken) {
                        successMessage += 
                        '<div style="background: #d4edda; border: 2px solid #28a745; border-radius: 8px; padding: 15px; margin: 15px 0; text-align: left;">' +
                            '<div style="font-weight: bold; color: #155724; margin-bottom: 8px;">🎟️ Access Token (Bearer Token):</div>' +
                            '<code style="background: white; padding: 8px; border-radius: 4px; font-family: Courier New, monospace; font-size: 12px; word-break: break-all; display: block; max-height: 100px; overflow-y: auto;">' + data.bearerToken + '</code>' +
                            '<div style="font-size: 12px; color: #155724; margin-top: 8px;">This token can be used for authenticated MCP requests.</div>' +
                        '</div>';
                    }
                    
                    showStatus(successMessage);
                    showCloseButton();
                } else {
                    showStatus('❌ Authentication failed: ' + data.error, true);
                    // Reset button state on error
                    loginBtn.disabled = false;
                    loginBtn.textContent = 'Sign in with Google';
                }
            } catch (error) {
                console.error('Auth error:', error);
                showStatus('❌ Authentication failed: ' + error.message, true);
                // Reset button state on error
                loginBtn.disabled = false;
                loginBtn.textContent = 'Sign in with Google';
            }
        });
    </script>
</body>
</html>`
    }
}

module.exports = { CloudOAuthHandler, CloudSessionManager, UserSessionManager }
