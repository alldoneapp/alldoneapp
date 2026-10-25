'use strict'

const { Readable } = require('stream')

// An in-memory Cloud Storage bucket: save, copy, read back as a stream or a buffer, delete by
// prefix. Records the options each file was saved with, so a suite can assert that no download
// token was attached. `beforeWrite` lets a suite act between the reads of a commit and its writes.
class ArtifactBucketDouble {
    constructor(name = 'alldone-test.appspot.com') {
        this.name = name
        this.files = new Map()
        this.failSaves = false
        this.beforeWrite = null
    }

    file(path) {
        const bucket = this
        return {
            name: path,
            async save(bytes, options = {}) {
                if (bucket.beforeWrite) await bucket.beforeWrite(path)
                if (bucket.failSaves) throw new Error('save failed')
                bucket.files.set(path, { bytes: Buffer.from(bytes), options })
            },
            async copy(destination) {
                if (bucket.beforeWrite) await bucket.beforeWrite(destination.name)
                const stored = bucket.files.get(path)
                if (!stored) throw new Error('No such object')
                bucket.files.set(destination.name, { bytes: Buffer.from(stored.bytes), options: stored.options })
            },
            async getMetadata() {
                const stored = bucket.files.get(path)
                if (!stored) throw Object.assign(new Error('No such object'), { code: 404 })
                return [{ size: String(stored.bytes.length), metadata: stored.options?.metadata?.metadata || {} }]
            },
            async download() {
                const stored = bucket.files.get(path)
                if (!stored) throw Object.assign(new Error('No such object'), { code: 404 })
                return [Buffer.from(stored.bytes)]
            },
            createReadStream() {
                const stored = bucket.files.get(path)
                if (!stored) {
                    const stream = new Readable({ read() {} })
                    process.nextTick(() => stream.emit('error', new Error('No such object')))
                    return stream
                }
                return Readable.from([stored.bytes])
            },
        }
    }

    async deleteFiles({ prefix }) {
        ;[...this.files.keys()].filter(path => path.startsWith(prefix)).forEach(path => this.files.delete(path))
    }

    paths() {
        return [...this.files.keys()].sort()
    }
}

module.exports = { ArtifactBucketDouble }
