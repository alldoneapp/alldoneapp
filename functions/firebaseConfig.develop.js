const serviceAccount = require('./service_accounts/serviceAccountKey.json')
const firebaseConfigData = require('./firebaseConfigDevelop.json')

exports.app_name = 'AllDone Staging'
exports.app_url = firebaseConfigData.url

exports.init = admin => {
    if (globalThis.__ALDONE_ADMIN_APP__) {
        return globalThis.__ALDONE_ADMIN_APP__
    }
    try {
        const app = admin.app()
        globalThis.__ALDONE_ADMIN_APP__ = app
        return app
    } catch (e) {}

    try {
        const app = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: firebaseConfigData.databaseURL,
            storageBucket: firebaseConfigData.storageBucket,
        })
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
            const app = admin.app()
            globalThis.__ALDONE_ADMIN_APP__ = app
            return app
        }
        throw e
    }
}
