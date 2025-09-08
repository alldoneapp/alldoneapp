// Determine environment and load appropriate config
function getEnvironment() {
    // If running in emulator, use develop config
    if (process.env.FUNCTIONS_EMULATOR) {
        return 'develop'
    }

    // Determine environment from project ID
    let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    if (!projectId) {
        try {
            const cfg = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
            if (cfg && cfg.projectId) projectId = cfg.projectId
        } catch (_) {}
    }

    // Default to develop if we can't determine project ID
    if (!projectId) {
        console.log('[alldone] Could not determine project ID, defaulting to develop environment')
        return 'develop'
    }

    // Map project IDs to environments
    if (projectId === 'alldonealeph') {
        return 'master'
    }
    if (projectId === 'alldonestaging') {
        return 'develop'
    }

    // Default fallback
    console.log(`[alldone] Unknown project ID: ${projectId}, defaulting to develop environment`)
    return 'develop'
}

const environment = getEnvironment()
console.log(`[alldone] Using environment: ${environment}`)

// Load environment-specific configuration
let firebaseConfigData
let configFileName

if (environment === 'master') {
    firebaseConfigData = require('./firebaseConfigMaster.json')
    configFileName = 'firebaseConfigMaster.json'
    exports.app_name = 'AllDone Production'
} else {
    firebaseConfigData = require('./firebaseConfigDevelop.json')
    configFileName = 'firebaseConfigDevelop.json'
    exports.app_name = 'AllDone Staging'
}

console.log(`[alldone] Loaded configuration from ${configFileName}`)
exports.app_url = firebaseConfigData.url

// Try to load service account, fall back to default credentials for emulator
let serviceAccount = null
try {
    serviceAccount = require('./service_accounts/serviceAccountKey.json')
    console.log('[alldone] Service account key loaded successfully')
} catch (error) {
    console.log('[alldone] Service account key not found, using default credentials (emulator mode)')
}

exports.init = admin => {
    console.log('[alldone] firebaseConfig.init called')
    if (globalThis.__ALDONE_ADMIN_APP__) {
        console.log('[alldone] Returning cached admin app from globalThis')
        return globalThis.__ALDONE_ADMIN_APP__
    }
    // Robust idempotent initialization: prefer returning existing default app if present
    try {
        const app = admin.app()
        console.log('[alldone] admin.app() already exists, reusing')
        globalThis.__ALDONE_ADMIN_APP__ = app
        return app
    } catch (e) {
        // Default app is not initialized yet
    }

    try {
        console.log('[alldone] Initializing Firebase Admin app now')

        // Configuration object for Firebase Admin
        const config = {
            databaseURL: firebaseConfigData.databaseURL,
            storageBucket: firebaseConfigData.storageBucket,
        }

        // Add credentials based on environment and availability
        if (process.env.FUNCTIONS_EMULATOR) {
            // In emulator mode, omit credentials entirely
            console.log('[alldone] Running in emulator mode - using default authentication')
        } else if (serviceAccount) {
            console.log('[alldone] Using service account credentials')
            config.credential = admin.credential.cert(serviceAccount)
        } else {
            console.log('[alldone] No service account found, using application default credentials')
            config.credential = admin.credential.applicationDefault()
        }

        const app = admin.initializeApp(config)
        globalThis.__ALDONE_ADMIN_APP__ = app
        return app
    } catch (e) {
        const duplicate =
            (e && e.code === 'app/duplicate-app') ||
            (e && e.errorInfo && e.errorInfo.code === 'app/duplicate-app') ||
            (e &&
                typeof e.message === 'string' &&
                e.message.toLowerCase().includes('default firebase app already exists'))
        if (duplicate) {
            // If another loader initialized concurrently, return the existing app
            console.log('[alldone] Caught duplicate-app during init, returning existing admin app')
            const app = admin.app()
            globalThis.__ALDONE_ADMIN_APP__ = app
            return app
        }
        throw e
    }
}
