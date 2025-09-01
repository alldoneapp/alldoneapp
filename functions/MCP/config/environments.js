// BEGIN-ENVS
const GOOGLE_FIREBASE_WEB_API_KEY = process.env.GOOGLE_FIREBASE_WEB_API_KEY
const GOOGLE_FIREBASE_WEB_AUTH_DOMAIN = process.env.GOOGLE_FIREBASE_WEB_AUTH_DOMAIN
const GOOGLE_FIREBASE_WEB_PROJECT_ID = process.env.GOOGLE_FIREBASE_WEB_PROJECT_ID
const GOOGLE_FIREBASE_STORAGE_BUCKET = process.env.GOOGLE_FIREBASE_STORAGE_BUCKET
const GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID = process.env.GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID
const GOOGLE_FIREBASE_WEB_APP_ID = process.env.GOOGLE_FIREBASE_WEB_APP_ID
// Optional base URL for MCP, injected by CI
// eslint-disable-next-line no-undef
const MCP_BASE_URL = typeof MCP_BASE_URL !== 'undefined' ? MCP_BASE_URL : undefined
// END-ENVS

const getEnvironmentConfig = () => {
    return {
        firebaseWeb: {
            apiKey: GOOGLE_FIREBASE_WEB_API_KEY,
            authDomain: GOOGLE_FIREBASE_WEB_AUTH_DOMAIN,
            projectId: GOOGLE_FIREBASE_WEB_PROJECT_ID,
            storageBucket: GOOGLE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID,
            appId: GOOGLE_FIREBASE_WEB_APP_ID,
        },
        // Expose MCP base URL if provided by CI (may be undefined)
        // Using typeof guard to avoid ReferenceError when not injected
        mcpBaseUrl: typeof MCP_BASE_URL !== 'undefined' ? MCP_BASE_URL : null,
    }
}

module.exports = { getEnvironmentConfig }
