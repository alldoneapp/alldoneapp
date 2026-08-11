const firestore = require('@google-cloud/firestore')
const { inProductionEnvironment } = require('./HelperFunctionsCloud')
const configMaster = require('../firebaseConfigMaster.json')

const fsClient = new firestore.v1.FirestoreAdminClient()

const scheduledFirestoreBackup = async firebaseProjectId => {
    // Only save backups for production
    if (inProductionEnvironment()) {
        const databaseName = fsClient.databasePath(firebaseProjectId, '(default)')

        return fsClient
            .exportDocuments({
                name: databaseName,
                outputUriPrefix: configMaster.storageBackupBucket,
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
                throw new Error('Export operation failed')
            })
    }
}

module.exports = { scheduledFirestoreBackup }
