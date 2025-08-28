'use strict'

const os = require('os')
const ffmpeg = require('fluent-ffmpeg')
//const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const functions = require('firebase-functions')

const removeOldRecordings = async admin => {
    const bucket = admin.storage().bucket()

    let now = new Date()
    now.setDate(now.getDate() - 14)
    for (let i = 0; i <= 7; i++) {
        now.setDate(now.getDate() - 1)
        const day = now.getDate()
        const month = now.getMonth() + 1
        const year = now.getFullYear()
        const date = `${day <= 9 ? 0 : ''}${day}${month <= 9 ? 0 : ''}${month}${year}`
        const [files] = await bucket
            .getFiles({
                prefix: `feedAttachments/${date}/`,
            })
            .catch(console.error)

        files.forEach(file => {
            const name = file.metadata.name.split('/').slice(-1).toString()
            if (
                (file.metadata.contentType === 'video/webm' || file.metadata.contentType === 'video/mp4') &&
                (name === 'video-record.webm' ||
                    name === 'screen-record.webm' ||
                    name === 'video-record.mp4' ||
                    name === 'screen-record.mp4')
            ) {
                file.delete()
                    .then(function () {
                        console.log(`File "${file.metadata.name}" deleted successfully`)
                    })
                    .catch(function (error) {
                        console.log(' Uh-oh, an error occurred!', error)
                    })
            }
        })
    }
}

const convertVideos = async (admin, data) => {
    const tempFileName = new Date().getTime() + '.mp4'
    const pathFile = os.tmpdir() + '/' + tempFileName
    const bucket = admin.storage().bucket()
    const destination = `notesAttachments/${data.uri}/${data.hash}/${tempFileName}`

    return new Promise(function (resolve, reject) {
        ffmpeg({ source: data.videoUri })
            .on('end', async function () {
                await bucket
                    .upload(pathFile, {
                        destination,
                        metadata: {
                            metadata: {
                                firebaseStorageDownloadTokens: uuidv4(),
                            },
                        },
                    })
                    .then(() => {
                        fs.unlinkSync(pathFile)
                        bucket
                            .file(destination)
                            .getSignedUrl({ action: 'read', expires: '03-17-2025' }, function (err, url) {
                                resolve({ url })
                            })
                    })
            })
            .on('error', function (err) {
                functions.logger.error('Error converting', err.message)
                reject({ JSON, err })
            })
            //.setFfmpegPath(ffmpegPath)
            .videoCodec('libx264')
            // .format('mp4')
            .outputOptions(['-x264-params level=30'])
            .save(pathFile)
    })
}

module.exports = {
    removeOldRecordings,
    convertVideos,
}
