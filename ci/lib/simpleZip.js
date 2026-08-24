'use strict'

// Minimal dependency-free ZIP writer (deflate entries, UTF-8 names).
//
// Exists because the OTA bundle (ci/buildOtaBundle.js) is created inside the
// web-bundler CI image, which ships no `zip` binary, and adding an npm zip
// dependency would force a registry image rebuild for every consumer. The
// format written here is the plain ZIP subset every unzipper understands:
// local file headers + central directory + end-of-central-directory, DEFLATE
// compression via node's zlib. No zip64 (bundles are far below 4 GB), no
// directories entries (readers create parents implicitly), no encryption.

const zlib = require('zlib')

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
    }
    return table
})()

const crc32 = buffer => {
    let crc = 0xffffffff
    for (let i = 0; i < buffer.length; i++) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

// DOS date/time encoding; per-entry timestamps are pinned to a constant so the
// same content always produces byte-identical zips (deploy markers and CDN
// caches both like determinism).
const DOS_TIME = 0
const DOS_DATE = 0x21 // 1980-01-01

/**
 * files: array of { name: 'relative/path.ext', data: Buffer }
 * returns: Buffer containing the complete zip
 */
function createZip(files) {
    const localParts = []
    const centralParts = []
    let offset = 0

    for (const file of files) {
        const nameBuffer = Buffer.from(file.name, 'utf8')
        const crc = crc32(file.data)
        const deflated = zlib.deflateRawSync(file.data, { level: 9 })
        // Store uncompressed when deflate does not help (already-compressed media).
        const useDeflate = deflated.length < file.data.length
        const payload = useDeflate ? deflated : file.data
        const method = useDeflate ? 8 : 0

        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0) // local file header signature
        local.writeUInt16LE(20, 4) // version needed
        local.writeUInt16LE(0x0800, 6) // flags: UTF-8 names
        local.writeUInt16LE(method, 8)
        local.writeUInt16LE(DOS_TIME, 10)
        local.writeUInt16LE(DOS_DATE, 12)
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(payload.length, 18)
        local.writeUInt32LE(file.data.length, 22)
        local.writeUInt16LE(nameBuffer.length, 26)
        local.writeUInt16LE(0, 28) // extra length

        const central = Buffer.alloc(46)
        central.writeUInt32LE(0x02014b50, 0) // central directory signature
        central.writeUInt16LE(20, 4) // version made by
        central.writeUInt16LE(20, 6) // version needed
        central.writeUInt16LE(0x0800, 8)
        central.writeUInt16LE(method, 10)
        central.writeUInt16LE(DOS_TIME, 12)
        central.writeUInt16LE(DOS_DATE, 14)
        central.writeUInt32LE(crc, 16)
        central.writeUInt32LE(payload.length, 20)
        central.writeUInt32LE(file.data.length, 24)
        central.writeUInt16LE(nameBuffer.length, 28)
        // extra/comment/disk/attrs left zero
        central.writeUInt32LE(offset, 42)

        localParts.push(local, nameBuffer, payload)
        centralParts.push(Buffer.concat([central, nameBuffer]))
        offset += local.length + nameBuffer.length + payload.length
    }

    const centralDirectory = Buffer.concat(centralParts)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(files.length, 8)
    eocd.writeUInt16LE(files.length, 10)
    eocd.writeUInt32LE(centralDirectory.length, 12)
    eocd.writeUInt32LE(offset, 16)

    return Buffer.concat([...localParts, centralDirectory, eocd])
}

module.exports = { createZip, crc32 }
