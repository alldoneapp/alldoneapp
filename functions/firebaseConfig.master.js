const serviceAccount = require('./service_accounts/serviceAccountKey.json')
const firebaseConfigData = require('./firebaseConfigMaster.json')

exports.app_name = 'AllDone Production'
exports.app_url = firebaseConfigData.url

exports.init = admin => {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: firebaseConfigData.databaseURL,
        storageBucket: firebaseConfigData.storageBucket,
    })
}
