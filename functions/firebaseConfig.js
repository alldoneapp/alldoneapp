// Try to load service account, fall back to default credentials for emulator
let serviceAccount = null
try {
    serviceAccount = require('./service_accounts/serviceAccountKey.json')
} catch (error) {
    console.log('[alldone] Service account key not found, using default credentials (emulator mode)')
}

const firebaseConfigData = require('./firebaseConfigDevelop.json')

exports.app_name = 'AllDone Staging'
exports.app_url = firebaseConfigData.url

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

        // Add credentials if service account is available, otherwise use default
        if (serviceAccount) {
            console.log('[alldone] Using service account credentials')
            config.credential = admin.credential.cert(serviceAccount)
        } else {
            console.log('[alldone] Using default credentials (emulator mode)')
            // For emulator, we can use default credentials or applicationDefault()
            if (process.env.FUNCTIONS_EMULATOR) {
                // In emulator mode, we can omit credentials entirely
                console.log('[alldone] Running in emulator mode - using default authentication')
            } else {
                // For production without service account, try application default
                config.credential = admin.credential.applicationDefault()
            }
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
