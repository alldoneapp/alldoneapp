const configDevelop = require('../firebaseConfigDevelop.json')
const configMaster = require('../firebaseConfigMaster.json')
const serviceADev = require('../service_accounts/serv_account_key_develop')
const serviceAProd = require('../service_accounts/serv_account_key_master')

const APP_STAGING = 'app_staging'
const APP_PRODUCTION = 'app_production'

const stagingConfig = {
    name: 'AllDone Staging',
    url: configDevelop.url,
    service: serviceADev,
    databaseURL: configDevelop.databaseURL,
    storageBucket: configDevelop.storageBucket,
}

const productionConfig = {
    name: 'AllDone Production',
    url: configMaster.url,
    service: serviceAProd,
    databaseURL: configMaster.databaseURL,
    storageBucket: configMaster.storageBucket,
}

const init = (admin, type) => {
    const config = getAppConfig(type)
    return admin.initializeApp(
        {
            credential: admin.credential.cert(config.service),
            databaseURL: config.databaseURL,
            storageBucket: config.storageBucket,
        },
        config.name
    )
}

const getAppConfig = type => {
    switch (type) {
        case APP_STAGING:
            return stagingConfig
        case APP_PRODUCTION:
            return productionConfig
        default:
            return stagingConfig
    }
}

module.exports = {
    stagingConfig,
    productionConfig,
    APP_STAGING,
    APP_PRODUCTION,
    getAppConfig,
    init,
}
