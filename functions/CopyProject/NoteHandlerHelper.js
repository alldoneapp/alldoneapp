const { defineString } = require('firebase-functions/params')

const getBucketsAndDb = admin => {
    const db = admin.firestore()
    const versionsBucket = admin.storage().bucket()

    const notesBucketName = defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET').value()
    const notesBucket = admin.storage().bucket(notesBucketName)
    return { db, versionsBucket, notesBucket }
}

module.exports = {
    getBucketsAndDb,
}
