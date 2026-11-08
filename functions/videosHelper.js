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

// security audit 2026-11 (NV-30): the converter used to hand the caller's `videoUri` string straight
// to ffmpeg, which opens whatever protocol it names (http to any host, file:, concat:, hls) from
// inside the Admin-SA function, and wrote the result under a caller-chosen prefix. Now the input
// can only be an object the app itself uploaded (`notesAttachments/{DDMMYYYY}/{hash}/{name}` in the
// default bucket, named by its download URL WITH the object's own token), it is downloaded through
// the Admin SDK, ffmpeg reads one local file with the demuxer chosen from the file's own magic
// bytes and `-protocol_whitelist file`, and the output goes next to the input.
const SOURCE_PATH_PATTERN = /^notesAttachments\/\d{8}\/[A-Za-z0-9_-]{1,64}\/[^/]{1,255}$/
const MAX_SOURCE_BYTES = 500 * 1024 * 1024
const CONVERT_RATE_LIMIT = { name: 'convertVideos', limit: 30, windowMs: 60 * 60 * 1000 }

class VideoConversionError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

/**
 * Reads `{ path, token }` from a Firebase Storage download URL of the given bucket. Anything else
 * (another host, another bucket, no token) returns null.
 */
function parseStorageDownloadUrl(rawUrl, bucketName) {
    let parsed
    try {
        parsed = new URL(String(rawUrl || ''))
    } catch (error) {
        return null
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'firebasestorage.googleapis.com') return null
    const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(parsed.pathname)
    if (!match || decodeURIComponent(match[1]) !== bucketName) return null
    let path
    try {
        path = decodeURIComponent(match[2])
    } catch (error) {
        return null
    }
    const token = parsed.searchParams.get('token')
    if (!token) return null
    return { path, token }
}

/** The ffmpeg demuxer for the bytes, or null: only WebM/Matroska and MP4/QuickTime are converted. */
function sniffVideoInputFormat(header) {
    if (!Buffer.isBuffer(header) || header.length < 12) return null
    if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) return 'matroska'
    if (header.subarray(4, 8).toString('latin1') === 'ftyp') return 'mov'
    return null
}

function buildDownloadUrl(bucketName, path, token) {
    return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
}

async function readHeader(filePath, bytes = 16) {
    const handle = await fs.promises.open(filePath, 'r')
    try {
        const buffer = Buffer.alloc(bytes)
        const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
        return buffer.subarray(0, bytesRead)
    } finally {
        await handle.close()
    }
}

function runFfmpeg(inputPath, inputFormat, outputPath, ffmpegFactory = ffmpeg) {
    return new Promise((resolve, reject) => {
        ffmpegFactory()
            .input(inputPath)
            .inputFormat(inputFormat)
            .inputOptions(['-protocol_whitelist', 'file'])
            .videoCodec('libx264')
            .outputOptions(['-x264-params level=30'])
            .on('end', () => resolve())
            .on('error', err => reject(err))
            .save(outputPath)
    })
}

/**
 * @param {object} admin firebase-admin
 * @param {{ videoUri: string, projectId: string }} data
 * @param {string} userId the authenticated caller
 */
const convertVideos = async (admin, data, userId, deps = {}) => {
    const db = deps.db || admin.firestore()
    const bucket = deps.bucket || admin.storage().bucket()
    const projectId = typeof data?.projectId === 'string' ? data.projectId.trim() : ''
    if (!userId) throw new VideoConversionError('unauthenticated', 'Authentication required.')
    if (!projectId) throw new VideoConversionError('invalid-argument', 'A projectId is required.')

    const { isProjectMemberData } = require('./shared/privacyAccess')
    const projectDoc = await db.collection('projects').doc(projectId).get()
    if (!projectDoc.exists || !isProjectMemberData(projectDoc.data(), userId)) {
        throw new VideoConversionError('permission-denied', 'No access to this project.')
    }

    const source = parseStorageDownloadUrl(data?.videoUri, bucket.name)
    if (!source || !SOURCE_PATH_PATTERN.test(source.path) || source.path.includes('..')) {
        throw new VideoConversionError('invalid-argument', 'Only an uploaded note attachment can be converted.')
    }
    const sourceFile = bucket.file(source.path)
    let metadata
    try {
        ;[metadata] = await sourceFile.getMetadata()
    } catch (error) {
        throw new VideoConversionError('not-found', 'The video was not found.')
    }
    const tokens = String(metadata?.metadata?.firebaseStorageDownloadTokens || '')
        .split(',')
        .map(token => token.trim())
        .filter(Boolean)
    if (!tokens.includes(source.token)) {
        // Answers exactly like a missing file: the token is what makes the URL a capability.
        throw new VideoConversionError('not-found', 'The video was not found.')
    }
    if (Number(metadata?.size) > MAX_SOURCE_BYTES) {
        throw new VideoConversionError('invalid-argument', 'The video is too large to convert.')
    }

    const { consumeCallableQuota } = require('./shared/callableRateLimit')
    await consumeCallableQuota(db, { ...CONVERT_RATE_LIMIT, userId })

    const stamp = (deps.now || Date.now)()
    const workDir = await fs.promises.mkdtemp(`${os.tmpdir()}/convert-`)
    const inputPath = `${workDir}/input`
    const outputPath = `${workDir}/${stamp}.mp4`
    const destination = `${source.path.slice(0, source.path.lastIndexOf('/'))}/${stamp}.mp4`
    try {
        await sourceFile.download({ destination: inputPath })
        const inputFormat = sniffVideoInputFormat(await readHeader(inputPath))
        if (!inputFormat) {
            throw new VideoConversionError('invalid-argument', 'The file is not a WebM or MP4 video.')
        }
        try {
            await (deps.runFfmpeg || runFfmpeg)(inputPath, inputFormat, outputPath)
        } catch (err) {
            functions.logger.error('Error converting', err && err.message)
            throw new VideoConversionError('internal', 'The video could not be converted.')
        }
        const token = uuidv4()
        await bucket.upload(outputPath, {
            destination,
            metadata: { contentType: 'video/mp4', metadata: { firebaseStorageDownloadTokens: token } },
        })
        return { url: buildDownloadUrl(bucket.name, destination, token) }
    } finally {
        await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
}

module.exports = {
    removeOldRecordings,
    convertVideos,
    parseStorageDownloadUrl,
    sniffVideoInputFormat,
    runFfmpeg,
    VideoConversionError,
}
