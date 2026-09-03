const getBucketsAndDb = admin => {
    const db = admin.firestore()
    const versionsBucket = admin.storage().bucket()

    const { getNotesBucketName } = require('../shared/notesStorageBucket')
    const notesBucketName = getNotesBucketName()
    const notesBucket = admin.storage().bucket(notesBucketName)
    return { db, versionsBucket, notesBucket }
}

module.exports = {
    getBucketsAndDb,
}
