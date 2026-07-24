'use strict'
const { run } = require('./Utils/shell_runner')
const { Firestore } = require('@google-cloud/firestore')
const envDevelop = require('../firebaseConfigDevelop.json')
const envMaster = require('../firebaseConfigMaster.json')

const serviceADevURL = '../service_accounts/serv_account_key_develop.json'
const serviceAProdURL = '../service_accounts/serv_account_key_master.json'
const serviceADev = require(serviceADevURL)
const serviceAProd = require(serviceAProdURL)

const stagingConfig = {
    projectId: serviceADev.project_id,
    bucketURL: envDevelop.storageBackupBucket,
    serviceAccount: serviceADev,
    serviceAccountURL: serviceADevURL,
}

const productionConfig = {
    projectId: serviceAProd.project_id,
    bucketURL: envMaster.storageBackupBucket,
    serviceAccount: serviceAProd,
    serviceAccountURL: serviceAProdURL,
}

/**
 * Make a backup of the given project id, into the specific folder
 * in the bucket for backups.
 *
 * @param projectId
 * @param folder
 * @returns {Promise<T>}
 */
const backupDatabase = (projectId, folder = '') => {
    const config = getBackupsConfig(projectId)
    const fsClient = new Firestore.v1.FirestoreAdminClient({
        projectId: config.projectId,
        keyFilename: config.serviceAccountURL,
    })
    // const fsClient = new Firestore({ projectId: config.projectId, keyFilename: config.serviceAccount })
    const databaseName = fsClient.databasePath(config.projectId, '(default)')

    return fsClient
        .exportDocuments({
            name: databaseName,
            outputUriPrefix: config.bucketURL + `/${folder}`,
            // Leave collectionIds empty to export all collections
            // or set to a list of collection IDs to export,
            // collectionIds: ['users', 'posts']
            collectionIds: [],
        })
        .then(responses => {
            const response = responses[0]
            console.log(`Operation Name: ${response['name']}`)
        })
        .catch(err => {
            console.error('Export operation failed:')
            console.error(err)
        })
}

/**
 * Use a backup to restore database for a given project id.
 * Can be used another bucket and folder different from the given project id.
 *
 * @param projectId
 * @param folder
 * @param specificBucket
 * @returns {Promise<T>}
 */
const restoreDatabase = (projectId, folder = '', specificBucket) => {
    const config = getBackupsConfig(projectId)
    const fsClient = new Firestore.v1.FirestoreAdminClient({
        projectId: config.projectId,
        keyFilename: config.serviceAccountURL,
    })

    const databaseName = fsClient.databasePath(config.projectId, '(default)')
    const bucketURL = specificBucket ? specificBucket : config.bucketURL

    return fsClient
        .importDocuments({
            name: databaseName,
            inputUriPrefix: bucketURL + `/${folder}`,
            // Leave collectionIds empty to export all collections
            // or set to a list of collection IDs to export,
            // collectionIds: ['users', 'posts']
            collectionIds: [],
        })
        .then(responses => {
            const response = responses[0]
            console.log(`Operation Name: ${response['name']}`)
        })
        .catch(err => {
            console.error(err)
            throw new Error('Import operation failed')
        })
}

/**
 * Get the right config given a project id.
 *
 * @param projectId
 * @returns {{serviceAccountURL: *, bucketURL: *, serviceAccount: *, projectId: *}}
 */
const getBackupsConfig = projectId => {
    switch (projectId) {
        case stagingConfig.projectId:
            return stagingConfig
        case productionConfig.projectId:
            return productionConfig
        default:
            return stagingConfig
    }
}

///////////////  Using GCloud / Gsutil CLI  ///////////////

const gBackupDatabase = (projectId, bucket = '', folder = '', callback) => {
    const config = getBackupsConfig(projectId)
    const bucketUrl = bucket !== '' ? bucket : config.bucketURL
    const folderName = folder !== '' ? folder : config.projectId

    run(`gcloud config set project ${config.projectId}`, std => {
        run(`gcloud firestore export ${bucketUrl}/${folderName} --async`, stdout => {
            if (callback) callback(`${std}\n\n${stdout}`)
        })
    })
}

const gRestoreDatabase = (projectId, bucket = '', folder = '', callback) => {
    const config = getBackupsConfig(projectId)
    const bucketUrl = bucket !== '' ? bucket : config.bucketURL
    const folderName = folder !== '' ? folder : config.projectId

    run(`gcloud config set project ${config.projectId}`, std => {
        run(`gcloud firestore import ${bucketUrl}/${folderName} --async`, stdout => {
            if (callback) callback(`${std}\n\n${stdout}`)
        })
    })
}

/**
 * To delete the entire firestore database use this command with Firebase CLI
 * BE COMPLETELY SURE YOU SAVED A BACKUP BEFORE EXECUTE THIS
 *
 * firebase firestore:delete --all-collections --yes
 *
 * @param projectId
 * @param callback
 */
const deleteCollections = (projectId, callback) => {
    run(`firebase use ${projectId}`, std => {
        run('firebase firestore:delete --all-collections --yes', stdout => {
            if (callback) callback(`${std}\n\n${stdout}`)
        })
    })
}

module.exports = {
    PROJECT_ID_DEV: stagingConfig.projectId,
    PROJECT_ID_PROD: productionConfig.projectId,
    getBackupsConfig,
    backupDatabase,
    restoreDatabase,
    gBackupDatabase,
    gRestoreDatabase,
    deleteCollections,
}
